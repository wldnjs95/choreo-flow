/**
 * Gemini 미적 평가 모듈
 *
 * 생성된 안무를 미적 기준으로 평가하고 피드백 제공
 */

import { GEMINI_API_KEY, GEMINI_API_URL, GEMINI_CONFIG, isApiKeyConfigured } from './config';
import type { PathResult } from '../algorithms/astar';

/**
 * 미적 평가 결과
 */
export interface AestheticScore {
  // 개별 점수 (0-100)
  symmetry: number;              // 대칭성
  centerFocus: number;           // 무대 중심 집중도
  crossingPenalty: number;       // 교차 복잡도 (높을수록 좋음 = 교차 적음)
  flowSmoothness: number;        // 시각적 흐름 부드러움
  mainDancerEmphasis: number;    // 메인 댄서 강조

  // 종합 점수
  overall: number;

  // 구체적 피드백
  feedback: string[];

  // 개선 제안
  suggestions: ImprovementSuggestion[];
}

export interface ImprovementSuggestion {
  type: 'symmetry' | 'spacing' | 'path' | 'timing' | 'emphasis';
  dancerId?: number;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * 평가 프롬프트
 */
const EVALUATOR_PROMPT = `당신은 전문 안무가입니다. 다음 댄스 안무 경로를 미적 관점에서 평가해주세요.

## 평가 기준 (각 0-100점):
1. **대칭성 (symmetry)**: 좌우 dancer들의 움직임이 거울처럼 대칭적인가?
2. **중심 집중도 (centerFocus)**: 클라이맥스나 중요한 순간에 시선이 무대 중앙으로 모이는가?
3. **교차 복잡도 (crossingPenalty)**: 경로가 지나치게 복잡하게 얽히지 않는가? (높을수록 좋음 = 깔끔함)
4. **흐름 부드러움 (flowSmoothness)**: 급격한 방향 전환 없이 자연스럽게 흐르는가?
5. **메인 댄서 강조 (mainDancerEmphasis)**: 지정된 메인 댄서가 시각적으로 돋보이는가?

## 무대 정보:
- 크기: 10m x 8m
- dancer 수: 8명
- 총 시간: 8 counts

## 응답 형식 (JSON):
{
  "symmetry": number,
  "centerFocus": number,
  "crossingPenalty": number,
  "flowSmoothness": number,
  "mainDancerEmphasis": number,
  "overall": number,
  "feedback": ["피드백1", "피드백2", ...],
  "suggestions": [
    {
      "type": "symmetry" | "spacing" | "path" | "timing" | "emphasis",
      "dancerId": number | null,
      "description": "개선 설명",
      "priority": "high" | "medium" | "low"
    }
  ]
}

반드시 유효한 JSON만 출력하세요.

## 안무 경로 데이터:
`;

/**
 * Gemini API 호출
 */
async function callGeminiAPI(prompt: string): Promise<string> {
  if (!isApiKeyConfigured()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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
      generationConfig: GEMINI_CONFIG,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 오류: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
 * 경로 데이터를 평가용 텍스트로 변환
 */
function formatPathsForEvaluation(paths: PathResult[], mainDancer?: number | null): string {
  let text = '';

  if (mainDancer) {
    text += `메인 댄서: Dancer ${mainDancer}\n\n`;
  }

  for (const pathResult of paths) {
    const { dancerId, path, totalDistance } = pathResult;
    text += `Dancer ${dancerId} (총 ${totalDistance.toFixed(2)}m):\n`;

    // 경로의 주요 지점만 포함
    const keyPoints = path.filter((_, i) => i === 0 || i === path.length - 1 || i % 3 === 0);
    for (const point of keyPoints) {
      text += `  t=${point.t.toFixed(1)}: (${point.x.toFixed(2)}, ${point.y.toFixed(2)})\n`;
    }
    text += '\n';
  }

  return text;
}

/**
 * Gemini를 사용한 미적 평가
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
    console.error('평가 오류:', error);
    throw new Error(`안무 평가 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

/**
 * 로컬 미적 평가 (API 없이)
 * 간단한 휴리스틱 기반 평가
 */
export function evaluateChoreographyLocal(
  paths: PathResult[],
  mainDancer?: number | null
): AestheticScore {
  const feedback: string[] = [];
  const suggestions: ImprovementSuggestion[] = [];

  // 1. 대칭성 평가
  const symmetryScore = evaluateSymmetry(paths);
  if (symmetryScore < 70) {
    feedback.push('좌우 움직임의 대칭성이 부족합니다.');
    suggestions.push({
      type: 'symmetry',
      description: '좌우 dancer 쌍(1-7, 2-6, 3-5)의 경로를 더 대칭적으로 조정하세요.',
      priority: 'medium',
    });
  }

  // 2. 중심 집중도 평가
  const centerFocusScore = evaluateCenterFocus(paths);
  if (centerFocusScore < 60) {
    feedback.push('클라이맥스에서 중앙 집중도가 낮습니다.');
    suggestions.push({
      type: 'spacing',
      description: '마지막 count에서 dancers가 무대 중앙을 향하도록 조정하세요.',
      priority: 'low',
    });
  }

  // 3. 교차 복잡도 평가
  const crossingScore = evaluateCrossings(paths);
  if (crossingScore < 60) {
    feedback.push('경로가 너무 복잡하게 교차합니다.');
    suggestions.push({
      type: 'path',
      description: '교차 지점을 줄이거나 타이밍을 조정하세요.',
      priority: 'high',
    });
  }

  // 4. 흐름 부드러움 평가
  const smoothnessScore = evaluateSmoothness(paths);
  if (smoothnessScore < 70) {
    feedback.push('일부 dancer의 움직임이 급격합니다.');
    const sharpDancers = findSharpTurns(paths);
    for (const dancerId of sharpDancers) {
      suggestions.push({
        type: 'path',
        dancerId,
        description: `Dancer ${dancerId}의 경로를 더 부드럽게 조정하세요.`,
        priority: 'medium',
      });
    }
  }

  // 5. 메인 댄서 강조 평가
  let emphasisScore = 70;
  if (mainDancer) {
    emphasisScore = evaluateMainDancerEmphasis(paths, mainDancer);
    if (emphasisScore < 60) {
      feedback.push(`Dancer ${mainDancer}의 강조가 부족합니다.`);
      suggestions.push({
        type: 'emphasis',
        dancerId: mainDancer,
        description: `Dancer ${mainDancer}의 경로를 더 중앙으로, 다른 dancers와 구별되게 하세요.`,
        priority: 'high',
      });
    }
  }

  // 종합 점수 계산
  const overall = Math.round(
    symmetryScore * 0.2 +
    centerFocusScore * 0.15 +
    crossingScore * 0.25 +
    smoothnessScore * 0.25 +
    emphasisScore * 0.15
  );

  if (overall >= 80) {
    feedback.unshift('전체적으로 훌륭한 안무입니다!');
  } else if (overall >= 60) {
    feedback.unshift('괜찮은 안무이지만 개선의 여지가 있습니다.');
  } else {
    feedback.unshift('안무에 상당한 개선이 필요합니다.');
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
 * 대칭성 평가
 */
function evaluateSymmetry(paths: PathResult[]): number {
  // 대칭 쌍: (1,7), (2,6), (3,5)
  const pairs = [[0, 6], [1, 5], [2, 4]];
  let totalDiff = 0;
  let count = 0;

  for (const [i, j] of pairs) {
    if (paths[i] && paths[j]) {
      const path1 = paths[i].path;
      const path2 = paths[j].path;

      // 각 시점에서 y좌표와 x좌표 대칭 비교
      for (let t = 0; t <= 8; t += 1) {
        const p1 = interpolate(path1, t);
        const p2 = interpolate(path2, t);
        if (p1 && p2) {
          // x좌표는 중앙(5)을 기준으로 대칭이어야 함
          const xDiff = Math.abs((5 - p1.x) - (p2.x - 5));
          // y좌표는 같아야 함
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
 * 중심 집중도 평가
 */
function evaluateCenterFocus(paths: PathResult[]): number {
  // 마지막 count에서 중앙(5, 4)으로부터의 평균 거리
  let totalDist = 0;
  const centerX = 5;
  const centerY = 4;

  for (const pathResult of paths) {
    const lastPoint = pathResult.path[pathResult.path.length - 1];
    const dist = Math.sqrt((lastPoint.x - centerX) ** 2 + (lastPoint.y - centerY) ** 2);
    totalDist += dist;
  }

  const avgDist = totalDist / paths.length;
  // 평균 거리가 3m 이하면 좋음
  return Math.max(0, Math.min(100, 100 - (avgDist - 2) * 20));
}

/**
 * 교차 복잡도 평가
 */
function evaluateCrossings(paths: PathResult[]): number {
  let crossings = 0;

  // 각 시점에서 경로 교차 검사
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

  // 교차가 적을수록 점수 높음
  return Math.max(0, Math.min(100, 100 - crossings * 5));
}

/**
 * 부드러움 평가
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

      // 방향 변화 계산
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
  // 평균 각도 변화가 작을수록 부드러움
  return Math.max(0, Math.min(100, 100 - avgSharpness * 50));
}

/**
 * 급격한 회전이 있는 dancer 찾기
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

      if (angleDiff > Math.PI / 3) {  // 60도 이상
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
 * 메인 댄서 강조 평가
 */
function evaluateMainDancerEmphasis(paths: PathResult[], mainDancer: number): number {
  const mainPath = paths.find(p => p.dancerId === mainDancer);
  if (!mainPath) return 50;

  // 메인 댄서가 얼마나 중앙에 있는지
  let centerScore = 0;
  let count = 0;

  for (const point of mainPath.path) {
    const distFromCenter = Math.sqrt((point.x - 5) ** 2 + (point.y - 4) ** 2);
    centerScore += Math.max(0, 5 - distFromCenter);
    count++;
  }

  // 메인 댄서의 이동 거리 (더 많이 움직이면 강조됨)
  const mainDistance = mainPath.totalDistance;
  const avgDistance = paths.reduce((sum, p) => sum + p.totalDistance, 0) / paths.length;
  const distanceBonus = mainDistance > avgDistance ? 10 : 0;

  const score = (centerScore / count) * 15 + distanceBonus + 30;
  return Math.max(0, Math.min(100, score));
}

/**
 * 경로 보간
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
