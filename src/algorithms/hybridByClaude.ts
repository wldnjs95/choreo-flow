/**
 * Hybrid By Claude Algorithm v4
 *
 * 핵심 원칙:
 * 1. [Hard Constraint] 충돌 0 보장
 * 2. [Soft Constraint] 경로 교차 최소화 - 다른 댄서의 경로를 가로지르지 않음
 * 3. [Simplicity] 최대한 직선 경로 유지
 * 4. [Visual Sync] 시각적 동기화 지원 (syncMode 옵션)
 *
 * 동기화 모드:
 * - 'strict': 모든 댄서 동시 시작/종료 우선, 곡선으로만 해결 시도
 * - 'balanced': 작은 지연 허용하되 동기화 선호
 * - 'relaxed': 기존 방식 (시간 조절 자유롭게 사용)
 *
 * 알고리즘:
 * 1. 모든 댄서 직선 경로 생성
 * 2. 충돌 해결 (필수)
 * 3. 경로 교차 최소화 (선호)
 */

import type { Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';
import {
  findCollisionTime,
  hasCollision,
  countPathCrossings,
  calculatePathDistance,
  generateLinearPath,
  generateCurvedPath,
} from './utils/pathUtils';

export type SyncMode = 'strict' | 'balanced' | 'relaxed';

export interface HybridByClaudeConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;
  syncMode: SyncMode; // 동기화 모드
}

const DEFAULT_CONFIG: HybridByClaudeConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
  syncMode: 'balanced', // 기본값: 균형 모드
};

// ============================================
// Types
// ============================================

interface CollisionInfo {
  dancer1: number;
  dancer2: number;
  time: number;
}

interface DancerPathInfo {
  dancerId: number;
  assignment: Assignment;
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveOffset: number;
}

// ============================================
// Collision & Crossing Detection
// ============================================

function findAllCollisions(
  paths: DancerPathInfo[],
  collisionRadius: number,
  totalCounts: number
): CollisionInfo[] {
  const collisions: CollisionInfo[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const collisionTime = findCollisionTime(
        paths[i].path,
        paths[j].path,
        collisionRadius,
        totalCounts
      );

      if (collisionTime !== null) {
        collisions.push({
          dancer1: paths[i].dancerId,
          dancer2: paths[j].dancerId,
          time: collisionTime,
        });
      }
    }
  }

  return collisions;
}

function hasCollisionWithOthers(
  dancerPath: PathPoint[],
  otherPaths: DancerPathInfo[],
  collisionRadius: number,
  totalCounts: number
): boolean {
  for (const other of otherPaths) {
    if (hasCollision(dancerPath, other.path, collisionRadius, totalCounts)) {
      return true;
    }
  }
  return false;
}

/**
 * 경로가 다른 경로들과 교차하는 횟수
 */
function countCrossingsWithOthers(
  dancerPath: PathPoint[],
  otherPaths: DancerPathInfo[]
): number {
  let total = 0;
  for (const other of otherPaths) {
    total += countPathCrossings(dancerPath, other.path);
  }
  return total;
}


// ============================================
// Path Candidates (심플 우선)
// ============================================

interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveOffset: number;
  crossings: number;
  syncPenalty: number; // 동기화 페널티 (지연 시간 기반)
}

/**
 * 동기화 모드별 지연/곡선 후보 설정
 */
function getCandidateSettings(syncMode: SyncMode, totalCounts: number) {
  switch (syncMode) {
    case 'strict':
      // 동기화 우선: 지연 최소화, 곡선으로 해결
      return {
        delays: [0], // 지연 없음
        durations: [totalCounts], // 전체 시간 사용
        smallOffsets: [0.5, -0.5, 0.8, -0.8, 1.0, -1.0, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0, 3.5, -3.5, 4.0, -4.0],
        fallbackDelays: [0.3, 0.5, 0.8], // 최후 수단으로만 작은 지연
        syncPenaltyMultiplier: 10, // 지연에 큰 페널티
      };
    case 'balanced':
      // 균형 모드: 작은 지연 허용, 동기화 선호
      return {
        delays: [0, 0.3, 0.5, 0.8, 1.0],
        durations: [totalCounts, totalCounts * 0.9, totalCounts * 0.8],
        smallOffsets: [0.8, -0.8, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0],
        fallbackDelays: [1.5, 2.0, 2.5],
        syncPenaltyMultiplier: 3, // 지연에 중간 페널티
      };
    case 'relaxed':
    default:
      // 기존 방식: 시간 조절 자유
      return {
        delays: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
        durations: [totalCounts, totalCounts * 0.8, totalCounts * 0.7, totalCounts * 0.6],
        smallOffsets: [0.8, -0.8, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0, 3.5, -3.5],
        fallbackDelays: [4.0, 4.5, 5.0],
        syncPenaltyMultiplier: 0.5, // 지연 페널티 낮음
      };
  }
}

/**
 * 경로 후보 생성 및 평가
 * 충돌 없고, 교차 최소인 경로 찾기
 * syncMode에 따라 동기화 우선순위 조절
 */
function findBestPath(
  info: DancerPathInfo,
  otherPaths: DancerPathInfo[],
  cfg: HybridByClaudeConfig
): DancerPathInfo | null {
  const { startPosition, endPosition } = info.assignment;
  const { totalCounts, collisionRadius, numPoints, syncMode } = cfg;
  const settings = getCandidateSettings(syncMode, totalCounts);

  const candidates: PathCandidate[] = [];

  // Phase 1: 동기화된 경로 우선 시도 (delay=0, 전체 시간)
  if (syncMode === 'strict' || syncMode === 'balanced') {
    // 직선 경로 (동기화)
    const syncPath = generateLinearPath(startPosition, endPosition, 0, totalCounts, numPoints);
    if (!hasCollisionWithOthers(syncPath, otherPaths, collisionRadius, totalCounts)) {
      const crossings = countCrossingsWithOthers(syncPath, otherPaths);
      candidates.push({
        path: syncPath,
        startTime: 0,
        endTime: totalCounts,
        curveOffset: 0,
        crossings,
        syncPenalty: 0,
      });
    }

    // 곡선 경로 (동기화, 지연 없음)
    for (const offset of settings.smallOffsets) {
      const path = generateCurvedPath(startPosition, endPosition, 0, totalCounts, numPoints, offset);
      if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
        const crossings = countCrossingsWithOthers(path, otherPaths);
        candidates.push({
          path,
          startTime: 0,
          endTime: totalCounts,
          curveOffset: offset,
          crossings,
          syncPenalty: 0,
        });
      }
    }

    // 큰 곡선 (동기화, 지연 없음)
    for (const offset of settings.largeOffsets) {
      const path = generateCurvedPath(startPosition, endPosition, 0, totalCounts, numPoints, offset);
      if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
        const crossings = countCrossingsWithOthers(path, otherPaths);
        candidates.push({
          path,
          startTime: 0,
          endTime: totalCounts,
          curveOffset: offset,
          crossings,
          syncPenalty: 0,
        });
      }
    }
  }

  // Phase 2: 지연 허용 경로 (syncMode에 따라 페널티 적용)
  for (const delay of settings.delays) {
    for (const dur of settings.durations) {
      const endTime = Math.min(delay + dur, totalCounts);
      if (endTime - delay < 1.5) continue;

      // 직선 경로
      const linearPath = generateLinearPath(startPosition, endPosition, delay, endTime, numPoints);
      if (!hasCollisionWithOthers(linearPath, otherPaths, collisionRadius, totalCounts)) {
        const crossings = countCrossingsWithOthers(linearPath, otherPaths);
        const syncPenalty = delay * settings.syncPenaltyMultiplier;
        candidates.push({
          path: linearPath,
          startTime: delay,
          endTime,
          curveOffset: 0,
          crossings,
          syncPenalty,
        });
      }

      // 작은 곡선
      for (const offset of settings.smallOffsets) {
        const path = generateCurvedPath(startPosition, endPosition, delay, endTime, numPoints, offset);
        if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
          const crossings = countCrossingsWithOthers(path, otherPaths);
          const syncPenalty = delay * settings.syncPenaltyMultiplier;
          candidates.push({
            path,
            startTime: delay,
            endTime,
            curveOffset: offset,
            crossings,
            syncPenalty,
          });
        }
      }
    }
  }

  // Phase 3: 큰 곡선 + 지연 (최후 수단)
  for (const offset of settings.largeOffsets) {
    for (const delay of [...settings.delays, ...settings.fallbackDelays]) {
      const endTime = totalCounts;
      if (endTime - delay < 1.5) continue;

      const path = generateCurvedPath(startPosition, endPosition, delay, endTime, numPoints, offset);
      if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
        const crossings = countCrossingsWithOthers(path, otherPaths);
        const syncPenalty = delay * settings.syncPenaltyMultiplier;
        candidates.push({
          path,
          startTime: delay,
          endTime,
          curveOffset: offset,
          crossings,
          syncPenalty,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 최적 후보 선택 (syncMode에 따라 정렬 기준 변경)
  candidates.sort((a, b) => {
    if (syncMode === 'strict') {
      // Strict: 동기화 > 교차 > 곡선
      if (a.syncPenalty !== b.syncPenalty) return a.syncPenalty - b.syncPenalty;
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      return Math.abs(a.curveOffset) - Math.abs(b.curveOffset);
    } else if (syncMode === 'balanced') {
      // Balanced: 교차 > 동기화+곡선 복합 점수
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      const scoreA = a.syncPenalty + Math.abs(a.curveOffset) * 0.5;
      const scoreB = b.syncPenalty + Math.abs(b.curveOffset) * 0.5;
      return scoreA - scoreB;
    } else {
      // Relaxed: 교차 > 곡선 > 지연
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      if (Math.abs(a.curveOffset) !== Math.abs(b.curveOffset)) {
        return Math.abs(a.curveOffset) - Math.abs(b.curveOffset);
      }
      return a.startTime - b.startTime;
    }
  });

  const best = candidates[0];

  return {
    ...info,
    path: best.path,
    startTime: best.startTime,
    endTime: best.endTime,
    curveOffset: best.curveOffset,
  };
}

// ============================================
// Main Algorithm
// ============================================

export function computeAllPathsWithHybridByClaude(
  assignments: Assignment[],
  config: Partial<HybridByClaudeConfig> = {}
): DancerPath[] {
  const cfg: HybridByClaudeConfig = { ...DEFAULT_CONFIG, ...config };

  console.log('[HybridByClaude v4] Starting path generation');
  console.log(`[HybridByClaude v4] Dancers: ${assignments.length}, totalCounts: ${cfg.totalCounts}`);
  console.log(`[HybridByClaude v4] Sync Mode: ${cfg.syncMode}`);

  // 댄서 정렬: 앞→뒤 이동하는 댄서 우선 (직선 경로 확보)
  // Y값이 클수록 "앞" (무대 앞, 관객쪽), Y값이 작을수록 "뒤" (무대 안쪽)
  // 앞→뒤 = startY > endY (Y 감소 방향)
  const sortedAssignments = [...assignments].sort((a, b) => {
    const aGoingBack = a.startPosition.y > a.endPosition.y; // 앞→뒤
    const bGoingBack = b.startPosition.y > b.endPosition.y; // 앞→뒤

    // 1. 앞→뒤 이동하는 댄서 우선 (직선 경로 확보)
    if (aGoingBack && !bGoingBack) return -1;
    if (!aGoingBack && bGoingBack) return 1;

    // 2. 같은 방향 내에서는 이동 거리가 긴 순서 (옵션이 적으므로)
    return b.distance - a.distance;
  });

  console.log('[HybridByClaude v4] Processing order (front→back first):');
  sortedAssignments.forEach((a, i) => {
    const direction = a.startPosition.y > a.endPosition.y ? 'front→back' : 'back→front';
    console.log(`  ${i + 1}. Dancer ${a.dancerId}: ${direction}, distance=${a.distance.toFixed(2)}`);
  });

  const paths: DancerPathInfo[] = [];

  // Step 1: 순차적으로 경로 생성 (이미 확정된 경로와 충돌/교차 피함)
  for (const assignment of sortedAssignments) {
    const info: DancerPathInfo = {
      dancerId: assignment.dancerId,
      assignment,
      path: [],
      startTime: 0,
      endTime: cfg.totalCounts,
      curveOffset: 0,
    };

    // 최적 경로 찾기 (충돌 없고 교차 최소)
    const bestPath = findBestPath(info, paths, cfg);

    if (bestPath) {
      paths.push(bestPath);
      const crossings = countCrossingsWithOthers(bestPath.path, paths.filter(p => p.dancerId !== bestPath.dancerId));
      console.log(`[HybridByClaude v4] Dancer ${assignment.dancerId}: offset=${bestPath.curveOffset.toFixed(1)}, delay=${bestPath.startTime.toFixed(1)}, crossings=${crossings}`);
    } else {
      // Fallback: 충돌을 피하는 곡선 경로 시도
      console.warn(`[HybridByClaude v4] Dancer ${assignment.dancerId}: No path found, trying aggressive fallback`);

      let fallbackFound = false;

      // syncMode에 따른 fallback 설정
      const extremeOffsets = [4.0, -4.0, 5.0, -5.0, 6.0, -6.0, 7.0, -7.0, 8.0, -8.0];
      const extremeDelays = cfg.syncMode === 'strict'
        ? [0, 0.3, 0.5, 0.8, 1.0] // strict: 지연 최소화
        : cfg.syncMode === 'balanced'
        ? [0, 0.5, 1.0, 1.5, 2.0] // balanced: 적당한 지연
        : [0, 1.0, 2.0, 3.0, 4.0]; // relaxed: 자유로운 지연

      // strict 모드에서는 곡선 우선 (지연 없이 큰 곡선부터 시도)
      if (cfg.syncMode === 'strict') {
        outer: for (const offset of extremeOffsets) {
          for (const delay of extremeDelays) {
            const endTime = cfg.totalCounts;
            if (endTime - delay < 1.0) continue;

            const fallbackPath = generateCurvedPath(
              assignment.startPosition,
              assignment.endPosition,
              delay,
              endTime,
              cfg.numPoints,
              offset
            );

            if (!hasCollisionWithOthers(fallbackPath, paths, cfg.collisionRadius, cfg.totalCounts)) {
              paths.push({
                ...info,
                path: fallbackPath,
                startTime: delay,
                endTime: endTime,
                curveOffset: offset,
              });
              console.log(`[HybridByClaude v4] Dancer ${assignment.dancerId}: Fallback success with offset=${offset}, delay=${delay}`);
              fallbackFound = true;
              break outer;
            }
          }
        }
      } else {
        // balanced/relaxed: 기존 방식 (지연과 곡선 병행)
        outer: for (const offset of extremeOffsets) {
          for (const delay of extremeDelays) {
            const endTime = cfg.totalCounts;
            if (endTime - delay < 1.0) continue;

            const fallbackPath = generateCurvedPath(
              assignment.startPosition,
              assignment.endPosition,
              delay,
              endTime,
              cfg.numPoints,
              offset
            );

            if (!hasCollisionWithOthers(fallbackPath, paths, cfg.collisionRadius, cfg.totalCounts)) {
              paths.push({
                ...info,
                path: fallbackPath,
                startTime: delay,
                endTime: endTime,
                curveOffset: offset,
              });
              console.log(`[HybridByClaude v4] Dancer ${assignment.dancerId}: Fallback success with offset=${offset}, delay=${delay}`);
              fallbackFound = true;
              break outer;
            }
          }
        }
      }

      if (!fallbackFound) {
        // 최후의 수단: 극단적인 곡선과 지연
        console.error(`[HybridByClaude v4] Dancer ${assignment.dancerId}: All fallbacks failed, using extreme path`);

        const extremeOffset = (assignment.dancerId % 2 === 0 ? 10.0 : -10.0);
        const extremeDelay = cfg.syncMode === 'strict' ? 0.5 : cfg.totalCounts * 0.4;
        const extremePath = generateCurvedPath(
          assignment.startPosition,
          assignment.endPosition,
          extremeDelay,
          cfg.totalCounts,
          cfg.numPoints,
          extremeOffset
        );

        paths.push({
          ...info,
          path: extremePath,
          startTime: extremeDelay,
          endTime: cfg.totalCounts,
          curveOffset: extremeOffset,
        });
      }
    }
  }

  // Step 2: 최종 검증 및 충돌 해결
  const MAX_FIX_ITERATIONS = 50;

  for (let iter = 0; iter < MAX_FIX_ITERATIONS; iter++) {
    const collisions = findAllCollisions(paths, cfg.collisionRadius, cfg.totalCounts);

    if (collisions.length === 0) {
      console.log(`[HybridByClaude v4] All collisions resolved after ${iter} fix iterations`);
      break;
    }

    console.log(`[HybridByClaude v4] Fix iteration ${iter}: ${collisions.length} collision(s)`);

    // 충돌 해결
    const collision = collisions[0];
    const idx1 = paths.findIndex(p => p.dancerId === collision.dancer1);
    const idx2 = paths.findIndex(p => p.dancerId === collision.dancer2);

    if (idx1 < 0 || idx2 < 0) continue;

    const dancer1 = paths[idx1];
    const dancer2 = paths[idx2];

    // Y좌표가 작은(뒤쪽) 댄서를 수정
    const y1 = dancer1.assignment.startPosition.y;
    const y2 = dancer2.assignment.startPosition.y;
    const [toFixIdx, toFix] = y1 < y2 ? [idx1, dancer1] : [idx2, dancer2];

    const otherPaths = paths.filter((_, i) => i !== toFixIdx);
    const fixed = findBestPath(toFix, otherPaths, cfg);

    if (fixed) {
      paths[toFixIdx] = fixed;
    } else {
      // 강제 큰 곡선
      const forcedOffset = 5.0 * (y1 < y2 ? 1 : -1);
      const forcedPath = generateCurvedPath(
        toFix.assignment.startPosition,
        toFix.assignment.endPosition,
        cfg.totalCounts * 0.3,
        cfg.totalCounts,
        cfg.numPoints,
        forcedOffset
      );

      paths[toFixIdx] = {
        ...toFix,
        path: forcedPath,
        startTime: cfg.totalCounts * 0.3,
        endTime: cfg.totalCounts,
        curveOffset: forcedOffset,
      };
    }
  }

  // Step 3: 최종 통계
  const finalCollisions = findAllCollisions(paths, cfg.collisionRadius, cfg.totalCounts);
  const linearCount = paths.filter(p => p.curveOffset === 0).length;
  const syncedCount = paths.filter(p => p.startTime === 0).length;
  const avgDelay = paths.reduce((sum, p) => sum + p.startTime, 0) / paths.length;
  const maxDelay = Math.max(...paths.map(p => p.startTime));

  let totalCrossings = 0;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      totalCrossings += countPathCrossings(paths[i].path, paths[j].path);
    }
  }

  console.log(`[HybridByClaude v4] Summary (syncMode: ${cfg.syncMode}):`);
  console.log(`  - Total dancers: ${paths.length}`);
  console.log(`  - Synced paths (delay=0): ${syncedCount} (${(syncedCount / paths.length * 100).toFixed(0)}%)`);
  console.log(`  - Avg delay: ${avgDelay.toFixed(2)}, Max delay: ${maxDelay.toFixed(2)}`);
  console.log(`  - Linear paths: ${linearCount}`);
  console.log(`  - Curved paths: ${paths.length - linearCount}`);
  console.log(`  - Total crossings: ${totalCrossings}`);
  console.log(`  - Final collisions: ${finalCollisions.length}`);

  if (finalCollisions.length > 0) {
    console.error(`[HybridByClaude v4] FAILED: ${finalCollisions.length} collision(s) remaining`);
  }

  // 결과 반환
  return paths.map(p => {
    const pathDist = calculatePathDistance(p.path);
    const duration = p.endTime - p.startTime;
    const speed = duration > 0 ? pathDist / duration : 1.0;

    return {
      dancerId: p.dancerId,
      path: p.path,
      startTime: p.startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance: pathDist,
    };
  }).sort((a, b) => a.dancerId - b.dancerId);
}

/**
 * Validate paths
 */
export function validateHybridByClaudePaths(
  paths: DancerPath[],
  collisionRadius: number,
  totalCounts: number
): { valid: boolean; collisions: { dancer1: number; dancer2: number; time: number }[] } {
  const collisions: { dancer1: number; dancer2: number; time: number }[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const collisionTime = findCollisionTime(
        paths[i].path,
        paths[j].path,
        collisionRadius,
        totalCounts
      );

      if (collisionTime !== null) {
        collisions.push({
          dancer1: paths[i].dancerId,
          dancer2: paths[j].dancerId,
          time: collisionTime,
        });
      }
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}
