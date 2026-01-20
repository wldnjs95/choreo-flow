/**
 * 안무 생성 파이프라인 (Choreography Pipeline)
 *
 * 전체 흐름:
 * 1. Gemini: 자연어 → 파라미터 파싱
 * 2. Formation Generator: 대형 좌표 생성
 * 3. Hungarian Algorithm: 최적 할당
 * 4. Simple Pathfinder: 직선 경로 + 충돌 회피
 * 5. Gemini: 미적 평가 및 피드백
 */

import { computeOptimalAssignment } from './hungarian';
import type { Position, Assignment } from './hungarian';
import { computeAllPathsSimple, validatePathsSimple } from './pathfinder';
import type { DancerPath } from './pathfinder';
import { generateFormation, applySpread } from './formations';
import type { FormationType } from './formations';
import {
  parseChoreographyRequest,
  parseChoreographyRequestMock,
} from '../gemini/parser';
import type { ChoreographyRequest } from '../gemini/parser';
import {
  evaluateChoreographyLocal,
} from '../gemini/evaluator';
import type { AestheticScore } from '../gemini/evaluator';
import { isApiKeyConfigured } from '../gemini/config';

/**
 * 파이프라인 결과
 */
export interface ChoreographyResult {
  // 입력 정보
  request: ChoreographyRequest;

  // 대형 좌표
  startPositions: Position[];
  endPositions: Position[];

  // 할당 결과
  assignments: Assignment[];

  // 경로 결과
  paths: DancerPath[];

  // 부드러운 경로 (시각화용)
  smoothPaths: SmoothPath[];

  // 충돌 검증
  validation: {
    valid: boolean;
    collisions: { dancer1: number; dancer2: number; time: number }[];
  };

  // 미적 평가 (선택)
  aestheticScore?: AestheticScore;

  // 메타데이터
  metadata: {
    totalDistance: number;
    averageDistance: number;
    maxDistance: number;
    minDistance: number;
    computeTimeMs: number;
  };
}

export interface SmoothPath {
  dancerId: number;
  color: string;
  points: { x: number; y: number; t: number }[];
  startTime: number;
  speed: number;
  distance: number;
}

// Dancer 색상
const DANCER_COLORS = [
  '#FF6B6B',  // Coral Red
  '#4ECDC4',  // Teal
  '#45B7D1',  // Sky Blue
  '#96CEB4',  // Sage Green
  '#FFD93D',  // Golden Yellow
  '#6C5CE7',  // Purple
  '#A8E6CF',  // Mint
  '#FF8C42',  // Orange
];

/**
 * 자연어 입력으로 안무 생성
 */
export async function generateChoreographyFromText(
  userInput: string,
  options: {
    useGeminiParser?: boolean;
    useGeminiEvaluator?: boolean;
    dancerCount?: number;
    stageWidth?: number;
    stageHeight?: number;
  } = {}
): Promise<ChoreographyResult> {
  const {
    useGeminiParser = isApiKeyConfigured(),
    dancerCount = 8,
    stageWidth = 12,
    stageHeight = 10,
  } = options;

  const startTime = performance.now();

  // 1. 자연어 파싱
  let request: ChoreographyRequest;
  if (useGeminiParser) {
    request = await parseChoreographyRequest(userInput);
  } else {
    request = parseChoreographyRequestMock(userInput);
  }

  // 2. 대형 좌표 생성
  const startPositions = generateFormation(
    request.startFormation.type as FormationType,
    dancerCount,
    { ...request.startFormation.params, spread: request.style.spread, stageWidth, stageHeight }
  );

  let endPositions = generateFormation(
    request.endFormation.type as FormationType,
    dancerCount,
    { ...request.endFormation.params, spread: request.style.spread, stageWidth, stageHeight }
  );

  // spread 적용
  if (request.style.spread !== 1.0) {
    endPositions = applySpread(endPositions, request.style.spread, stageWidth, stageHeight);
  }

  // 3. 최적 할당 (Hungarian Algorithm)
  const assignments = computeOptimalAssignment(startPositions, endPositions);

  // 4. 경로 계산 (Simple Pathfinder - 직선 + 충돌 회피)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts: request.totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // 5. 시각화용 경로 변환
  const smoothPaths = pathsToSmoothPaths(paths);

  // 6. 충돌 검증
  const validation = validatePathsSimple(paths, 0.5, request.totalCounts);

  // 7. 메타데이터 계산
  const distances = paths.map(p => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // 8. 로컬 미적 평가
  const pathResults = paths.map(p => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(pathResults, request.mainDancer);

  return {
    request,
    startPositions,
    endPositions,
    assignments,
    paths,
    smoothPaths,
    validation,
    aestheticScore,
    metadata,
  };
}

/**
 * 직접 파라미터로 안무 생성
 */
export function generateChoreographyDirect(
  startFormation: FormationType,
  endFormation: FormationType,
  options: {
    dancerCount?: number;
    spread?: number;
    totalCounts?: number;
    mainDancer?: number;
    customStartPositions?: Position[];
    customEndPositions?: Position[];
    stageWidth?: number;
    stageHeight?: number;
  } = {}
): ChoreographyResult {
  const {
    dancerCount = 8,
    spread = 1.0,
    totalCounts = 8,
    mainDancer = null,
    customStartPositions,
    customEndPositions,
    stageWidth = 12,
    stageHeight = 10,
  } = options;

  const startTime = performance.now();

  // 대형 생성 (커스텀 포지션이 있으면 사용)
  const startPositions = customStartPositions || generateFormation(startFormation, dancerCount, { spread, stageWidth, stageHeight });
  const endPositions = customEndPositions || generateFormation(endFormation, dancerCount, { spread, stageWidth, stageHeight });

  // 최적 할당
  const assignments = computeOptimalAssignment(startPositions, endPositions);

  // 경로 계산 (Simple Pathfinder)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // 시각화용 경로 변환
  const smoothPaths = pathsToSmoothPaths(paths);

  // Request 객체 생성
  const request: ChoreographyRequest = {
    startFormation: { type: startFormation },
    endFormation: { type: endFormation },
    constraints: [],
    style: { spread, symmetry: false, smoothness: 0.7, speed: 'normal', dramatic: false },
    mainDancer,
    keyframes: [],
    totalCounts,
    originalInput: '',
  };

  // 검증
  const validation = validatePathsSimple(paths, 0.5, totalCounts);

  // 메타데이터
  const distances = paths.map(p => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // 로컬 평가
  const pathResults = paths.map(p => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(pathResults, mainDancer);

  return {
    request,
    startPositions,
    endPositions,
    assignments,
    paths,
    smoothPaths,
    validation,
    aestheticScore,
    metadata,
  };
}

/**
 * DancerPath를 SmoothPath로 변환
 */
function pathsToSmoothPaths(paths: DancerPath[]): SmoothPath[] {
  return paths.map(p => ({
    dancerId: p.dancerId,
    color: DANCER_COLORS[(p.dancerId - 1) % DANCER_COLORS.length],
    points: p.path,
    startTime: p.startTime,
    speed: p.speed,
    distance: p.totalDistance,
  }));
}

/**
 * 결과를 시각화용 데이터로 변환
 */
export function toVisualizationData(result: ChoreographyResult) {
  return {
    stageWidth: 10,
    stageHeight: 8,
    totalCounts: result.request.totalCounts,
    dancers: result.smoothPaths.map(sp => ({
      id: sp.dancerId,
      color: sp.color,
      startPosition: result.startPositions[sp.dancerId - 1],
      endPosition: result.endPositions[sp.dancerId - 1],
      path: sp.points,
      startTime: sp.startTime,
      speed: sp.speed,
      distance: sp.distance,
    })),
    metadata: result.metadata,
    aestheticScore: result.aestheticScore,
  };
}

/**
 * 결과를 JSON으로 내보내기
 */
export function exportToJSON(result: ChoreographyResult): string {
  return JSON.stringify(toVisualizationData(result), null, 2);
}
