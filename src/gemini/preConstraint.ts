/**
 * Gemini 사전 제약 모듈 (Pre-Constraint)
 *
 * 대형 전환을 분석하여 알고리즘에 제약조건 제공
 */

import { callGeminiAPI } from './config';
import type { Position } from '../algorithms/hungarian';

/**
 * 이동 순서 전략
 */
export type MovementOrder =
  | 'simultaneous'    // 동시 이동
  | 'wave_outward'    // 바깥쪽부터 웨이브
  | 'wave_inward'     // 안쪽부터 웨이브
  | 'center_first'    // 센터 먼저
  | 'outer_first'     // 외곽 먼저
  | 'longest_first'   // 긴 거리 먼저
  | 'shortest_first'; // 짧은 거리 먼저

/**
 * 개별 dancer 힌트
 */
export interface DancerHint {
  dancerId: number;
  priority: number;       // 처리 우선순위 (낮을수록 먼저)
  preferCurve: boolean;   // 곡선 경로 선호
  delayRatio: number;     // 시작 지연 비율 (0-1)
  avoidCenter: boolean;   // 센터 회피
}

/**
 * Gemini가 생성하는 사전 제약조건
 */
export interface GeminiPreConstraint {
  // 전체 전략
  movementOrder: MovementOrder;
  overallStrategy: string;  // 자연어 설명

  // 개별 dancer 힌트
  dancerHints: DancerHint[];

  // 추가 제약
  maintainSymmetry: boolean;     // 대칭 유지
  avoidCrossing: boolean;        // 경로 교차 회피
  preferSmoothPaths: boolean;    // 부드러운 경로 선호
  suggestedCurveAmount: number;  // 권장 곡선량 (0-1)

  // 신뢰도
  confidence: number;  // 0-1
}

/**
 * 대형 정보
 */
interface FormationInfo {
  type: string;
  positions: Position[];
  centerX: number;
  centerY: number;
}

/**
 * 대형 분석 (센터, 분포 등)
 */
function analyzeFormation(positions: Position[], _stageWidth: number, _stageHeight: number): FormationInfo {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

  // 원형 체크
  const distancesFromCenter = positions.map(p =>
    Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
  );
  const avgDist = distancesFromCenter.reduce((a, b) => a + b, 0) / distancesFromCenter.length;
  const distVariance = distancesFromCenter.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / distancesFromCenter.length;
  const isCircular = distVariance < 0.5;

  // 일렬 체크
  const yVariance = positions.reduce((sum, p) => sum + (p.y - centerY) ** 2, 0) / positions.length;
  const isLine = yVariance < 0.5;

  // V자 체크
  const sortedByX = [...positions].sort((a, b) => a.x - b.x);
  const leftHalf = sortedByX.slice(0, Math.floor(sortedByX.length / 2));
  const rightHalf = sortedByX.slice(Math.ceil(sortedByX.length / 2));
  const leftSlope = leftHalf.length > 1 ? (leftHalf[leftHalf.length - 1].y - leftHalf[0].y) / (leftHalf[leftHalf.length - 1].x - leftHalf[0].x) : 0;
  const rightSlope = rightHalf.length > 1 ? (rightHalf[rightHalf.length - 1].y - rightHalf[0].y) / (rightHalf[rightHalf.length - 1].x - rightHalf[0].x) : 0;
  const isVShape = leftSlope > 0.3 && rightSlope < -0.3;

  let type = 'unknown';
  if (isCircular) type = 'circle';
  else if (isLine) type = 'line';
  else if (isVShape) type = 'v_shape';

  return { type, positions, centerX, centerY };
}

/**
 * 프롬프트 생성
 */
function createPreConstraintPrompt(
  startInfo: FormationInfo,
  endInfo: FormationInfo,
  dancerCount: number,
  stageWidth: number,
  stageHeight: number
): string {
  const startPositionsStr = startInfo.positions
    .map((p, i) => `  Dancer ${i + 1}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`)
    .join('\n');

  const endPositionsStr = endInfo.positions
    .map((p, i) => `  Dancer ${i + 1}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`)
    .join('\n');

  return `당신은 전문 댄스 안무가입니다. 대형 전환을 분석하고 최적의 이동 전략을 제안해주세요.

## 무대 정보
- 크기: ${stageWidth}m x ${stageHeight}m
- 중심: (${stageWidth / 2}, ${stageHeight / 2})

## 시작 대형 (${startInfo.type})
${startPositionsStr}
- 대형 중심: (${startInfo.centerX.toFixed(1)}, ${startInfo.centerY.toFixed(1)})

## 끝 대형 (${endInfo.type})
${endPositionsStr}
- 대형 중심: (${endInfo.centerX.toFixed(1)}, ${endInfo.centerY.toFixed(1)})

## 분석 요청
1. 이 대형 전환에서 가장 자연스러운 이동 순서는?
2. 어떤 dancer가 먼저/나중에 움직여야 하는지?
3. 곡선 경로가 필요한 dancer는?
4. 경로 교차를 피해야 하는 상황인지?

## 응답 형식 (JSON만 반환)
{
  "movementOrder": "simultaneous" | "wave_outward" | "wave_inward" | "center_first" | "outer_first" | "longest_first" | "shortest_first",
  "overallStrategy": "전체 전략 설명 (1-2문장)",
  "dancerHints": [
    {
      "dancerId": 1,
      "priority": 1,
      "preferCurve": false,
      "delayRatio": 0.0,
      "avoidCenter": false
    }
  ],
  "maintainSymmetry": true/false,
  "avoidCrossing": true/false,
  "preferSmoothPaths": true/false,
  "suggestedCurveAmount": 0.0-1.0,
  "confidence": 0.0-1.0
}

주의:
- dancerHints는 모든 ${dancerCount}명의 dancer에 대해 제공
- priority는 1부터 시작, 낮을수록 먼저 처리
- delayRatio는 0(즉시 시작)부터 1(마지막에 시작)
- JSON만 반환, 설명 없이`;
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
 * 기본 제약조건 생성 (로컬 폴백)
 */
export function generateDefaultConstraint(
  startPositions: Position[],
  endPositions: Position[],
  stageWidth: number,
  stageHeight: number
): GeminiPreConstraint {
  const dancerCount = startPositions.length;
  const stageCenterX = stageWidth / 2;
  const stageCenterY = stageHeight / 2;

  // 각 dancer의 이동 거리 계산
  const distances = startPositions.map((start, i) => ({
    dancerId: i + 1,
    distance: Math.sqrt(
      (endPositions[i].x - start.x) ** 2 +
      (endPositions[i].y - start.y) ** 2
    ),
    startDistFromCenter: Math.sqrt(
      (start.x - stageCenterX) ** 2 +
      (start.y - stageCenterY) ** 2
    ),
  }));

  // 거리순 정렬하여 priority 부여
  const sortedByDistance = [...distances].sort((a, b) => b.distance - a.distance);

  const dancerHints: DancerHint[] = distances.map(d => {
    const priority = sortedByDistance.findIndex(s => s.dancerId === d.dancerId) + 1;
    return {
      dancerId: d.dancerId,
      priority,
      preferCurve: d.distance > 3,  // 긴 거리는 곡선 고려
      delayRatio: (priority - 1) / (dancerCount - 1) * 0.3,  // 최대 30% 지연
      avoidCenter: d.startDistFromCenter < 2,  // 센터 근처 dancer는 센터 회피
    };
  });

  return {
    movementOrder: 'longest_first',
    overallStrategy: '긴 거리를 이동하는 dancer를 우선 처리하여 충돌 최소화',
    dancerHints,
    maintainSymmetry: true,
    avoidCrossing: true,
    preferSmoothPaths: true,
    suggestedCurveAmount: 0.3,
    confidence: 0.5,  // 로컬 폴백이므로 낮은 신뢰도
  };
}

/**
 * Gemini를 사용하여 사전 제약조건 생성
 */
export async function generatePreConstraint(
  startPositions: Position[],
  endPositions: Position[],
  stageWidth: number,
  stageHeight: number
): Promise<GeminiPreConstraint> {
  const startInfo = analyzeFormation(startPositions, stageWidth, stageHeight);
  const endInfo = analyzeFormation(endPositions, stageWidth, stageHeight);

  const prompt = createPreConstraintPrompt(
    startInfo,
    endInfo,
    startPositions.length,
    stageWidth,
    stageHeight
  );

  try {
    const responseText = await callGeminiAPI(prompt, { temperature: 0.3 });
    const jsonStr = extractJSON(responseText);
    const result = JSON.parse(jsonStr) as GeminiPreConstraint;

    // 유효성 검사 및 기본값 적용
    if (!result.dancerHints || result.dancerHints.length !== startPositions.length) {
      throw new Error('Invalid dancerHints');
    }

    return {
      movementOrder: result.movementOrder || 'simultaneous',
      overallStrategy: result.overallStrategy || '',
      dancerHints: result.dancerHints,
      maintainSymmetry: result.maintainSymmetry ?? true,
      avoidCrossing: result.avoidCrossing ?? true,
      preferSmoothPaths: result.preferSmoothPaths ?? true,
      suggestedCurveAmount: result.suggestedCurveAmount ?? 0.3,
      confidence: result.confidence ?? 0.8,
    };
  } catch (error) {
    console.error('Gemini Pre-constraint 생성 실패:', error);
    // 폴백: 로컬 제약조건
    return generateDefaultConstraint(startPositions, endPositions, stageWidth, stageHeight);
  }
}
