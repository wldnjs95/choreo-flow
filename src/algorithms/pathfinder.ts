/**
 * 간단한 경로 생성기 (Simple Pathfinder)
 *
 * 전략:
 * 1. 기본적으로 직선 경로 사용 (가장 효율적)
 * 2. 충돌 감지 시 타이밍 조정 (startTime)
 * 3. 여전히 충돌 시 약간의 곡선 추가
 *
 * A*보다 단순하지만 안무에 더 적합한 자연스러운 경로 생성
 */

import type { Position, Assignment } from './hungarian';

export interface PathPoint {
  x: number;
  y: number;
  t: number;
}

export interface DancerPath {
  dancerId: number;
  path: PathPoint[];
  startTime: number;
  speed: number;
  totalDistance: number;
}

/**
 * 정렬 전략 (경로 처리 순서 결정)
 */
export type SortStrategy =
  | 'distance_longest_first'   // 긴 거리 우선 (기본)
  | 'distance_shortest_first'  // 짧은 거리 우선
  | 'none';                    // 정렬 없음 (입력 순서 유지)

export interface PathfinderConfig {
  totalCounts: number;
  collisionRadius: number;
  numPoints: number;  // 경로당 포인트 수
  sortStrategy?: SortStrategy;  // 정렬 전략 (기본: distance_longest_first)
  maxCurveOffset?: number;      // 곡선 최대 offset (기본: 0.5)
  preferTiming?: boolean;       // 타이밍 조정 우선 (기본: true)
}

const DEFAULT_CONFIG: PathfinderConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  numPoints: 20,
};

/**
 * 두 점 사이의 거리
 */
function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * 직선 경로 생성
 */
function generateLinearPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number
): PathPoint[] {
  const path: PathPoint[] = [];

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    path.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      t: time,
    });
  }

  return path;
}

/**
 * 경로의 특정 시간에서의 위치 보간
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
 * 두 경로가 특정 시간에 충돌하는지 검사
 */
function checkCollisionAtTime(
  path1: PathPoint[],
  path2: PathPoint[],
  time: number,
  collisionRadius: number
): boolean {
  const pos1 = getPositionAtTime(path1, time);
  const pos2 = getPositionAtTime(path2, time);

  if (!pos1 || !pos2) return false;

  return distance(pos1, pos2) < collisionRadius * 2;
}

/**
 * 두 경로 간 충돌 검사 (전체 시간)
 */
function hasCollision(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): boolean {
  // 0.25 count 간격으로 검사
  for (let t = 0; t <= totalCounts; t += 0.25) {
    if (checkCollisionAtTime(path1, path2, t, collisionRadius)) {
      return true;
    }
  }
  return false;
}

/**
 * 약간의 곡선을 추가한 경로 생성
 * offset: 중간점이 직선에서 벗어나는 정도
 */
function generateCurvedPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  curveOffset: number,  // 양수: 오른쪽으로 휨, 음수: 왼쪽으로 휨
): PathPoint[] {
  const path: PathPoint[] = [];

  // 중간점 계산 (직선에서 수직 방향으로 offset)
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // 직선의 수직 방향
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // 수직 벡터 (정규화)
  const perpX = -dy / len;
  const perpY = dx / len;

  // offset이 적용된 중간점
  const ctrlX = midX + perpX * curveOffset;
  const ctrlY = midY + perpY * curveOffset;

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    // 2차 베지어 곡선: (1-t)²P0 + 2(1-t)tP1 + t²P2
    const oneMinusT = 1 - t;
    const x = oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * ctrlX + t * t * end.x;
    const y = oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * ctrlY + t * t * end.y;

    path.push({ x, y, t: time });
  }

  return path;
}

/**
 * 모든 dancer의 경로 계산
 *
 * 전략:
 * 1. 모든 dancer는 0에서 출발, 거리에 비례한 시간에 도착 (빨리 도착해도 OK)
 * 2. 충돌 시에만 타이밍 조정
 * 3. 여전히 충돌하면 최소한의 곡선 추가
 */
export function computeAllPathsSimple(
  assignments: Assignment[],
  config: Partial<PathfinderConfig> = {}
): DancerPath[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: DancerPath[] = [];

  // 정렬 전략에 따라 처리 순서 결정
  let sorted: Assignment[];
  const sortStrategy = cfg.sortStrategy || 'distance_longest_first';

  switch (sortStrategy) {
    case 'distance_shortest_first':
      sorted = [...assignments].sort((a, b) => a.distance - b.distance);
      break;
    case 'none':
      sorted = [...assignments];  // 입력 순서 유지
      break;
    case 'distance_longest_first':
    default:
      sorted = [...assignments].sort((a, b) => b.distance - a.distance);
      break;
  }

  // 이미 계산된 경로들
  const computedPaths: { dancerId: number; path: PathPoint[] }[] = [];

  // 최대 거리 계산 (속도 기준)
  const maxDist = Math.max(...assignments.map(a => a.distance));

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    // 모든 dancer는 0에서 시작
    let startTime = 0;

    // 도착 시간: 거리에 비례 (짧은 거리 = 빨리 도착)
    // 최소 endTime은 2 (너무 빨리 끝나지 않도록)
    const baseSpeed = maxDist / cfg.totalCounts;  // 최대거리 dancer의 속도
    let endTime = baseSpeed > 0 ? Math.max(2, dist / baseSpeed) : cfg.totalCounts;

    // endTime이 totalCounts보다 크면 조정
    if (endTime > cfg.totalCounts) {
      endTime = cfg.totalCounts;
    }

    // 기본 직선 경로 생성
    let path = generateLinearPath(startPosition, endPosition, startTime, endTime, cfg.numPoints);

    // 기존 경로들과 충돌 검사
    let hasConflict = false;

    for (const computed of computedPaths) {
      if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
        hasConflict = true;
        break;
      }
    }

    // 충돌이 있으면 해결 시도 (곡선 최소화 - 타이밍으로 최대한 해결)
    if (hasConflict) {
      const originalEndTime = endTime;

      // 방법 1: 빨리 지나가기 (endTime 줄이기)
      for (const factor of [0.6, 0.5, 0.4, 0.3]) {
        const newEndTime = Math.max(1, originalEndTime * factor);
        path = generateLinearPath(startPosition, endPosition, 0, newEndTime, cfg.numPoints);

        hasConflict = false;
        for (const computed of computedPaths) {
          if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
            hasConflict = true;
            break;
          }
        }

        if (!hasConflict) {
          startTime = 0;
          endTime = newEndTime;
          break;
        }
      }

      // 방법 2: 늦게 출발하기 (다양한 delay)
      if (hasConflict) {
        for (let delay = 0.5; delay <= 4 && hasConflict; delay += 0.5) {
          // 늦게 출발 + 같은 속도
          const newStartTime = delay;
          const duration = originalEndTime;
          const newEndTime = Math.min(newStartTime + duration, cfg.totalCounts);
          path = generateLinearPath(startPosition, endPosition, newStartTime, newEndTime, cfg.numPoints);

          hasConflict = false;
          for (const computed of computedPaths) {
            if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
              hasConflict = true;
              break;
            }
          }

          if (!hasConflict) {
            startTime = newStartTime;
            endTime = newEndTime;
          }
        }
      }

      // 방법 3: 늦게 출발 + 빨리 이동 조합
      if (hasConflict) {
        for (const delay of [1, 2, 3]) {
          for (const speedFactor of [0.5, 0.4, 0.3]) {
            const newStartTime = delay;
            const newEndTime = Math.min(newStartTime + originalEndTime * speedFactor, cfg.totalCounts);
            path = generateLinearPath(startPosition, endPosition, newStartTime, newEndTime, cfg.numPoints);

            hasConflict = false;
            for (const computed of computedPaths) {
              if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
                hasConflict = true;
                break;
              }
            }

            if (!hasConflict) {
              startTime = newStartTime;
              endTime = newEndTime;
              break;
            }
          }
          if (!hasConflict) break;
        }
      }

      // 방법 4: 마지막 수단 - 최소한의 곡선 (maxCurveOffset으로 제한)
      if (hasConflict) {
        const maxOffset = cfg.maxCurveOffset ?? 0.5;
        const curveOffsets = [0.2, -0.2, 0.35, -0.35, 0.5, -0.5].filter(o => Math.abs(o) <= maxOffset);
        for (const offset of curveOffsets) {
          path = generateCurvedPath(startPosition, endPosition, startTime, endTime, cfg.numPoints, offset);

          hasConflict = false;
          for (const computed of computedPaths) {
            if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
              hasConflict = true;
              break;
            }
          }

          if (!hasConflict) break;
        }
      }
    }

    // 속도 계산
    const pathDistance = calculatePathDistance(path);
    const duration = endTime - startTime;
    const speed = duration > 0 ? pathDistance / duration / (maxDist / cfg.totalCounts || 1) : 1;

    computedPaths.push({ dancerId, path });

    results.push({
      dancerId,
      path,
      startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance: pathDistance,
    });
  }

  // dancerId 순으로 정렬
  return results.sort((a, b) => a.dancerId - b.dancerId);
}

/**
 * 경로 거리 계산
 */
function calculatePathDistance(path: PathPoint[]): number {
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    dist += distance(path[i - 1], path[i]);
  }
  return dist;
}

/**
 * 경로 검증
 */
export function validatePathsSimple(
  paths: DancerPath[],
  collisionRadius: number = 0.5,
  totalCounts: number = 8
): { valid: boolean; collisions: { dancer1: number; dancer2: number; time: number }[] } {
  const collisions: { dancer1: number; dancer2: number; time: number }[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      for (let t = 0; t <= totalCounts; t += 0.25) {
        if (checkCollisionAtTime(paths[i].path, paths[j].path, t, collisionRadius)) {
          collisions.push({
            dancer1: paths[i].dancerId,
            dancer2: paths[j].dancerId,
            time: t,
          });
          break;  // 같은 쌍에서 하나만 기록
        }
      }
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}
