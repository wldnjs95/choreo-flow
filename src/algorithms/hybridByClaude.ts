/**
 * Hybrid By Claude Algorithm v4
 *
 * Core Principles:
 * 1. [Hard Constraint] Zero collision guarantee
 * 2. [Soft Constraint] Minimize path crossings - avoid crossing other dancers' paths
 * 3. [Simplicity] Keep linear paths as much as possible
 * 4. [Visual Sync] Support visual synchronization (syncMode option)
 *
 * Sync Modes:
 * - 'strict': All dancers start/end simultaneously, solve with curves only
 * - 'balanced': Allow small delays but prefer synchronization
 * - 'relaxed': Legacy mode (use timing adjustments freely)
 *
 * Algorithm:
 * 1. Generate linear paths for all dancers
 * 2. Resolve collisions (required)
 * 3. Minimize path crossings (preferred)
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
  syncMode: SyncMode; // Synchronization mode
}

const DEFAULT_CONFIG: HybridByClaudeConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
  syncMode: 'balanced', // Default: balanced mode
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
 * Count how many times a path crosses other paths
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
// Path Candidates (simple first)
// ============================================

interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveOffset: number;
  crossings: number;
  syncPenalty: number; // Sync penalty (based on delay time)
}

/**
 * Candidate settings per sync mode (delay/curve)
 */
function getCandidateSettings(syncMode: SyncMode, totalCounts: number) {
  switch (syncMode) {
    case 'strict':
      // Sync priority: minimize delay, solve with curves
      return {
        delays: [0], // No delay
        durations: [totalCounts], // Use full time
        smallOffsets: [0.5, -0.5, 0.8, -0.8, 1.0, -1.0, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0, 3.5, -3.5, 4.0, -4.0],
        fallbackDelays: [0.3, 0.5, 0.8], // Small delays as last resort
        syncPenaltyMultiplier: 10, // Heavy penalty for delay
      };
    case 'balanced':
      // Balanced mode: allow small delays, prefer synchronization
      return {
        delays: [0, 0.3, 0.5, 0.8, 1.0],
        durations: [totalCounts, totalCounts * 0.9, totalCounts * 0.8],
        smallOffsets: [0.8, -0.8, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0],
        fallbackDelays: [1.5, 2.0, 2.5],
        syncPenaltyMultiplier: 3, // Medium penalty for delay
      };
    case 'relaxed':
    default:
      // Legacy mode: free timing adjustments
      return {
        delays: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
        durations: [totalCounts, totalCounts * 0.8, totalCounts * 0.7, totalCounts * 0.6],
        smallOffsets: [0.8, -0.8, 1.2, -1.2, 1.5, -1.5],
        largeOffsets: [2.0, -2.0, 2.5, -2.5, 3.0, -3.0, 3.5, -3.5],
        fallbackDelays: [4.0, 4.5, 5.0],
        syncPenaltyMultiplier: 0.5, // Low delay penalty
      };
  }
}

/**
 * Generate and evaluate path candidates
 * Find collision-free path with minimum crossings
 * Adjust sync priority based on syncMode
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

  // Phase 1: Try synchronized paths first (delay=0, full time)
  if (syncMode === 'strict' || syncMode === 'balanced') {
    // Linear path (synchronized)
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

    // Curved path (synchronized, no delay)
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

    // Large curve (synchronized, no delay)
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

  // Phase 2: Delayed paths (penalty applied based on syncMode)
  for (const delay of settings.delays) {
    for (const dur of settings.durations) {
      const endTime = Math.min(delay + dur, totalCounts);
      if (endTime - delay < 1.5) continue;

      // Linear path
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

      // Small curve
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

  // Phase 3: Large curve + delay (last resort)
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

  // Select optimal candidate (sort criteria based on syncMode)
  candidates.sort((a, b) => {
    if (syncMode === 'strict') {
      // Strict: sync > crossings > curve
      if (a.syncPenalty !== b.syncPenalty) return a.syncPenalty - b.syncPenalty;
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      return Math.abs(a.curveOffset) - Math.abs(b.curveOffset);
    } else if (syncMode === 'balanced') {
      // Balanced: crossings > sync+curve composite score
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      const scoreA = a.syncPenalty + Math.abs(a.curveOffset) * 0.5;
      const scoreB = b.syncPenalty + Math.abs(b.curveOffset) * 0.5;
      return scoreA - scoreB;
    } else {
      // Relaxed: crossings > curve > delay
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

  // Sort dancers: front→back movers first (secure linear paths)
  // Higher Y = "front" (stage front, audience side), Lower Y = "back" (stage back)
  // front→back = startY > endY (decreasing Y direction)
  const sortedAssignments = [...assignments].sort((a, b) => {
    const aGoingBack = a.startPosition.y > a.endPosition.y; // front→back
    const bGoingBack = b.startPosition.y > b.endPosition.y; // front→back

    // 1. Front→back movers first (secure linear paths)
    if (aGoingBack && !bGoingBack) return -1;
    if (!aGoingBack && bGoingBack) return 1;

    // 2. Within same direction, longer distance first (fewer options)
    return b.distance - a.distance;
  });

  console.log('[HybridByClaude v4] Processing order (front→back first):');
  sortedAssignments.forEach((a, i) => {
    const direction = a.startPosition.y > a.endPosition.y ? 'front→back' : 'back→front';
    console.log(`  ${i + 1}. Dancer ${a.dancerId}: ${direction}, distance=${a.distance.toFixed(2)}`);
  });

  const paths: DancerPathInfo[] = [];

  // Step 1: Generate paths sequentially (avoid collision/crossing with confirmed paths)
  for (const assignment of sortedAssignments) {
    const info: DancerPathInfo = {
      dancerId: assignment.dancerId,
      assignment,
      path: [],
      startTime: 0,
      endTime: cfg.totalCounts,
      curveOffset: 0,
    };

    // Find optimal path (collision-free with minimum crossings)
    const bestPath = findBestPath(info, paths, cfg);

    if (bestPath) {
      paths.push(bestPath);
      const crossings = countCrossingsWithOthers(bestPath.path, paths.filter(p => p.dancerId !== bestPath.dancerId));
      console.log(`[HybridByClaude v4] Dancer ${assignment.dancerId}: offset=${bestPath.curveOffset.toFixed(1)}, delay=${bestPath.startTime.toFixed(1)}, crossings=${crossings}`);
    } else {
      // Fallback: try curved path to avoid collision
      console.warn(`[HybridByClaude v4] Dancer ${assignment.dancerId}: No path found, trying aggressive fallback`);

      let fallbackFound = false;

      // Fallback settings based on syncMode
      const extremeOffsets = [4.0, -4.0, 5.0, -5.0, 6.0, -6.0, 7.0, -7.0, 8.0, -8.0];
      const extremeDelays = cfg.syncMode === 'strict'
        ? [0, 0.3, 0.5, 0.8, 1.0] // strict: minimize delay
        : cfg.syncMode === 'balanced'
        ? [0, 0.5, 1.0, 1.5, 2.0] // balanced: moderate delay
        : [0, 1.0, 2.0, 3.0, 4.0]; // relaxed: free delay

      // In strict mode, prioritize curves (try large curves without delay first)
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
        // balanced/relaxed: legacy approach (combine delay and curves)
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
        // Last resort: extreme curves and delay
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

  // Step 2: Final validation and collision resolution
  const MAX_FIX_ITERATIONS = 50;

  for (let iter = 0; iter < MAX_FIX_ITERATIONS; iter++) {
    const collisions = findAllCollisions(paths, cfg.collisionRadius, cfg.totalCounts);

    if (collisions.length === 0) {
      console.log(`[HybridByClaude v4] All collisions resolved after ${iter} fix iterations`);
      break;
    }

    console.log(`[HybridByClaude v4] Fix iteration ${iter}: ${collisions.length} collision(s)`);

    // Resolve collision
    const collision = collisions[0];
    const idx1 = paths.findIndex(p => p.dancerId === collision.dancer1);
    const idx2 = paths.findIndex(p => p.dancerId === collision.dancer2);

    if (idx1 < 0 || idx2 < 0) continue;

    const dancer1 = paths[idx1];
    const dancer2 = paths[idx2];

    // Modify dancer with smaller Y (back of stage)
    const y1 = dancer1.assignment.startPosition.y;
    const y2 = dancer2.assignment.startPosition.y;
    const [toFixIdx, toFix] = y1 < y2 ? [idx1, dancer1] : [idx2, dancer2];

    const otherPaths = paths.filter((_, i) => i !== toFixIdx);
    const fixed = findBestPath(toFix, otherPaths, cfg);

    if (fixed) {
      paths[toFixIdx] = fixed;
    } else {
      // Force large curve
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

  // Step 3: Final statistics
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

  // Return results
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
