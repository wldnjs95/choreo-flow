/**
 * Gemini Candidate Ranking Module
 *
 * Evaluate metrics of multiple path candidates to select the optimal one
 */

import { callGeminiAPI } from './config';
import type { CandidateResult, CandidateMetrics } from '../algorithms/candidateGenerator';

/**
 * User intent/preference
 */
export interface UserPreference {
  style?: 'smooth' | 'dynamic' | 'synchronized' | 'wave' | 'natural';
  priority?: 'symmetry' | 'smoothness' | 'speed' | 'simultaneous';
  description?: string;  // Natural language description
}

/**
 * Ranking result
 */
export interface RankingResult {
  selectedId: string;
  rankings: {
    id: string;
    rank: number;
    score: number;
    reason: string;
  }[];
  explanation: string;
}

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
 * Generate ranking prompt
 */
function createRankingPrompt(
  candidates: { id: string; strategy: string; metrics: CandidateMetrics }[],
  userPreference: UserPreference
): string {
  const candidatesSummary = candidates.map(c => ({
    id: c.id,
    strategy: c.strategy,
    metrics: {
      collisionCount: c.metrics.collisionCount,
      symmetryScore: c.metrics.symmetryScore,
      pathSmoothness: c.metrics.pathSmoothness,
      crossingCount: c.metrics.crossingCount,
      maxDelay: Math.round(c.metrics.maxDelay * 10) / 10,
      simultaneousArrival: c.metrics.simultaneousArrival,
    },
  }));

  return `You are a professional dance choreographer. Please select the most suitable path candidate from the following options.

## Candidate List (with metrics):
${JSON.stringify(candidatesSummary, null, 2)}

## Metric Descriptions:
- collisionCount: 0 is best (collision between dancers)
- symmetryScore: 0-100, higher means more left-right symmetry
- pathSmoothness: 0-100, higher means closer to straight line
- crossingCount: lower means cleaner paths
- maxDelay: delay of the last dancer to start (lower means more simultaneous start)
- simultaneousArrival: 0-100, higher means all arrive at similar times

## User Preference:
${userPreference.description || 'Natural and clean movement'}
${userPreference.style ? `Style: ${userPreference.style}` : ''}
${userPreference.priority ? `Priority: ${userPreference.priority}` : ''}

## Selection Criteria:
1. Avoid candidates with collisions if possible
2. Prioritize metrics that match user preference
3. Consider overall balance

## Response Format (JSON only):
{
  "selectedId": "most suitable candidate ID",
  "rankings": [
    { "id": "candidate ID", "rank": 1, "score": 95, "reason": "selection reason (1 sentence)" },
    { "id": "candidate ID", "rank": 2, "score": 82, "reason": "..." }
  ],
  "explanation": "overall selection rationale (2-3 sentences)"
}

Return JSON only. Output JSON without explanation.`;
}

/**
 * Rank candidates using Gemini
 */
export async function rankCandidatesWithGemini(
  candidates: CandidateResult[],
  userPreference: UserPreference = {}
): Promise<RankingResult> {
  const candidatesSummary = candidates.map(c => ({
    id: c.id,
    strategy: c.strategy,
    metrics: c.metrics,
  }));

  const prompt = createRankingPrompt(candidatesSummary, userPreference);

  try {
    // Use low temperature for consistency in ranking
    const responseText = await callGeminiAPI(prompt, { temperature: 0.3 });
    const jsonStr = extractJSON(responseText);
    const result = JSON.parse(jsonStr) as RankingResult;

    // Validation
    if (!result.selectedId || !result.rankings || !Array.isArray(result.rankings)) {
      throw new Error('Invalid ranking response format');
    }

    // Verify selected ID exists in actual candidates
    const validIds = candidates.map(c => c.id);
    if (!validIds.includes(result.selectedId)) {
      // Fallback to candidate with best metrics
      result.selectedId = candidates[0].id;
    }

    return result;
  } catch (error) {
    console.error('Gemini ranking error:', error);
    // Fallback: use local ranking
    return rankCandidatesLocal(candidates, userPreference);
  }
}

/**
 * Local ranking (without Gemini API)
 */
export function rankCandidatesLocal(
  candidates: CandidateResult[],
  userPreference: UserPreference = {}
): RankingResult {
  // Calculate score
  const scored = candidates.map(c => {
    let score = 100;

    // Heavy penalty for collisions
    score -= c.metrics.collisionCount * 30;

    // Penalty for crossing count
    score -= c.metrics.crossingCount * 5;

    // Weight based on user preference
    if (userPreference.priority === 'symmetry') {
      score += c.metrics.symmetryScore * 0.3;
    } else if (userPreference.priority === 'smoothness') {
      score += c.metrics.pathSmoothness * 0.3;
    } else if (userPreference.priority === 'simultaneous') {
      score += c.metrics.simultaneousArrival * 0.3;
    } else {
      // Default: balanced score
      score += c.metrics.symmetryScore * 0.1;
      score += c.metrics.pathSmoothness * 0.1;
      score += c.metrics.simultaneousArrival * 0.1;
    }

    // Adjustment based on style
    if (userPreference.style === 'synchronized') {
      score += c.metrics.simultaneousArrival * 0.2;
    } else if (userPreference.style === 'smooth') {
      score += c.metrics.pathSmoothness * 0.2;
    }

    return {
      candidate: c,
      score: Math.max(0, Math.round(score)),
    };
  });

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  const rankings = scored.map((s, i) => ({
    id: s.candidate.id,
    rank: i + 1,
    score: s.score,
    reason: generateLocalReason(s.candidate, i === 0),
  }));

  return {
    selectedId: scored[0].candidate.id,
    rankings,
    explanation: `No collision and ${scored[0].candidate.strategy} strategy selected based on ${userPreference.priority || 'balanced'} metrics.`,
  };
}

/**
 * Generate local ranking reason
 */
function generateLocalReason(candidate: CandidateResult, isSelected: boolean): string {
  const { metrics } = candidate;

  if (metrics.collisionCount > 0) {
    return `${metrics.collisionCount} collision(s) detected`;
  }

  const highlights: string[] = [];

  if (metrics.symmetryScore >= 80) {
    highlights.push('excellent symmetry');
  }
  if (metrics.pathSmoothness >= 80) {
    highlights.push('smooth paths');
  }
  if (metrics.simultaneousArrival >= 80) {
    highlights.push('simultaneous arrival');
  }
  if (metrics.crossingCount === 0) {
    highlights.push('no crossing');
  }

  if (highlights.length > 0) {
    return highlights.slice(0, 2).join(', ');
  }

  return isSelected ? 'overall balanced result' : 'some metrics need improvement';
}

/**
 * Generate comparison summary for candidates (for UI)
 */
export function generateComparisonSummary(candidates: CandidateResult[]): string {
  const lines: string[] = ['## Candidate Comparison\n'];

  candidates.forEach((c, i) => {
    const { metrics } = c;
    const status = metrics.collisionCount === 0 ? '✓' : '✗';

    lines.push(`### ${i + 1}. ${c.strategy} ${status}`);
    lines.push(`- Collisions: ${metrics.collisionCount}`);
    lines.push(`- Symmetry: ${metrics.symmetryScore}`);
    lines.push(`- Smoothness: ${metrics.pathSmoothness}`);
    lines.push(`- Crossings: ${metrics.crossingCount}`);
    lines.push(`- Simultaneous arrival: ${metrics.simultaneousArrival}`);
    lines.push('');
  });

  return lines.join('\n');
}
