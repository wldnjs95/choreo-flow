/**
 * Hybrid By Claude (Cubic Bezier) Algorithm
 *
 * Core Principles:
 * 1. [Hard Constraint] Zero collision guarantee
 * 2. [Soft Constraint] Minimize path crossings - avoid crossing other dancers' paths
 * 3. [Simplicity] Keep linear paths as much as possible
 * 4. [Visual Sync] Support visual synchronization (syncMode option)
 * 5. [Asymmetric Curves] Improve collision avoidance with asymmetric curves
 *
 * Differences from Quadratic (Quad) version:
 * - Cubic Bezier enables asymmetric curve generation
 * - Generate paths with more bend near start/end based on collision location
 * - Support various path patterns like S-curves
 *
 * Algorithm:
 * 1. Generate linear paths for all dancers
 * 2. Resolve collisions (required) - including asymmetric curves
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
  generateCubicBezierPath,
} from './utils/pathUtils';

export type SyncMode = 'strict' | 'balanced' | 'relaxed';

export interface HybridByClaudeCubicConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;
  syncMode: SyncMode;
}

const DEFAULT_CONFIG: HybridByClaudeCubicConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
  syncMode: 'balanced',
};

// ============================================
// Types
// ============================================

interface Position {
  x: number;
  y: number;
}

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
  curveType: string; // Curve type description
}

// ============================================
// Cubic Bezier Curve Presets (including asymmetric)
// ============================================

interface CurvePreset {
  name: string;
  ctrl1: Position;
  ctrl2: Position;
}

/**
 * Generate various curve presets
 * - symmetric: Symmetric curve (same on both sides)
 * - start_heavy: Large bend near start
 * - end_heavy: Large bend near end
 * - s_curve: S-shaped curve
 */
function generateCurvePresets(
  dx: number,
  dy: number,
  distance: number
): CurvePreset[] {
  // Perpendicular direction vector (perpendicular to path)
  const perpX = -dy / distance;
  const perpY = dx / distance;

  const presets: CurvePreset[] = [];

  // 1. Linear (no control points)
  presets.push({
    name: 'linear',
    ctrl1: { x: 0, y: 0 },
    ctrl2: { x: 0, y: 0 },
  });

  // 2. Symmetric curves (similar to original Quad)
  const symmetricOffsets = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  for (const offset of symmetricOffsets) {
    // Same offset on both sides
    presets.push({
      name: `symmetric_${offset}`,
      ctrl1: { x: perpX * offset * 0.7, y: perpY * offset * 0.7 },
      ctrl2: { x: -perpX * offset * 0.7, y: -perpY * offset * 0.7 },
    });
    presets.push({
      name: `symmetric_-${offset}`,
      ctrl1: { x: -perpX * offset * 0.7, y: -perpY * offset * 0.7 },
      ctrl2: { x: perpX * offset * 0.7, y: perpY * offset * 0.7 },
    });
  }

  // 3. Large bend at start (Start Heavy) - useful for early collision avoidance
  const heavyOffsets = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  for (const offset of heavyOffsets) {
    presets.push({
      name: `start_heavy_${offset}`,
      ctrl1: { x: perpX * offset, y: perpY * offset },
      ctrl2: { x: perpX * offset * 0.2, y: perpY * offset * 0.2 },
    });
    presets.push({
      name: `start_heavy_-${offset}`,
      ctrl1: { x: -perpX * offset, y: -perpY * offset },
      ctrl2: { x: -perpX * offset * 0.2, y: -perpY * offset * 0.2 },
    });
  }

  // 4. Large bend at end (End Heavy) - useful for late collision avoidance
  for (const offset of heavyOffsets) {
    presets.push({
      name: `end_heavy_${offset}`,
      ctrl1: { x: perpX * offset * 0.2, y: perpY * offset * 0.2 },
      ctrl2: { x: perpX * offset, y: perpY * offset },
    });
    presets.push({
      name: `end_heavy_-${offset}`,
      ctrl1: { x: -perpX * offset * 0.2, y: -perpY * offset * 0.2 },
      ctrl2: { x: -perpX * offset, y: -perpY * offset },
    });
  }

  // 5. S-curve (bending in opposite directions)
  const sCurveOffsets = [1.5, 2.0, 2.5, 3.0];
  for (const offset of sCurveOffsets) {
    presets.push({
      name: `s_curve_${offset}`,
      ctrl1: { x: perpX * offset, y: perpY * offset },
      ctrl2: { x: -perpX * offset, y: -perpY * offset },
    });
    presets.push({
      name: `s_curve_-${offset}`,
      ctrl1: { x: -perpX * offset, y: -perpY * offset },
      ctrl2: { x: perpX * offset, y: perpY * offset },
    });
  }

  return presets;
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
// Path Candidates
// ============================================

interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveType: string;
  crossings: number;
  syncPenalty: number;
  curvePenalty: number; // Curve complexity penalty
}

function getCandidateSettings(syncMode: SyncMode, totalCounts: number) {
  switch (syncMode) {
    case 'strict':
      return {
        delays: [0],
        durations: [totalCounts],
        fallbackDelays: [0.3, 0.5, 0.8],
        syncPenaltyMultiplier: 10,
      };
    case 'balanced':
      return {
        delays: [0, 0.3, 0.5, 0.8, 1.0],
        durations: [totalCounts, totalCounts * 0.9, totalCounts * 0.8],
        fallbackDelays: [1.5, 2.0, 2.5],
        syncPenaltyMultiplier: 3,
      };
    case 'relaxed':
    default:
      return {
        delays: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
        durations: [totalCounts, totalCounts * 0.8, totalCounts * 0.7, totalCounts * 0.6],
        fallbackDelays: [4.0, 4.5, 5.0],
        syncPenaltyMultiplier: 0.5,
      };
  }
}

/**
 * Calculate curve complexity (symmetric < asymmetric < S-curve)
 */
function calculateCurvePenalty(curveType: string): number {
  if (curveType === 'linear') return 0;
  if (curveType.startsWith('symmetric_')) return 1;
  if (curveType.startsWith('start_heavy_') || curveType.startsWith('end_heavy_')) return 2;
  if (curveType.startsWith('s_curve_')) return 3;
  return 5; // unknown
}

function findBestPath(
  info: DancerPathInfo,
  otherPaths: DancerPathInfo[],
  cfg: HybridByClaudeCubicConfig
): DancerPathInfo | null {
  const { startPosition, endPosition } = info.assignment;
  const { totalCounts, collisionRadius, numPoints, syncMode } = cfg;
  const settings = getCandidateSettings(syncMode, totalCounts);

  const candidates: PathCandidate[] = [];

  // Calculate path direction
  const dx = endPosition.x - startPosition.x;
  const dy = endPosition.y - startPosition.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 0.01) {
    // Stay in place if same position
    const staticPath = generateLinearPath(startPosition, endPosition, 0, totalCounts, numPoints);
    return {
      ...info,
      path: staticPath,
      startTime: 0,
      endTime: totalCounts,
      curveType: 'static',
    };
  }

  // Generate curve presets
  const presets = generateCurvePresets(dx, dy, distance);

  // Phase 1: Synchronized paths (delay=0)
  for (const preset of presets) {
    const path = generateCubicBezierPath(
      startPosition,
      endPosition,
      0,
      totalCounts,
      numPoints,
      preset.ctrl1,
      preset.ctrl2
    );

    if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
      const crossings = countCrossingsWithOthers(path, otherPaths);
      const curvePenalty = calculateCurvePenalty(preset.name);
      candidates.push({
        path,
        startTime: 0,
        endTime: totalCounts,
        curveType: preset.name,
        crossings,
        syncPenalty: 0,
        curvePenalty,
      });
    }
  }

  // Phase 2: Delayed paths allowed
  for (const delay of settings.delays) {
    if (delay === 0) continue; // Already processed in Phase 1

    for (const dur of settings.durations) {
      const endTime = Math.min(delay + dur, totalCounts);
      if (endTime - delay < 1.5) continue;

      for (const preset of presets) {
        const path = generateCubicBezierPath(
          startPosition,
          endPosition,
          delay,
          endTime,
          numPoints,
          preset.ctrl1,
          preset.ctrl2
        );

        if (!hasCollisionWithOthers(path, otherPaths, collisionRadius, totalCounts)) {
          const crossings = countCrossingsWithOthers(path, otherPaths);
          const syncPenalty = delay * settings.syncPenaltyMultiplier;
          const curvePenalty = calculateCurvePenalty(preset.name);
          candidates.push({
            path,
            startTime: delay,
            endTime,
            curveType: preset.name,
            crossings,
            syncPenalty,
            curvePenalty,
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Select optimal candidate
  candidates.sort((a, b) => {
    if (syncMode === 'strict') {
      // Strict: sync > crossings > curve complexity
      if (a.syncPenalty !== b.syncPenalty) return a.syncPenalty - b.syncPenalty;
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      return a.curvePenalty - b.curvePenalty;
    } else if (syncMode === 'balanced') {
      // Balanced: crossings > sync + curve complexity
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      const scoreA = a.syncPenalty + a.curvePenalty * 0.5;
      const scoreB = b.syncPenalty + b.curvePenalty * 0.5;
      return scoreA - scoreB;
    } else {
      // Relaxed: crossings > curve complexity > delay
      if (a.crossings !== b.crossings) return a.crossings - b.crossings;
      if (a.curvePenalty !== b.curvePenalty) return a.curvePenalty - b.curvePenalty;
      return a.startTime - b.startTime;
    }
  });

  const best = candidates[0];

  return {
    ...info,
    path: best.path,
    startTime: best.startTime,
    endTime: best.endTime,
    curveType: best.curveType,
  };
}

// ============================================
// Main Algorithm
// ============================================

export function computeAllPathsWithHybridByClaudeCubic(
  assignments: Assignment[],
  config: Partial<HybridByClaudeCubicConfig> = {}
): DancerPath[] {
  const cfg: HybridByClaudeCubicConfig = { ...DEFAULT_CONFIG, ...config };

  console.log('[HybridByClaudeCubic] Starting path generation');
  console.log(`[HybridByClaudeCubic] Dancers: ${assignments.length}, totalCounts: ${cfg.totalCounts}`);
  console.log(`[HybridByClaudeCubic] Sync Mode: ${cfg.syncMode}`);

  // Sort dancers: front→back movers first
  const sortedAssignments = [...assignments].sort((a, b) => {
    const aGoingBack = a.startPosition.y > a.endPosition.y;
    const bGoingBack = b.startPosition.y > b.endPosition.y;

    if (aGoingBack && !bGoingBack) return -1;
    if (!aGoingBack && bGoingBack) return 1;

    return b.distance - a.distance;
  });

  console.log('[HybridByClaudeCubic] Processing order (front→back first):');
  sortedAssignments.forEach((a, i) => {
    const direction = a.startPosition.y > a.endPosition.y ? 'front→back' : 'back→front';
    console.log(`  ${i + 1}. Dancer ${a.dancerId}: ${direction}, distance=${a.distance.toFixed(2)}`);
  });

  const paths: DancerPathInfo[] = [];

  // Step 1: Generate paths sequentially
  for (const assignment of sortedAssignments) {
    const info: DancerPathInfo = {
      dancerId: assignment.dancerId,
      assignment,
      path: [],
      startTime: 0,
      endTime: cfg.totalCounts,
      curveType: 'linear',
    };

    const bestPath = findBestPath(info, paths, cfg);

    if (bestPath) {
      paths.push(bestPath);
      const crossings = countCrossingsWithOthers(bestPath.path, paths.filter(p => p.dancerId !== bestPath.dancerId));
      console.log(`[HybridByClaudeCubic] Dancer ${assignment.dancerId}: curve=${bestPath.curveType}, delay=${bestPath.startTime.toFixed(1)}, crossings=${crossings}`);
    } else {
      // Fallback: extreme asymmetric curve
      console.warn(`[HybridByClaudeCubic] Dancer ${assignment.dancerId}: No path found, trying extreme fallback`);

      const { startPosition, endPosition } = assignment;
      const dx = endPosition.x - startPosition.x;
      const dy = endPosition.y - startPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const perpX = distance > 0 ? -dy / distance : 0;
      const perpY = distance > 0 ? dx / distance : 0;

      let fallbackFound = false;
      const extremeOffsets = [5.0, 6.0, 7.0, 8.0, 10.0];
      const fallbackDelays = cfg.syncMode === 'strict' ? [0, 0.3, 0.5] : [0, 0.5, 1.0, 1.5, 2.0];

      outer: for (const offset of extremeOffsets) {
        for (const delay of fallbackDelays) {
          const endTime = cfg.totalCounts;
          if (endTime - delay < 1.0) continue;

          // Try asymmetric curve (large bend at start)
          const ctrl1 = { x: perpX * offset, y: perpY * offset };
          const ctrl2 = { x: perpX * offset * 0.1, y: perpY * offset * 0.1 };

          const fallbackPath = generateCubicBezierPath(
            startPosition,
            endPosition,
            delay,
            endTime,
            cfg.numPoints,
            ctrl1,
            ctrl2
          );

          if (!hasCollisionWithOthers(fallbackPath, paths, cfg.collisionRadius, cfg.totalCounts)) {
            paths.push({
              ...info,
              path: fallbackPath,
              startTime: delay,
              endTime,
              curveType: `extreme_start_heavy_${offset}`,
            });
            console.log(`[HybridByClaudeCubic] Dancer ${assignment.dancerId}: Fallback success with extreme_start_heavy_${offset}, delay=${delay}`);
            fallbackFound = true;
            break outer;
          }

          // Try opposite direction
          const ctrl1Neg = { x: -perpX * offset, y: -perpY * offset };
          const ctrl2Neg = { x: -perpX * offset * 0.1, y: -perpY * offset * 0.1 };

          const fallbackPathNeg = generateCubicBezierPath(
            startPosition,
            endPosition,
            delay,
            endTime,
            cfg.numPoints,
            ctrl1Neg,
            ctrl2Neg
          );

          if (!hasCollisionWithOthers(fallbackPathNeg, paths, cfg.collisionRadius, cfg.totalCounts)) {
            paths.push({
              ...info,
              path: fallbackPathNeg,
              startTime: delay,
              endTime,
              curveType: `extreme_start_heavy_-${offset}`,
            });
            console.log(`[HybridByClaudeCubic] Dancer ${assignment.dancerId}: Fallback success with extreme_start_heavy_-${offset}, delay=${delay}`);
            fallbackFound = true;
            break outer;
          }
        }
      }

      if (!fallbackFound) {
        // Last resort
        console.error(`[HybridByClaudeCubic] Dancer ${assignment.dancerId}: All fallbacks failed, using extreme path`);

        const extremeOffset = assignment.dancerId % 2 === 0 ? 12.0 : -12.0;
        const extremeDelay = cfg.syncMode === 'strict' ? 0.5 : cfg.totalCounts * 0.4;
        const ctrl1 = { x: perpX * extremeOffset, y: perpY * extremeOffset };
        const ctrl2 = { x: perpX * extremeOffset * 0.1, y: perpY * extremeOffset * 0.1 };

        const extremePath = generateCubicBezierPath(
          startPosition,
          endPosition,
          extremeDelay,
          cfg.totalCounts,
          cfg.numPoints,
          ctrl1,
          ctrl2
        );

        paths.push({
          ...info,
          path: extremePath,
          startTime: extremeDelay,
          endTime: cfg.totalCounts,
          curveType: `extreme_${extremeOffset}`,
        });
      }
    }
  }

  // Step 2: Final validation and collision resolution
  const MAX_FIX_ITERATIONS = 50;

  for (let iter = 0; iter < MAX_FIX_ITERATIONS; iter++) {
    const collisions = findAllCollisions(paths, cfg.collisionRadius, cfg.totalCounts);

    if (collisions.length === 0) {
      console.log(`[HybridByClaudeCubic] All collisions resolved after ${iter} fix iterations`);
      break;
    }

    console.log(`[HybridByClaudeCubic] Fix iteration ${iter}: ${collisions.length} collision(s)`);

    const collision = collisions[0];
    const idx1 = paths.findIndex(p => p.dancerId === collision.dancer1);
    const idx2 = paths.findIndex(p => p.dancerId === collision.dancer2);

    if (idx1 < 0 || idx2 < 0) continue;

    const dancer1 = paths[idx1];
    const dancer2 = paths[idx2];

    const y1 = dancer1.assignment.startPosition.y;
    const y2 = dancer2.assignment.startPosition.y;
    const [toFixIdx, toFix] = y1 < y2 ? [idx1, dancer1] : [idx2, dancer2];

    const otherPaths = paths.filter((_, i) => i !== toFixIdx);
    const fixed = findBestPath(toFix, otherPaths, cfg);

    if (fixed) {
      paths[toFixIdx] = fixed;
    } else {
      // Force asymmetric curve
      const { startPosition, endPosition } = toFix.assignment;
      const dx = endPosition.x - startPosition.x;
      const dy = endPosition.y - startPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const perpX = distance > 0 ? -dy / distance : 0;
      const perpY = distance > 0 ? dx / distance : 0;

      const forcedOffset = 6.0 * (y1 < y2 ? 1 : -1);
      const ctrl1 = { x: perpX * forcedOffset, y: perpY * forcedOffset };
      const ctrl2 = { x: perpX * forcedOffset * 0.1, y: perpY * forcedOffset * 0.1 };

      const forcedPath = generateCubicBezierPath(
        startPosition,
        endPosition,
        cfg.totalCounts * 0.3,
        cfg.totalCounts,
        cfg.numPoints,
        ctrl1,
        ctrl2
      );

      paths[toFixIdx] = {
        ...toFix,
        path: forcedPath,
        startTime: cfg.totalCounts * 0.3,
        endTime: cfg.totalCounts,
        curveType: `forced_${forcedOffset}`,
      };
    }
  }

  // Step 3: Final statistics
  const finalCollisions = findAllCollisions(paths, cfg.collisionRadius, cfg.totalCounts);
  const linearCount = paths.filter(p => p.curveType === 'linear').length;
  const symmetricCount = paths.filter(p => p.curveType.startsWith('symmetric_')).length;
  const asymmetricCount = paths.filter(p =>
    p.curveType.startsWith('start_heavy_') ||
    p.curveType.startsWith('end_heavy_') ||
    p.curveType.startsWith('s_curve_')
  ).length;
  const syncedCount = paths.filter(p => p.startTime === 0).length;
  const avgDelay = paths.reduce((sum, p) => sum + p.startTime, 0) / paths.length;
  const maxDelay = Math.max(...paths.map(p => p.startTime));

  let totalCrossings = 0;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      totalCrossings += countPathCrossings(paths[i].path, paths[j].path);
    }
  }

  console.log(`[HybridByClaudeCubic] Summary (syncMode: ${cfg.syncMode}):`);
  console.log(`  - Total dancers: ${paths.length}`);
  console.log(`  - Synced paths (delay=0): ${syncedCount} (${(syncedCount / paths.length * 100).toFixed(0)}%)`);
  console.log(`  - Avg delay: ${avgDelay.toFixed(2)}, Max delay: ${maxDelay.toFixed(2)}`);
  console.log(`  - Linear paths: ${linearCount}`);
  console.log(`  - Symmetric curves: ${symmetricCount}`);
  console.log(`  - Asymmetric curves: ${asymmetricCount}`);
  console.log(`  - Total crossings: ${totalCrossings}`);
  console.log(`  - Final collisions: ${finalCollisions.length}`);

  if (finalCollisions.length > 0) {
    console.error(`[HybridByClaudeCubic] FAILED: ${finalCollisions.length} collision(s) remaining`);
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
export function validateHybridByClaudeCubicPaths(
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
