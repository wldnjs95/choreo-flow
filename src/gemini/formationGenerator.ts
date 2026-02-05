/**
 * Gemini Formation Generator
 *
 * Uses Gemini to generate dance formations from:
 * 1. Text descriptions
 * 2. Sketch drawings (images)
 */

import { GEMINI_API_URL, GEMINI_CONFIG } from './config';

export interface GeneratedPosition {
  x: number;
  y: number;
}

export interface FormationGenerationResult {
  success: boolean;
  positions?: GeneratedPosition[];
  error?: string;
  description?: string;  // Gemini's description of the generated formation
}

const FORMATION_SYSTEM_PROMPT = `You are a dance formation designer. Your task is to generate dancer positions for a stage.

IMPORTANT RULES:
1. The stage coordinate system:
   - X axis: 0 (stage left) to stageWidth (stage right)
   - Y axis: 0 (back of stage) to stageHeight (front of stage, facing audience)
   - Center of stage: (stageWidth/2, stageHeight/2)

2. Position constraints:
   - All positions must be INSIDE the stage boundaries
   - Leave at least 0.5m margin from edges
   - Minimum distance between dancers: 1.0m (to avoid collisions)
   - Spread dancers evenly unless specific clustering is requested

3. Common formation patterns:
   - Line: Dancers in a horizontal row
   - V-shape: Dancers in a V pointing toward audience
   - Circle: Dancers in a circular arrangement
   - Diamond: Diamond shape
   - Triangle: Pointing toward audience or back
   - Scattered: Random but evenly distributed
   - Grid: Rows and columns
   - Arc: Curved line facing audience

4. Response format - ONLY return valid JSON:
{
  "positions": [
    {"x": number, "y": number},
    ...
  ],
  "description": "Brief description of the formation"
}

Do NOT include any text outside the JSON object.`;

/**
 * Check if API server is available
 */
async function checkApiAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(GEMINI_API_URL.replace('/gemini', '/health'), {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Generate formation from text description
 */
export async function generateFormationFromText(
  description: string,
  dancerCount: number,
  stageWidth: number,
  stageHeight: number
): Promise<FormationGenerationResult> {
  // Check if API is available first
  const apiAvailable = await checkApiAvailable();
  if (!apiAvailable) {
    return {
      success: false,
      error: 'API 서버에 연결할 수 없습니다. "npm run dev:all"로 서버를 실행해주세요.',
    };
  }

  const prompt = `${FORMATION_SYSTEM_PROMPT}

Stage dimensions: ${stageWidth}m (width) x ${stageHeight}m (height)
Number of dancers: ${dancerCount}

User request: "${description}"

Generate exactly ${dancerCount} dancer positions based on the user's request.
Remember: Y=0 is BACK of stage, Y=${stageHeight} is FRONT (audience side).

Return ONLY the JSON object with positions array and description.`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          ...GEMINI_CONFIG,
          temperature: 0.3,  // Lower temperature for more consistent results
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API error: ${response.status} - ${errorData.error || 'Unknown'}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const finishReason = data.candidates?.[0]?.finishReason;
      const promptFeedback = data.promptFeedback;

      console.error('[FormationGenerator] Text empty response:', {
        finishReason,
        promptFeedback,
        fullResponse: JSON.stringify(data).slice(0, 1000)
      });

      if (promptFeedback?.blockReason) {
        throw new Error(`요청이 차단되었습니다: ${promptFeedback.blockReason}`);
      }
      throw new Error('Gemini로부터 빈 응답이 반환되었습니다. 다시 시도해주세요.');
    }

    // Parse JSON from response
    const result = parseFormationResponse(text, dancerCount, stageWidth, stageHeight);
    return result;
  } catch (error) {
    console.error('[FormationGenerator] Text-to-formation error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Provide more helpful error messages
    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      return {
        success: false,
        error: 'API 서버에 연결할 수 없습니다. "npm run dev:all"로 서버를 실행해주세요.',
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Generate formation from a sketch drawing (base64 image)
 */
export async function generateFormationFromSketch(
  imageBase64: string,
  dancerCount: number,
  stageWidth: number,
  stageHeight: number
): Promise<FormationGenerationResult> {
  // Check if API is available first
  const apiAvailable = await checkApiAvailable();
  if (!apiAvailable) {
    return {
      success: false,
      error: 'API 서버에 연결할 수 없습니다. "npm run dev:all"로 서버를 실행해주세요.',
    };
  }

  const prompt = `${FORMATION_SYSTEM_PROMPT}

Stage dimensions: ${stageWidth}m (width) x ${stageHeight}m (height)
Number of dancers: ${dancerCount}

The user has drawn a sketch of their desired formation. The image shows:
- The stage area (rectangular)
- Points or marks indicating where dancers should be positioned
- The drawing may be rough/imprecise - interpret the INTENT

Analyze the sketch and generate exactly ${dancerCount} dancer positions that match the user's drawing.
Remember: In the sketch, TOP is the BACK of stage (Y=0), BOTTOM is FRONT (Y=${stageHeight}).

If the drawing has fewer marks than ${dancerCount} dancers, extrapolate the pattern to fill in the remaining positions logically.
If the drawing has more marks than ${dancerCount} dancers, select the most prominent/central ${dancerCount} positions.

Return ONLY the JSON object with positions array and description.`;

  try {
    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          ...GEMINI_CONFIG,
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API error: ${response.status} - ${errorData.error || 'Unknown'}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      // Check for specific issues
      const finishReason = data.candidates?.[0]?.finishReason;
      const safetyRatings = data.candidates?.[0]?.safetyRatings;
      const promptFeedback = data.promptFeedback;

      console.error('[FormationGenerator] Sketch empty response:', {
        finishReason,
        safetyRatings,
        promptFeedback,
        fullResponse: JSON.stringify(data).slice(0, 1000)
      });

      if (finishReason === 'SAFETY') {
        throw new Error('이미지가 안전 필터에 의해 차단되었습니다. 다른 스케치를 시도해주세요.');
      }
      if (promptFeedback?.blockReason) {
        throw new Error(`요청이 차단되었습니다: ${promptFeedback.blockReason}`);
      }
      throw new Error('Gemini로부터 빈 응답이 반환되었습니다. 다시 시도해주세요.');
    }

    const result = parseFormationResponse(text, dancerCount, stageWidth, stageHeight);
    return result;
  } catch (error) {
    console.error('[FormationGenerator] Sketch-to-formation error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      return {
        success: false,
        error: 'API 서버에 연결할 수 없습니다. "npm run dev:all"로 서버를 실행해주세요.',
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Parse Gemini response and validate positions
 */
function parseFormationResponse(
  text: string,
  dancerCount: number,
  stageWidth: number,
  stageHeight: number
): FormationGenerationResult {
  try {
    // Try to extract JSON from the response
    let jsonStr = text.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Find JSON object in the text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed.positions)) {
      throw new Error('Invalid response format: missing positions array');
    }

    // Validate and clamp positions
    const positions: GeneratedPosition[] = parsed.positions.map((pos: { x?: number; y?: number }) => {
      const x = typeof pos.x === 'number' ? pos.x : stageWidth / 2;
      const y = typeof pos.y === 'number' ? pos.y : stageHeight / 2;

      return {
        x: Math.max(0.5, Math.min(stageWidth - 0.5, x)),
        y: Math.max(0.5, Math.min(stageHeight - 0.5, y)),
      };
    });

    // Ensure we have exactly dancerCount positions
    while (positions.length < dancerCount) {
      // Add positions by interpolating or spreading
      const basePos = positions[positions.length - 1] || { x: stageWidth / 2, y: stageHeight / 2 };
      positions.push({
        x: Math.max(0.5, Math.min(stageWidth - 0.5, basePos.x + (Math.random() - 0.5) * 2)),
        y: Math.max(0.5, Math.min(stageHeight - 0.5, basePos.y + (Math.random() - 0.5) * 2)),
      });
    }

    // Trim if too many
    if (positions.length > dancerCount) {
      positions.length = dancerCount;
    }

    return {
      success: true,
      positions,
      description: parsed.description || 'Custom formation',
    };
  } catch (error) {
    console.error('[FormationGenerator] Parse error:', error, '\nResponse:', text);
    return {
      success: false,
      error: `Failed to parse formation: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Example formation descriptions for UI hints
 */
export const FORMATION_EXAMPLES = [
  '원형으로 배치해줘',
  'V자 대형으로 앞을 향하게',
  '3열로 피라미드 형태',
  '좌우 대칭으로 2줄',
  '하트 모양으로',
  '대각선으로 계단식 배치',
  '가운데에 1명, 주변에 원형으로',
  '별 모양 대형',
];
