/**
 * Gemini 후보 랭킹 모듈
 *
 * 여러 경로 후보의 메트릭을 평가하여 최적의 후보 선택
 */

import { callGeminiAPI } from './config';
import type { CandidateResult, CandidateMetrics } from '../algorithms/candidateGenerator';

/**
 * 사용자 의도/선호도
 */
export interface UserPreference {
  style?: 'smooth' | 'dynamic' | 'synchronized' | 'wave' | 'natural';
  priority?: 'symmetry' | 'smoothness' | 'speed' | 'simultaneous';
  description?: string;  // 자연어 설명
}

/**
 * 랭킹 결과
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
 * JSON 추출
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

  throw new Error('JSON을 찾을 수 없습니다.');
}

/**
 * 랭킹 프롬프트 생성
 */
function createRankingPrompt(
  candidates: { id: string; strategy: string; metrics: CandidateMetrics }[],
  userPreference: UserPreference
): string {
  const candidatesSummary = candidates.map(c => ({
    id: c.id,
    strategy: c.strategy,
    metrics: {
      충돌횟수: c.metrics.collisionCount,
      대칭성점수: c.metrics.symmetryScore,
      경로부드러움: c.metrics.pathSmoothness,
      경로교차횟수: c.metrics.crossingCount,
      최대지연시간: Math.round(c.metrics.maxDelay * 10) / 10,
      동시도착점수: c.metrics.simultaneousArrival,
    },
  }));

  return `당신은 전문 댄스 안무가입니다. 여러 경로 후보 중에서 가장 적합한 것을 선택해주세요.

## 후보 목록 (메트릭 포함):
${JSON.stringify(candidatesSummary, null, 2)}

## 메트릭 설명:
- 충돌횟수: 0이 최고 (dancer 간 충돌)
- 대칭성점수: 0-100, 높을수록 좌우 대칭
- 경로부드러움: 0-100, 높을수록 직선에 가까움
- 경로교차횟수: 낮을수록 깔끔한 동선
- 최대지연시간: 가장 늦게 출발하는 dancer의 지연 (낮을수록 동시 출발)
- 동시도착점수: 0-100, 높을수록 모두 비슷한 시간에 도착

## 사용자 선호:
${userPreference.description || '자연스럽고 깔끔한 동선'}
${userPreference.style ? `스타일: ${userPreference.style}` : ''}
${userPreference.priority ? `우선순위: ${userPreference.priority}` : ''}

## 선택 기준:
1. 충돌이 있는 후보는 가급적 피함
2. 사용자 선호에 맞는 메트릭 우선
3. 전반적인 밸런스 고려

## 응답 형식 (JSON만 반환):
{
  "selectedId": "가장 적합한 후보 ID",
  "rankings": [
    { "id": "후보 ID", "rank": 1, "score": 95, "reason": "선택 이유 (1문장)" },
    { "id": "후보 ID", "rank": 2, "score": 82, "reason": "..." }
  ],
  "explanation": "전체 선택 근거 (2-3문장)"
}

JSON만 반환하세요. 설명 없이 JSON만 출력하세요.`;
}

/**
 * Gemini를 사용하여 후보 랭킹
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
    // 랭킹은 일관성을 위해 낮은 temperature 사용
    const responseText = await callGeminiAPI(prompt, { temperature: 0.3 });
    const jsonStr = extractJSON(responseText);
    const result = JSON.parse(jsonStr) as RankingResult;

    // 유효성 검사
    if (!result.selectedId || !result.rankings || !Array.isArray(result.rankings)) {
      throw new Error('Invalid ranking response format');
    }

    // 선택된 ID가 실제 후보에 있는지 확인
    const validIds = candidates.map(c => c.id);
    if (!validIds.includes(result.selectedId)) {
      // 가장 좋은 메트릭의 후보로 폴백
      result.selectedId = candidates[0].id;
    }

    return result;
  } catch (error) {
    console.error('Gemini 랭킹 오류:', error);
    // 폴백: 로컬 랭킹 사용
    return rankCandidatesLocal(candidates, userPreference);
  }
}

/**
 * 로컬 랭킹 (Gemini API 없이)
 */
export function rankCandidatesLocal(
  candidates: CandidateResult[],
  userPreference: UserPreference = {}
): RankingResult {
  // 점수 계산
  const scored = candidates.map(c => {
    let score = 100;

    // 충돌은 크게 감점
    score -= c.metrics.collisionCount * 30;

    // 교차 횟수 감점
    score -= c.metrics.crossingCount * 5;

    // 사용자 선호에 따른 가중치
    if (userPreference.priority === 'symmetry') {
      score += c.metrics.symmetryScore * 0.3;
    } else if (userPreference.priority === 'smoothness') {
      score += c.metrics.pathSmoothness * 0.3;
    } else if (userPreference.priority === 'simultaneous') {
      score += c.metrics.simultaneousArrival * 0.3;
    } else {
      // 기본: 균형 잡힌 점수
      score += c.metrics.symmetryScore * 0.1;
      score += c.metrics.pathSmoothness * 0.1;
      score += c.metrics.simultaneousArrival * 0.1;
    }

    // 스타일에 따른 조정
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

  // 점수순 정렬
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
    explanation: `충돌 없고 ${userPreference.priority || '균형 잡힌'} 메트릭 기준으로 ${scored[0].candidate.strategy} 전략이 선택되었습니다.`,
  };
}

/**
 * 로컬 랭킹 이유 생성
 */
function generateLocalReason(candidate: CandidateResult, isSelected: boolean): string {
  const { metrics } = candidate;

  if (metrics.collisionCount > 0) {
    return `충돌 ${metrics.collisionCount}건 발생`;
  }

  const highlights: string[] = [];

  if (metrics.symmetryScore >= 80) {
    highlights.push('대칭성 우수');
  }
  if (metrics.pathSmoothness >= 80) {
    highlights.push('부드러운 동선');
  }
  if (metrics.simultaneousArrival >= 80) {
    highlights.push('동시 도착');
  }
  if (metrics.crossingCount === 0) {
    highlights.push('교차 없음');
  }

  if (highlights.length > 0) {
    return highlights.slice(0, 2).join(', ');
  }

  return isSelected ? '전반적으로 균형 잡힌 결과' : '일부 메트릭 개선 필요';
}

/**
 * 후보 비교 요약 생성 (UI용)
 */
export function generateComparisonSummary(candidates: CandidateResult[]): string {
  const lines: string[] = ['## 후보 비교\n'];

  candidates.forEach((c, i) => {
    const { metrics } = c;
    const status = metrics.collisionCount === 0 ? '✓' : '✗';

    lines.push(`### ${i + 1}. ${c.strategy} ${status}`);
    lines.push(`- 충돌: ${metrics.collisionCount}건`);
    lines.push(`- 대칭성: ${metrics.symmetryScore}점`);
    lines.push(`- 부드러움: ${metrics.pathSmoothness}점`);
    lines.push(`- 교차: ${metrics.crossingCount}회`);
    lines.push(`- 동시도착: ${metrics.simultaneousArrival}점`);
    lines.push('');
  });

  return lines.join('\n');
}
