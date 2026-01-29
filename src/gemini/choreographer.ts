/**
 * Gemini Choreographer Module
 *
 * Generate complete choreography paths using Gemini only.
 * Gemini acts as both the algorithm designer and executor.
 */

import { callGeminiAPI } from './config';
import type { Position } from '../algorithms/hungarian';
import type { DancerPath } from '../algorithms/pathfinder';

/**
 * Gemini choreography request
 */
export interface GeminiChoreographyRequest {
  startPositions: Position[];
  endPositions: Position[];
  stageWidth: number;
  stageHeight: number;
  totalCounts: number;
  collisionRadius: number;
  userPreference?: string;
}

/**
 * Gemini choreography response
 */
export interface GeminiChoreographyResponse {
  paths: DancerPath[];
  strategy: string;
  reasoning: string;
  confidence: number;
  rawResponse?: string;  // Raw response text for debugging
  rawResponseLength?: number;
}

/**
 * Extract JSON from Gemini response
 */
function extractJSON(text: string): string {
  // Try to find JSON in code blocks with closing ```
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // Try to find JSON in code blocks WITHOUT closing ``` (truncated response)
  const truncatedMatch = text.match(/```(?:json)?\s*([\s\S]*)/);
  if (truncatedMatch) {
    const partial = truncatedMatch[1].trim();
    if (partial.startsWith('{')) {
      console.warn('[Gemini Only] Response appears truncated (no closing ```), attempting to parse partial JSON');
      return partial;
    }
  }

  // Try to find raw JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  throw new Error('JSON not found in response');
}

/**
 * Create optimized prompt for Gemini choreography generation
 */
function createChoreographyPrompt(request: GeminiChoreographyRequest): string {
  const {
    startPositions,
    endPositions,
    stageWidth,
    stageHeight,
    totalCounts,
    collisionRadius,
    userPreference,
  } = request;

  const dancerCount = startPositions.length;

  // Format positions for prompt
  const positionsData = startPositions.map((start, i) => {
    const end = endPositions[i];
    const distance = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    return {
      id: i + 1,
      start: { x: Math.round(start.x * 100) / 100, y: Math.round(start.y * 100) / 100 },
      end: { x: Math.round(end.x * 100) / 100, y: Math.round(end.y * 100) / 100 },
      distance: Math.round(distance * 100) / 100,
    };
  });

  return `You are an expert dance choreographer and algorithm designer. Your task is to compute optimal movement paths for ${dancerCount} dancers transitioning between two formations.

## STAGE CONFIGURATION
- Stage size: ${stageWidth}m (width) × ${stageHeight}m (height)
- Coordinate system: (0,0) is top-left, x increases right, y increases down
- Stage center: (${stageWidth / 2}, ${stageHeight / 2})
- Total counts (music beats): ${totalCounts}
- Collision radius: ${collisionRadius}m (dancers must stay this far apart)

## DANCER POSITIONS
${JSON.stringify(positionsData, null, 2)}

## YOUR TASK
Design the movement path for each dancer from start to end position. You must:

1. **ASSIGNMENT**: First, decide optimal dancer-to-target assignment. Consider:
   - Hungarian algorithm minimizes total distance
   - But sometimes swapping assignments reduces path crossings
   - Prioritize collision-free assignments over minimal distance

2. **COLLISION DETECTION**: For each pair of dancers, check if their paths intersect.
   - Two line segments intersect if they share a point
   - Even parallel paths can collide if dancers pass too close (<${collisionRadius}m)
   - Calculate collision time: when distance between two moving dancers < ${collisionRadius}m

3. **COLLISION RESOLUTION**: If collisions detected, resolve using:
   - **Timing offset**: Delay one dancer's start (0.0 to 0.5 of total time)
   - **Curved paths**: Add control point to create arc (bypass around collision point)
   - **Speed variation**: Faster/slower movement for certain segments
   - Priority: Longer-distance dancers start first (they need more time)

4. **PATH SMOOTHNESS**: Generate smooth paths with these considerations:
   - Straight line is default if no collision
   - Bezier curve if detour needed (add 1-2 control points)
   - Path should stay within stage bounds with 0.5m margin

5. **OUTPUT FORMAT**: For each dancer, provide:
   - dancerId: 1-indexed
   - path: Array of {x, y, t} points where t is 0.0 to 1.0 (normalized time)
   - startTime: When dancer begins moving (0.0 to 0.5)
   - speed: Movement speed multiplier (0.8 to 1.5)
   - Include 5-8 path points per dancer (balance between smoothness and response size)

${userPreference ? `## USER PREFERENCE\n${userPreference}\n` : ''}
## ALGORITHM HINTS
- For crossing paths: Calculate intersection point, offset timing so dancers pass at different times
- For parallel paths: If moving in same direction, no collision; if opposite, may need curve
- Wave effect: Outer dancers move first, inner follow (or vice versa)
- Symmetry: If formation is symmetric, mirror the path design

## RESPONSE FORMAT (JSON ONLY)
{
  "strategy": "Brief description of chosen strategy (1 sentence)",
  "reasoning": "Explain key decisions: assignments, collision handling, timing (2-3 sentences)",
  "confidence": 0.0-1.0,
  "paths": [
    {
      "dancerId": 1,
      "startTime": 0.0,
      "speed": 1.0,
      "totalDistance": 3.5,
      "path": [
        {"x": 2.0, "y": 3.0, "t": 0.0},
        {"x": 2.5, "y": 3.2, "t": 0.1},
        ...
        {"x": 5.0, "y": 6.0, "t": 1.0}
      ]
    },
    ...
  ]
}

CRITICAL REQUIREMENTS:
- First path point must match start position with t=0.0
- Last path point must match end position with t=1.0
- Provide exactly ${dancerCount} dancer paths
- All coordinates must be within stage bounds (0-${stageWidth}, 0-${stageHeight})
- Validate: NO two dancers should be within ${collisionRadius}m at the same time

Output JSON only. No explanation outside JSON.`;
}

/**
 * Validate Gemini response
 */
function validateResponse(
  response: GeminiChoreographyResponse,
  request: GeminiChoreographyRequest
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const { startPositions, endPositions, stageWidth, stageHeight, collisionRadius } = request;
  const dancerCount = startPositions.length;

  // Check dancer count
  if (response.paths.length !== dancerCount) {
    errors.push(`Expected ${dancerCount} paths, got ${response.paths.length}`);
  }

  // Validate each path
  response.paths.forEach((path) => {
    const dancerId = path.dancerId;
    const expectedStart = startPositions[dancerId - 1];
    const expectedEnd = endPositions[dancerId - 1];

    if (!path.path || path.path.length < 2) {
      errors.push(`Dancer ${dancerId}: Invalid path (too few points)`);
      return;
    }

    const firstPoint = path.path[0];
    const lastPoint = path.path[path.path.length - 1];

    // Check start position (allow small tolerance)
    const startDist = Math.sqrt(
      (firstPoint.x - expectedStart.x) ** 2 + (firstPoint.y - expectedStart.y) ** 2
    );
    if (startDist > 0.5) {
      errors.push(`Dancer ${dancerId}: Start position mismatch (dist: ${startDist.toFixed(2)})`);
    }

    // Check end position
    const endDist = Math.sqrt(
      (lastPoint.x - expectedEnd.x) ** 2 + (lastPoint.y - expectedEnd.y) ** 2
    );
    if (endDist > 0.5) {
      errors.push(`Dancer ${dancerId}: End position mismatch (dist: ${endDist.toFixed(2)})`);
    }

    // Check bounds
    path.path.forEach((point, j) => {
      if (point.x < -0.5 || point.x > stageWidth + 0.5 || point.y < -0.5 || point.y > stageHeight + 0.5) {
        errors.push(`Dancer ${dancerId}: Point ${j} out of bounds (${point.x}, ${point.y})`);
      }
    });
  });

  // Check for collisions (simplified check at key time points)
  const timeSteps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  for (const t of timeSteps) {
    const positions: { dancerId: number; x: number; y: number }[] = [];

    response.paths.forEach(path => {
      const adjustedT = Math.max(0, Math.min(1, (t - path.startTime) / (1 - path.startTime)));
      if (t < path.startTime) {
        positions.push({ dancerId: path.dancerId, ...path.path[0] });
      } else {
        // Interpolate position
        const pathIndex = Math.min(
          Math.floor(adjustedT * (path.path.length - 1)),
          path.path.length - 2
        );
        const localT = (adjustedT * (path.path.length - 1)) - pathIndex;
        const p1 = path.path[pathIndex];
        const p2 = path.path[pathIndex + 1];
        positions.push({
          dancerId: path.dancerId,
          x: p1.x + (p2.x - p1.x) * localT,
          y: p1.y + (p2.y - p1.y) * localT,
        });
      }
    });

    // Check distances between all pairs
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.sqrt(
          (positions[i].x - positions[j].x) ** 2 + (positions[i].y - positions[j].y) ** 2
        );
        if (dist < collisionRadius) {
          errors.push(
            `Collision at t=${t}: Dancers ${positions[i].dancerId} and ${positions[j].dancerId} (dist: ${dist.toFixed(2)})`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate choreography using Gemini only (with retry and self-correction)
 */
export async function generateChoreographyWithGemini(
  request: GeminiChoreographyRequest,
  maxRetries: number = 3
): Promise<GeminiChoreographyResponse> {
  const prompt = createChoreographyPrompt(request);
  let lastError: Error | null = null;
  let lastValidationErrors: string[] = [];
  const totalStartTime = performance.now();

  console.log('[Gemini Only] Starting choreography generation...');
  console.log(`[Gemini Only] Dancers: ${request.startPositions.length}, Stage: ${request.stageWidth}x${request.stageHeight}m`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStartTime = performance.now();

    try {
      if (attempt > 0) {
        console.log(`[Gemini Only] Retry ${attempt}/${maxRetries}...`);
      }

      // Add previous errors to prompt for self-correction
      let finalPrompt = prompt;
      if (lastValidationErrors.length > 0 && attempt > 0) {
        finalPrompt += `\n\n## PREVIOUS ATTEMPT ERRORS (FIX THESE):\n${lastValidationErrors.join('\n')}`;
      }

      console.log(`[Gemini Only] Calling Gemini API (attempt ${attempt + 1})...`);
      const apiStartTime = performance.now();
      const responseText = await callGeminiAPI(finalPrompt, { temperature: 0.2 });
      const apiEndTime = performance.now();
      console.log(`[Gemini Only] API response received in ${((apiEndTime - apiStartTime) / 1000).toFixed(2)}s`);
      console.log(`[Gemini Only] Raw response length: ${responseText.length} characters`);

      // Log full raw response for debugging truncation issues
      console.log(`[Gemini Only] ========== RAW RESPONSE START ==========`);
      console.log(responseText);
      console.log(`[Gemini Only] ========== RAW RESPONSE END (${responseText.length} chars) ==========`);

      const jsonStr = extractJSON(responseText);

      let result: GeminiChoreographyResponse;
      try {
        result = JSON.parse(jsonStr) as GeminiChoreographyResponse;
      } catch (parseError) {
        // JSON parsing failed - likely truncated response
        const jsonPreview = jsonStr.length > 200 ? jsonStr.substring(jsonStr.length - 200) : jsonStr;
        console.error(`[Gemini Only] JSON parse failed. End of JSON:\n...${jsonPreview}`);
        throw new Error(`JSON parse failed (response likely truncated). Try fewer dancers. Original: ${parseError}`);
      }

      // Validate response
      const validation = validateResponse(result, request);
      if (!validation.valid) {
        console.warn('Validation errors:', validation.errors);
        lastValidationErrors = validation.errors;

        // If too many errors, retry
        if (validation.errors.length > 3 && attempt < maxRetries) {
          throw new Error(`Validation failed: ${validation.errors.length} errors`);
        }
        // Otherwise, log but continue (minor errors)
        console.warn('Proceeding with minor validation errors');
      }

      // Calculate total distance if not provided
      result.paths.forEach(path => {
        if (!path.totalDistance || path.totalDistance === 0) {
          let dist = 0;
          for (let i = 1; i < path.path.length; i++) {
            dist += Math.sqrt(
              (path.path[i].x - path.path[i - 1].x) ** 2 +
              (path.path[i].y - path.path[i - 1].y) ** 2
            );
          }
          path.totalDistance = dist;
        }
      });

      const totalEndTime = performance.now();
      const totalSeconds = (totalEndTime - totalStartTime) / 1000;
      const attemptSeconds = (totalEndTime - attemptStartTime) / 1000;

      console.log(`[Gemini Only] ✓ Success!`);
      console.log(`[Gemini Only] Strategy: ${result.strategy}`);
      console.log(`[Gemini Only] Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`[Gemini Only] Attempt ${attempt + 1} took ${attemptSeconds.toFixed(2)}s`);
      console.log(`[Gemini Only] Total time: ${totalSeconds.toFixed(2)}s`);

      // Attach raw response for UI display
      result.rawResponse = responseText;
      result.rawResponseLength = responseText.length;

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const attemptEndTime = performance.now();
      const attemptSeconds = (attemptEndTime - attemptStartTime) / 1000;
      console.error(`[Gemini Only] ✗ Attempt ${attempt + 1} failed after ${attemptSeconds.toFixed(2)}s:`, error);

      if (attempt < maxRetries) {
        const waitTime = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`[Gemini Only] Retrying in ${waitTime / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  const totalEndTime = performance.now();
  const totalSeconds = (totalEndTime - totalStartTime) / 1000;
  console.error(`[Gemini Only] ✗ All ${maxRetries + 1} attempts failed. Total time: ${totalSeconds.toFixed(2)}s`);

  throw lastError || new Error('Gemini choreography generation failed after all retries');
}
