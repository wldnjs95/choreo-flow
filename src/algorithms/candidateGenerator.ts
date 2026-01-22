/**
 * 다중 후보 생성기 (Candidate Generator)
 *
 * 전략:
 * 1. 다양한 파라미터 조합으로 여러 경로 후보 생성
 * 2. 각 후보의 메트릭 계산
 * 3. Gemini가 메트릭 기반으로 최적 후보 선택
 */

import { computeOptimalAssignment } from './hungarian';
import type { Position, Assignment } from './hungarian';
import { computeAllPathsSimple, validatePathsSimple } from './pathfinder';
import type { DancerPath, PathPoint, SortStrategy } from './pathfinder';

/**
 * 후보 생성 전략
 */
export type CandidateStrategy =
  | 'distance_longest_first'   // 긴 거리 우선 처리 (기본)
  | 'distance_shortest_first'  // 짧은 거리 우선 처리
  | 'timing_priority'          // 타이밍 조정 우선 (곡선 최소화)
  | 'curve_allowed'            // 곡선 허용 (타이밍 고정)
  | 'center_priority';         // 센터 dancer 우선 처리

/**
 * 후보 메트릭
 */
export interface CandidateMetrics {
  collisionCount: number;      // 충돌 횟수 (0이 최고)
  symmetryScore: number;       // 대칭성 점수 (0-100)
  pathSmoothness: number;      // 경로 부드러움 (0-100, 직선일수록 높음)
  crossingCount: number;       // 경로 교차 횟수
  maxDelay: number;            // 최대 출발 지연 시간
  avgDelay: number;            // 평균 출발 지연 시간
  simultaneousArrival: number; // 동시 도착 점수 (0-100)
  totalDistance: number;       // 총 이동 거리
}

/**
 * 후보 결과
 */
export interface CandidateResult {
  id: string;
  strategy: CandidateStrategy;
  paths: DancerPath[];
  metrics: CandidateMetrics;
  assignments: Assignment[];
}

/**
 * 다중 후보 생성 설정
 */
export interface CandidateGeneratorConfig {
  strategies: CandidateStrategy[];
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
}

const DEFAULT_STRATEGIES: CandidateStrategy[] = [
  'distance_longest_first',
  'distance_shortest_first',
  'timing_priority',
  'curve_allowed',
  'center_priority',
];

/**
 * 두 점 사이 거리
 */
function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * 두 경로 배열이 동일한지 비교 (허용 오차 포함)
 */
function arePathsEqual(paths1: DancerPath[], paths2: DancerPath[], tolerance: number = 0.01): boolean {
  if (paths1.length !== paths2.length) return false;

  // dancerId로 정렬해서 비교
  const sorted1 = [...paths1].sort((a, b) => a.dancerId - b.dancerId);
  const sorted2 = [...paths2].sort((a, b) => a.dancerId - b.dancerId);

  for (let i = 0; i < sorted1.length; i++) {
    const p1 = sorted1[i];
    const p2 = sorted2[i];

    if (p1.dancerId !== p2.dancerId) return false;
    if (Math.abs(p1.startTime - p2.startTime) > tolerance) return false;
    if (p1.path.length !== p2.path.length) return false;

    // 경로의 주요 포인트 비교 (시작, 중간, 끝)
    const checkIndices = [0, Math.floor(p1.path.length / 2), p1.path.length - 1];
    for (const idx of checkIndices) {
      if (idx < p1.path.length && idx < p2.path.length) {
        const pt1 = p1.path[idx];
        const pt2 = p2.path[idx];
        if (Math.abs(pt1.x - pt2.x) > tolerance || Math.abs(pt1.y - pt2.y) > tolerance) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * 경로의 곡률 계산 (직선에서 얼마나 벗어났는지)
 */
function calculatePathCurvature(path: PathPoint[]): number {
  if (path.length < 3) return 0;

  const start = path[0];
  const end = path[path.length - 1];
  const directDistance = distance(start, end);

  if (directDistance === 0) return 0;

  let maxDeviation = 0;
  for (let i = 1; i < path.length - 1; i++) {
    // 점에서 직선까지의 거리 계산
    const t = ((path[i].x - start.x) * (end.x - start.x) +
               (path[i].y - start.y) * (end.y - start.y)) / (directDistance * directDistance);
    const projX = start.x + t * (end.x - start.x);
    const projY = start.y + t * (end.y - start.y);
    const deviation = distance(path[i], { x: projX, y: projY });
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return maxDeviation;
}

/**
 * 경로 교차 횟수 계산
 */
function countPathCrossings(paths: DancerPath[], totalCounts: number): number {
  let crossings = 0;
  const timeStep = 0.5;

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      // 두 경로가 교차하는지 검사
      let prevOrder: number | null = null;

      for (let t = 0; t <= totalCounts; t += timeStep) {
        const pos1 = getPositionAtTime(paths[i].path, t);
        const pos2 = getPositionAtTime(paths[j].path, t);

        if (!pos1 || !pos2) continue;

        // X 좌표 기준 순서
        const currentOrder = pos1.x < pos2.x ? 1 : -1;

        if (prevOrder !== null && prevOrder !== currentOrder) {
          crossings++;
        }
        prevOrder = currentOrder;
      }
    }
  }

  return crossings;
}

/**
 * 특정 시간의 위치 보간
 */
function getPositionAtTime(path: PathPoint[], time: number): Position | null {
  if (path.length === 0) return null;
  if (time <= path[0].t) return { x: path[0].x, y: path[0].y };
  if (time >= path[path.length - 1].t) {
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }

  for (let i = 0; i < path.length - 1; i++) {
    if (time >= path[i].t && time <= path[i + 1].t) {
      const ratio = (time - path[i].t) / (path[i + 1].t - path[i].t);
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * ratio,
        y: path[i].y + (path[i + 1].y - path[i].y) * ratio,
      };
    }
  }
  return null;
}

/**
 * 대칭성 점수 계산
 */
function calculateSymmetryScore(paths: DancerPath[], stageWidth: number, totalCounts: number): number {
  const centerX = stageWidth / 2;
  let totalSymmetry = 0;
  let sampleCount = 0;

  for (let t = 0; t <= totalCounts; t += 1) {
    const positions = paths.map(p => getPositionAtTime(p.path, t)).filter(Boolean) as Position[];

    if (positions.length === 0) continue;

    // 각 위치에 대해 중심선 기준 대칭 위치에 dancer가 있는지 확인
    let matchedPairs = 0;
    const used = new Set<number>();

    for (let i = 0; i < positions.length; i++) {
      if (used.has(i)) continue;

      const mirrorX = 2 * centerX - positions[i].x;

      // 대칭 위치에 가장 가까운 dancer 찾기
      let bestMatch = -1;
      let bestDist = Infinity;

      for (let j = 0; j < positions.length; j++) {
        if (i === j || used.has(j)) continue;

        const dist = distance(positions[j], { x: mirrorX, y: positions[i].y });
        if (dist < bestDist && dist < 1.0) { // 1m 이내면 대칭으로 인정
          bestDist = dist;
          bestMatch = j;
        }
      }

      if (bestMatch !== -1) {
        matchedPairs++;
        used.add(i);
        used.add(bestMatch);
      }
    }

    const symmetryRatio = positions.length > 1
      ? (matchedPairs * 2) / positions.length
      : 1;
    totalSymmetry += symmetryRatio;
    sampleCount++;
  }

  return sampleCount > 0 ? Math.round((totalSymmetry / sampleCount) * 100) : 0;
}

/**
 * 동시 도착 점수 계산
 */
function calculateSimultaneousArrivalScore(paths: DancerPath[], totalCounts: number): number {
  if (paths.length === 0) return 100;

  // 각 dancer의 도착 시간 (마지막으로 움직인 시간)
  const arrivalTimes = paths.map(p => {
    const lastPoint = p.path[p.path.length - 1];
    return lastPoint ? lastPoint.t : totalCounts;
  });

  const maxArrival = Math.max(...arrivalTimes);
  const minArrival = Math.min(...arrivalTimes);
  const spread = maxArrival - minArrival;

  // spread가 0이면 완벽한 동시 도착
  // spread가 totalCounts면 최악
  const score = Math.max(0, 100 - (spread / totalCounts) * 100);
  return Math.round(score);
}

/**
 * 메트릭 계산
 */
export function calculateMetrics(
  paths: DancerPath[],
  totalCounts: number,
  collisionRadius: number,
  stageWidth: number
): CandidateMetrics {
  // 충돌 검사
  const validation = validatePathsSimple(paths, collisionRadius, totalCounts);

  // 경로 부드러움 (곡률의 역수)
  const curvatures = paths.map(p => calculatePathCurvature(p.path));
  const avgCurvature = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
  const smoothness = Math.max(0, Math.round(100 - avgCurvature * 50));

  // 교차 횟수
  const crossingCount = countPathCrossings(paths, totalCounts);

  // 지연 시간
  const delays = paths.map(p => p.startTime);
  const maxDelay = Math.max(...delays);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

  // 대칭성
  const symmetryScore = calculateSymmetryScore(paths, stageWidth, totalCounts);

  // 동시 도착
  const simultaneousArrival = calculateSimultaneousArrivalScore(paths, totalCounts);

  // 총 거리
  const totalDistance = paths.reduce((sum, p) => sum + p.totalDistance, 0);

  return {
    collisionCount: validation.collisions.length,
    symmetryScore,
    pathSmoothness: smoothness,
    crossingCount,
    maxDelay,
    avgDelay,
    simultaneousArrival,
    totalDistance,
  };
}

/**
 * 전략별 Assignment 정렬 (center_priority 전용)
 * 다른 전략들은 pathfinder의 sortStrategy로 처리
 */
function sortAssignmentsForCenterPriority(
  assignments: Assignment[],
  stageWidth: number,
  stageHeight: number
): Assignment[] {
  const sorted = [...assignments];
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;

  // 센터에 가까운 dancer 우선
  sorted.sort((a, b) => {
    const distA = distance(a.startPosition, { x: centerX, y: centerY });
    const distB = distance(b.startPosition, { x: centerX, y: centerY });
    return distA - distB;
  });

  return sorted;
}

/**
 * 전략별 Pathfinder 설정
 */
function getPathfinderConfig(strategy: CandidateStrategy, totalCounts: number) {
  const baseConfig = {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  };

  switch (strategy) {
    case 'distance_longest_first':
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
      };

    case 'distance_shortest_first':
      return {
        ...baseConfig,
        sortStrategy: 'distance_shortest_first' as SortStrategy,
      };

    case 'center_priority':
      // center_priority는 assignment 자체를 정렬해서 전달하므로 none 사용
      return {
        ...baseConfig,
        sortStrategy: 'none' as SortStrategy,
      };

    case 'timing_priority':
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        preferTiming: true,
        maxCurveOffset: 0.2,   // 곡선 최소화
      };

    case 'curve_allowed':
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        preferTiming: false,
        maxCurveOffset: 0.8,   // 더 큰 곡선 허용
      };

    default:
      return baseConfig;
  }
}

/**
 * 단일 후보 생성
 */
export function generateCandidate(
  strategy: CandidateStrategy,
  startPositions: Position[],
  endPositions: Position[],
  config: {
    totalCounts: number;
    collisionRadius: number;
    stageWidth: number;
    stageHeight: number;
  }
): CandidateResult {
  // 1. 최적 할당 (Hungarian)
  const assignments = computeOptimalAssignment(startPositions, endPositions);

  // 2. center_priority 전략만 assignment 정렬, 나머지는 pathfinder가 처리
  const processedAssignments = strategy === 'center_priority'
    ? sortAssignmentsForCenterPriority(assignments, config.stageWidth, config.stageHeight)
    : assignments;

  // 3. 경로 생성 (전략별 sortStrategy 포함)
  const pathfinderConfig = getPathfinderConfig(strategy, config.totalCounts);
  const paths = computeAllPathsSimple(processedAssignments, pathfinderConfig);

  // 4. 메트릭 계산
  const metrics = calculateMetrics(
    paths,
    config.totalCounts,
    config.collisionRadius,
    config.stageWidth
  );

  return {
    id: `candidate_${strategy}`,
    strategy,
    paths,
    metrics,
    assignments,
  };
}

/**
 * 모든 전략으로 후보 생성 (중복 제거)
 */
export function generateAllCandidates(
  startPositions: Position[],
  endPositions: Position[],
  config: Partial<CandidateGeneratorConfig> = {}
): CandidateResult[] {
  const fullConfig: CandidateGeneratorConfig = {
    strategies: config.strategies || DEFAULT_STRATEGIES,
    totalCounts: config.totalCounts || 8,
    collisionRadius: config.collisionRadius || 0.5,
    stageWidth: config.stageWidth || 12,
    stageHeight: config.stageHeight || 10,
  };

  const allCandidates: CandidateResult[] = [];

  for (const strategy of fullConfig.strategies) {
    const candidate = generateCandidate(strategy, startPositions, endPositions, {
      totalCounts: fullConfig.totalCounts,
      collisionRadius: fullConfig.collisionRadius,
      stageWidth: fullConfig.stageWidth,
      stageHeight: fullConfig.stageHeight,
    });
    allCandidates.push(candidate);
  }

  // 중복 제거: 동일한 경로를 가진 후보는 첫 번째만 유지
  const uniqueCandidates: CandidateResult[] = [];
  for (const candidate of allCandidates) {
    const isDuplicate = uniqueCandidates.some(existing =>
      arePathsEqual(existing.paths, candidate.paths)
    );
    if (!isDuplicate) {
      uniqueCandidates.push(candidate);
    }
  }

  // 충돌 없는 후보 우선, 그 다음 교차 적은 순
  uniqueCandidates.sort((a, b) => {
    if (a.metrics.collisionCount !== b.metrics.collisionCount) {
      return a.metrics.collisionCount - b.metrics.collisionCount;
    }
    return a.metrics.crossingCount - b.metrics.crossingCount;
  });

  return uniqueCandidates;
}

/**
 * 메트릭 요약 (Gemini용)
 */
export function summarizeCandidatesForGemini(candidates: CandidateResult[]): object {
  return {
    candidates: candidates.map(c => ({
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
    })),
  };
}
