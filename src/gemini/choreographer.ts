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

  return `You are an expert dance choreographer. Compute movement paths for ${dancerCount} dancers.

## #1 PRIORITY: COLLISION AVOIDANCE
**ZERO COLLISIONS IS MANDATORY.** Every path must guarantee no two dancers are ever within ${collisionRadius}m of each other at any time. This is more important than aesthetics, efficiency, or smoothness.

## STAGE
- Size: ${stageWidth}m × ${stageHeight}m (origin top-left)
- Collision radius: ${collisionRadius}m (STRICT - dancers must NEVER be closer)
- Total counts: ${totalCounts}

## POSITIONS
${JSON.stringify(positionsData, null, 2)}

## COLLISION AVOIDANCE STRATEGIES (USE AGGRESSIVELY)
1. **Timing Offset (MOST EFFECTIVE)**: Stagger start times. Use startTime 0.0-0.5.
   - If paths cross: one dancer waits, other goes first
   - Group dancers by region: left side moves first, then right (or vice versa)

2. **Curved Detours**: Add waypoints to go AROUND collision zones
   - If two dancers would meet at center, one curves left, other curves right
   - Add 2-3 intermediate points to create safe arc

3. **Speed Variation**: Faster dancer clears the zone before slower one enters

## VERIFICATION CHECKLIST (DO THIS MENTALLY)
For each time t = 0.0, 0.1, 0.2, ... 1.0:
  - Calculate position of ALL dancers
  - Check distance between EVERY pair
  - If ANY pair < ${collisionRadius}m → FIX IT before outputting

## OUTPUT FORMAT (JSON ONLY)
{
  "strategy": "1 sentence",
  "reasoning": "How you avoided collisions (2-3 sentences)",
  "confidence": 0.0-1.0,
  "paths": [
    {
      "dancerId": 1,
      "startTime": 0.0,
      "speed": 1.0,
      "totalDistance": 3.5,
      "path": [{"x": 2.0, "y": 3.0, "t": 0.0}, ..., {"x": 5.0, "y": 6.0, "t": 1.0}]
    }
  ]
}

REQUIREMENTS:
- First point: start position, t=0.0
- Last point: end position, t=1.0
- Exactly ${dancerCount} paths
- 5-8 points per path
- Stay within bounds (0-${stageWidth}, 0-${stageHeight})
- **ZERO COLLISIONS** (distance >= ${collisionRadius}m at ALL times)

${userPreference ? `USER PREFERENCE: ${userPreference}\n` : ''}
Output JSON only.`;
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
  maxRetries: number = 1
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

        // Only retry once for validation errors (attempt 0 can retry to attempt 1)
        // After that, accept with collisions to avoid infinite loop
        if (validation.errors.length > 5 && attempt === 0) {
          console.warn(`[Gemini Only] Too many collisions (${validation.errors.length}), retrying once...`);
          throw new Error(`Validation failed: ${validation.errors.length} errors`);
        }
        // Accept result with collisions - show in UI
        console.warn(`[Gemini Only] Accepting result with ${validation.errors.length} collision(s)`);
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
