/**
 * Gemini Aesthetic Evaluation Module
 *
 * Evaluate generated choreography by aesthetic criteria and provide feedback
 */

import { callGeminiAPI } from './config';

/**
 * Path result for a single dancer
 */
interface PathResult {
  dancerId: number;
  path: Array<{ t: number; x: number; y: number }>;
  totalDistance: number;
}

/**
 * Aesthetic evaluation result
 */
export interface AestheticScore {
  // Individual scores (0-100)
  symmetry: number;              // Symmetry
  centerFocus: number;           // Stage center focus
  crossingPenalty: number;       // Crossing complexity (higher = better = fewer crossings)
  flowSmoothness: number;        // Visual flow smoothness
  mainDancerEmphasis: number;    // Main dancer emphasis

  // Overall score
  overall: number;

  // Specific feedback
  feedback: string[];

  // Improvement suggestions
  suggestions: ImprovementSuggestion[];
}

export interface ImprovementSuggestion {
  type: 'symmetry' | 'spacing' | 'path' | 'timing' | 'emphasis';
  dancerId?: number;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Evaluation prompt
 */
const EVALUATOR_PROMPT = `You are a professional choreographer. Please evaluate the following dance choreography paths from an aesthetic perspective.

## Evaluation Criteria (0-100 points each):
1. **symmetry**: Are the left-right dancer movements mirror-symmetric?
2. **centerFocus**: Does attention focus on stage center during climax or important moments?
3. **crossingPenalty**: Are paths not overly complex and tangled? (higher = better = cleaner)
4. **flowSmoothness**: Does it flow naturally without sharp direction changes?
5. **mainDancerEmphasis**: Does the designated main dancer stand out visually?

## Stage Information:
- Size: 10m x 8m
- Number of dancers: 8
- Total time: 8 counts

## Response Format (JSON):
{
  "symmetry": number,
  "centerFocus": number,
  "crossingPenalty": number,
  "flowSmoothness": number,
  "mainDancerEmphasis": number,
  "overall": number,
  "feedback": ["feedback1", "feedback2", ...],
  "suggestions": [
    {
      "type": "symmetry" | "spacing" | "path" | "timing" | "emphasis",
      "dancerId": number | null,
      "description": "improvement description",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Return only valid JSON.

## Choreography path data:
`;

/**
 * Extract JSON
 */
function extractJSON(text: string): string {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }
  throw new Error('JSON not found.');
}

/**
 * Convert path data to evaluation text
 */
function formatPathsForEvaluation(paths: PathResult[], mainDancer?: number | null): string {
  let text = '';

  if (mainDancer) {
    text += `Main dancer: Dancer ${mainDancer}\n\n`;
  }

  for (const pathResult of paths) {
    const { dancerId, path, totalDistance } = pathResult;
    text += `Dancer ${dancerId} (total ${totalDistance.toFixed(2)}m):\n`;

    // Include only key points of the path
    const keyPoints = path.filter((_, i) => i === 0 || i === path.length - 1 || i % 3 === 0);
    for (const point of keyPoints) {
      text += `  t=${point.t.toFixed(1)}: (${point.x.toFixed(2)}, ${point.y.toFixed(2)})\n`;
    }
    text += '\n';
  }

  return text;
}

/**
 * Aesthetic evaluation using Gemini
 */
export async function evaluateChoreography(
  paths: PathResult[],
  mainDancer?: number | null
): Promise<AestheticScore> {
  const pathsText = formatPathsForEvaluation(paths, mainDancer);
  const prompt = EVALUATOR_PROMPT + pathsText;

  try {
    const responseText = await callGeminiAPI(prompt);
    const jsonStr = extractJSON(responseText);
    const result = JSON.parse(jsonStr);

    return {
      symmetry: result.symmetry ?? 50,
      centerFocus: result.centerFocus ?? 50,
      crossingPenalty: result.crossingPenalty ?? 50,
      flowSmoothness: result.flowSmoothness ?? 50,
      mainDancerEmphasis: result.mainDancerEmphasis ?? 50,
      overall: result.overall ?? 50,
      feedback: result.feedback ?? [],
      suggestions: result.suggestions ?? [],
    };
  } catch (error) {
    console.error('Evaluation error:', error);
    throw new Error(`Choreography evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Local aesthetic evaluation (without API)
 * Simple heuristic-based evaluation
 */
export function evaluateChoreographyLocal(
  paths: PathResult[],
  mainDancer?: number | null
): AestheticScore {
  const feedback: string[] = [];
  const suggestions: ImprovementSuggestion[] = [];

  // 1. Evaluate symmetry
  const symmetryScore = evaluateSymmetry(paths);
  if (symmetryScore < 70) {
    feedback.push('Lack of symmetry in left-right movements.');
    suggestions.push({
      type: 'symmetry',
      description: 'Adjust paths of dancer pairs (1-7, 2-6, 3-5) to be more symmetric.',
      priority: 'medium',
    });
  }

  // 2. Evaluate center focus
  const centerFocusScore = evaluateCenterFocus(paths);
  if (centerFocusScore < 60) {
    feedback.push('Center focus is low during climax.');
    suggestions.push({
      type: 'spacing',
      description: 'Adjust dancers to face stage center on the last count.',
      priority: 'low',
    });
  }

  // 3. Evaluate crossing complexity
  const crossingScore = evaluateCrossings(paths);
  if (crossingScore < 60) {
    feedback.push('Paths cross too complexly.');
    suggestions.push({
      type: 'path',
      description: 'Reduce crossing points or adjust timing.',
      priority: 'high',
    });
  }

  // 4. Evaluate flow smoothness
  const smoothnessScore = evaluateSmoothness(paths);
  if (smoothnessScore < 70) {
    feedback.push('Some dancers have abrupt movements.');
    const sharpDancers = findSharpTurns(paths);
    for (const dancerId of sharpDancers) {
      suggestions.push({
        type: 'path',
        dancerId,
        description: `Adjust Dancer ${dancerId}'s path to be smoother.`,
        priority: 'medium',
      });
    }
  }

  // 5. Evaluate main dancer emphasis
  let emphasisScore = 70;
  if (mainDancer) {
    emphasisScore = evaluateMainDancerEmphasis(paths, mainDancer);
    if (emphasisScore < 60) {
      feedback.push(`Dancer ${mainDancer} emphasis is insufficient.`);
      suggestions.push({
        type: 'emphasis',
        dancerId: mainDancer,
        description: `Move Dancer ${mainDancer}'s path more center and distinguish from others.`,
        priority: 'high',
      });
    }
  }

  // Calculate overall score
  const overall = Math.round(
    symmetryScore * 0.2 +
    centerFocusScore * 0.15 +
    crossingScore * 0.25 +
    smoothnessScore * 0.25 +
    emphasisScore * 0.15
  );

  if (overall >= 80) {
    feedback.unshift('Overall excellent choreography!');
  } else if (overall >= 60) {
    feedback.unshift('Good choreography but room for improvement.');
  } else {
    feedback.unshift('Choreography needs significant improvement.');
  }

  return {
    symmetry: symmetryScore,
    centerFocus: centerFocusScore,
    crossingPenalty: crossingScore,
    flowSmoothness: smoothnessScore,
    mainDancerEmphasis: emphasisScore,
    overall,
    feedback,
    suggestions,
  };
}

/**
 * Evaluate symmetry
 */
function evaluateSymmetry(paths: PathResult[]): number {
  // Symmetric pairs: (1,7), (2,6), (3,5)
  const pairs = [[0, 6], [1, 5], [2, 4]];
  let totalDiff = 0;
  let count = 0;

  for (const [i, j] of pairs) {
    if (paths[i] && paths[j]) {
      const path1 = paths[i].path;
      const path2 = paths[j].path;

      // Compare y and x coordinate symmetry at each time point
      for (let t = 0; t <= 8; t += 1) {
        const p1 = interpolate(path1, t);
        const p2 = interpolate(path2, t);
        if (p1 && p2) {
          // x coordinate should be symmetric around center (5)
          const xDiff = Math.abs((5 - p1.x) - (p2.x - 5));
          // y coordinates should be the same
          const yDiff = Math.abs(p1.y - p2.y);
          totalDiff += xDiff + yDiff;
          count++;
        }
      }
    }
  }

  if (count === 0) return 70;
  const avgDiff = totalDiff / count;
  return Math.max(0, Math.min(100, 100 - avgDiff * 15));
}

/**
 * Evaluate center focus
 */
function evaluateCenterFocus(paths: PathResult[]): number {
  // Average distance from center (5, 4) at the last count
  let totalDist = 0;
  const centerX = 5;
  const centerY = 4;

  for (const pathResult of paths) {
    const lastPoint = pathResult.path[pathResult.path.length - 1];
    const dist = Math.sqrt((lastPoint.x - centerX) ** 2 + (lastPoint.y - centerY) ** 2);
    totalDist += dist;
  }

  const avgDist = totalDist / paths.length;
  // Good if average distance is 3m or less
  return Math.max(0, Math.min(100, 100 - (avgDist - 2) * 20));
}

/**
 * Evaluate crossing complexity
 */
function evaluateCrossings(paths: PathResult[]): number {
  let crossings = 0;

  // Check path crossings at each time point
  for (let t = 0; t <= 8; t += 0.5) {
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const p1 = interpolate(paths[i].path, t);
        const p2 = interpolate(paths[j].path, t);
        if (p1 && p2) {
          const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
          if (dist < 1.0) {
            crossings++;
          }
        }
      }
    }
  }

  // Higher score for fewer crossings
  return Math.max(0, Math.min(100, 100 - crossings * 5));
}

/**
 * Evaluate smoothness
 */
function evaluateSmoothness(paths: PathResult[]): number {
  let totalSharpness = 0;
  let count = 0;

  for (const pathResult of paths) {
    const path = pathResult.path;
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];

      // Calculate direction change
      const dir1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const dir2 = Math.atan2(next.y - curr.y, next.x - curr.x);
      let angleDiff = Math.abs(dir2 - dir1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      totalSharpness += angleDiff;
      count++;
    }
  }

  if (count === 0) return 80;
  const avgSharpness = totalSharpness / count;
  // Smoother when average angle change is smaller
  return Math.max(0, Math.min(100, 100 - avgSharpness * 50));
}

/**
 * Find dancers with sharp turns
 */
function findSharpTurns(paths: PathResult[]): number[] {
  const result: number[] = [];

  for (const pathResult of paths) {
    const path = pathResult.path;
    let hasSharpTurn = false;

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];

      const dir1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const dir2 = Math.atan2(next.y - curr.y, next.x - curr.x);
      let angleDiff = Math.abs(dir2 - dir1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      if (angleDiff > Math.PI / 3) {  // More than 60 degrees
        hasSharpTurn = true;
        break;
      }
    }

    if (hasSharpTurn) {
      result.push(pathResult.dancerId);
    }
  }

  return result;
}

/**
 * Evaluate main dancer emphasis
 */
function evaluateMainDancerEmphasis(paths: PathResult[], mainDancer: number): number {
  const mainPath = paths.find(p => p.dancerId === mainDancer);
  if (!mainPath) return 50;

  // How centered the main dancer is
  let centerScore = 0;
  let count = 0;

  for (const point of mainPath.path) {
    const distFromCenter = Math.sqrt((point.x - 5) ** 2 + (point.y - 4) ** 2);
    centerScore += Math.max(0, 5 - distFromCenter);
    count++;
  }

  // Main dancer's movement distance (more movement = more emphasis)
  const mainDistance = mainPath.totalDistance;
  const avgDistance = paths.reduce((sum, p) => sum + p.totalDistance, 0) / paths.length;
  const distanceBonus = mainDistance > avgDistance ? 10 : 0;

  const score = (centerScore / count) * 15 + distanceBonus + 30;
  return Math.max(0, Math.min(100, score));
}

/**
 * Path interpolation
 */
function interpolate(path: { x: number; y: number; t: number }[], t: number): { x: number; y: number } | null {
  if (path.length === 0) return null;
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y };
  if (t >= path[path.length - 1].t) return { x: path[path.length - 1].x, y: path[path.length - 1].y };

  for (let i = 0; i < path.length - 1; i++) {
    if (t >= path[i].t && t <= path[i + 1].t) {
      const ratio = (t - path[i].t) / (path[i + 1].t - path[i].t);
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * ratio,
        y: path[i].y + (path[i + 1].y - path[i].y) * ratio,
      };
    }
  }
  return null;
}
