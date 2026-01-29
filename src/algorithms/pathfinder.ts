/**
 * Simple Pathfinder
 *
 * Strategy:
 * 1. Use linear paths by default (most efficient)
 * 2. Adjust timing when collision detected (startTime)
 * 3. Add slight curves if still colliding
 *
 * Simpler than A* but generates more natural paths for choreography
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
 * Sort strategy (determines path processing order)
 */
export type SortStrategy =
  | 'distance_longest_first'   // Longest distance first (default)
  | 'distance_shortest_first'  // Shortest distance first
  | 'none';                    // No sorting (maintain input order)

/**
 * Timing mode for path generation
 */
export type TimingMode =
  | 'proportional'      // Arrival time proportional to distance (default)
  | 'synchronized'      // All dancers arrive at exactly totalCounts
  | 'staggered';        // Sequential start times (wave effect)

export interface PathfinderConfig {
  totalCounts: number;
  collisionRadius: number;
  numPoints: number;  // Points per path
  sortStrategy?: SortStrategy;  // Sort strategy (default: distance_longest_first)
  maxCurveOffset?: number;      // Max curve offset (default: 0.5)
  preferTiming?: boolean;       // Prefer timing adjustment (default: true)
  timingMode?: TimingMode;      // Timing mode (default: proportional)
  staggerDelay?: number;        // Delay between dancers for staggered mode (default: 0.5)
  forceCurve?: boolean;         // Force curved paths even without collision
  speedMultiplier?: number;     // Speed multiplier (1.0 = normal, >1 = faster, <1 = slower)
}

const DEFAULT_CONFIG: PathfinderConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  numPoints: 20,
};

/**
 * Distance between two points
 */
function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Generate linear path
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
 * Interpolate position at specific time in path
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
 * Check if two paths collide at specific time
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
 * Check collision between two paths (full time range)
 */
function hasCollision(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): boolean {
  // Check at 0.25 count intervals
  for (let t = 0; t <= totalCounts; t += 0.25) {
    if (checkCollisionAtTime(path1, path2, t, collisionRadius)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate curved path with slight offset
 * offset: deviation of midpoint from straight line
 */
function generateCurvedPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  curveOffset: number,  // Positive: curve right, Negative: curve left
): PathPoint[] {
  const path: PathPoint[] = [];

  // Calculate midpoint (offset perpendicular to line)
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // Perpendicular direction to line
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular vector (normalized)
  const perpX = -dy / len;
  const perpY = dx / len;

  // Midpoint with offset applied
  const ctrlX = midX + perpX * curveOffset;
  const ctrlY = midY + perpY * curveOffset;

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    // Quadratic Bezier curve: (1-t)²P0 + 2(1-t)tP1 + t²P2
    const oneMinusT = 1 - t;
    const x = oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * ctrlX + t * t * end.x;
    const y = oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * ctrlY + t * t * end.y;

    path.push({ x, y, t: time });
  }

  return path;
}

/**
 * Calculate paths for all dancers
 *
 * Strategy:
 * 1. All dancers start at 0, arrive at distance-proportional time (early arrival OK)
 * 2. Only adjust timing when collision occurs
 * 3. Add minimal curves if still colliding
 */
export function computeAllPathsSimple(
  assignments: Assignment[],
  config: Partial<PathfinderConfig> = {}
): DancerPath[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: DancerPath[] = [];

  // Determine processing order based on sort strategy
  let sorted: Assignment[];
  const sortStrategy = cfg.sortStrategy || 'distance_longest_first';

  switch (sortStrategy) {
    case 'distance_shortest_first':
      sorted = [...assignments].sort((a, b) => a.distance - b.distance);
      break;
    case 'none':
      sorted = [...assignments];  // Maintain input order
      break;
    case 'distance_longest_first':
    default:
      sorted = [...assignments].sort((a, b) => b.distance - a.distance);
      break;
  }

  // Already computed paths
  const computedPaths: { dancerId: number; path: PathPoint[] }[] = [];

  // Calculate max distance (speed reference)
  const maxDist = Math.max(...assignments.map(a => a.distance));

  // Track dancer index for staggered mode
  let dancerIndex = 0;

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    // Determine start and end time based on timing mode
    let startTime = 0;
    let endTime = cfg.totalCounts;
    const timingMode = cfg.timingMode || 'proportional';
    const staggerDelay = cfg.staggerDelay || 0.5;

    switch (timingMode) {
      case 'synchronized':
        // All dancers arrive at exactly totalCounts
        startTime = 0;
        endTime = cfg.totalCounts;
        break;

      case 'staggered':
        // Sequential start times (wave effect)
        // Limit startTime to leave room for movement
        const maxStartTime = cfg.totalCounts * 0.6;  // Don't start later than 60% of total time
        startTime = Math.min(dancerIndex * staggerDelay, maxStartTime);
        endTime = Math.min(startTime + cfg.totalCounts * 0.7, cfg.totalCounts);
        // Ensure minimum travel time
        if (endTime - startTime < 2) {
          endTime = Math.min(startTime + 2, cfg.totalCounts);
        }
        // Final safeguard: ensure there's always movement time
        if (startTime >= endTime) {
          startTime = 0;
          endTime = cfg.totalCounts;
        }
        break;

      case 'proportional':
      default:
        // Arrival time proportional to distance
        startTime = 0;
        const baseSpeed = maxDist / cfg.totalCounts;
        endTime = baseSpeed > 0 ? Math.max(2, dist / baseSpeed) : cfg.totalCounts;
        if (endTime > cfg.totalCounts) {
          endTime = cfg.totalCounts;
        }
        break;
    }

    // Apply speed multiplier if specified
    const speedMultiplier = cfg.speedMultiplier ?? 1.0;
    if (speedMultiplier !== 1.0) {
      const duration = endTime - startTime;
      const adjustedDuration = duration / speedMultiplier;  // Faster = shorter duration
      endTime = Math.min(startTime + adjustedDuration, cfg.totalCounts);
      // Ensure minimum travel time
      if (endTime - startTime < 1) {
        endTime = Math.min(startTime + 1, cfg.totalCounts);
      }
    }

    // Final safeguard: ensure valid movement time (at least 1 count duration)
    if (endTime <= startTime) {
      console.warn(`[Pathfinder] Invalid timing for dancer ${dancerId}: startTime=${startTime}, endTime=${endTime}. Resetting.`);
      startTime = 0;
      endTime = Math.max(2, cfg.totalCounts);
    }

    dancerIndex++;

    // Generate default path (curved if forceCurve is enabled)
    let path: PathPoint[];
    const forceCurve = cfg.forceCurve ?? false;

    if (forceCurve) {
      // Generate curved path with varying offset based on dancer index
      // Alternate between positive and negative curves for visual variety
      const curveDirection = dancerIndex % 2 === 0 ? 1 : -1;
      const maxOffset = cfg.maxCurveOffset ?? 0.5;
      // Use deterministic offset based on dancer position for consistency
      const offsetFactor = 0.6 + (dancerIndex % 5) * 0.1;  // Range: 0.6 ~ 1.0
      const curveOffset = curveDirection * maxOffset * offsetFactor;
      path = generateCurvedPath(startPosition, endPosition, startTime, endTime, cfg.numPoints, curveOffset);
    } else {
      path = generateLinearPath(startPosition, endPosition, startTime, endTime, cfg.numPoints);
    }

    // Check collision with existing paths
    let hasConflict = false;

    for (const computed of computedPaths) {
      if (hasCollision(path, computed.path, cfg.collisionRadius, cfg.totalCounts)) {
        hasConflict = true;
        break;
      }
    }

    // Try to resolve collision (minimize curves - resolve with timing first)
    if (hasConflict) {
      const originalEndTime = endTime;

      // Method 1: Pass quickly (reduce endTime)
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

      // Method 2: Start late (various delays)
      if (hasConflict) {
        for (let delay = 0.5; delay <= 4 && hasConflict; delay += 0.5) {
          // Late start + same speed
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

      // Method 3: Late start + fast movement combination
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

      // Method 4: Last resort - minimal curve (limited by maxCurveOffset)
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

    // Verify path has valid time range
    const pathStartT = path[0]?.t ?? 0;
    const pathEndT = path[path.length - 1]?.t ?? cfg.totalCounts;
    if (pathEndT <= pathStartT) {
      console.warn(`[Pathfinder] Dancer ${dancerId} has invalid path time: ${pathStartT} to ${pathEndT}. Regenerating.`);
      // Regenerate with default timing
      path = generateLinearPath(startPosition, endPosition, 0, cfg.totalCounts, cfg.numPoints);
      startTime = 0;
      endTime = cfg.totalCounts;
    }

    // Calculate speed
    const pathDistance = calculatePathDistance(path);
    const duration = endTime - startTime;
    const speed = duration > 0 ? pathDistance / duration / (maxDist / cfg.totalCounts || 1) : 1;

    // Debug log for short duration paths
    if (duration < 1 && pathDistance > 0.5) {
      console.warn(`[Pathfinder] Dancer ${dancerId} has very short duration (${duration.toFixed(2)}) for distance ${pathDistance.toFixed(2)}m`);
    }

    computedPaths.push({ dancerId, path });

    results.push({
      dancerId,
      path,
      startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance: pathDistance,
    });
  }

  // Sort by dancerId
  return results.sort((a, b) => a.dancerId - b.dancerId);
}

/**
 * Calculate path distance
 */
function calculatePathDistance(path: PathPoint[]): number {
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    dist += distance(path[i - 1], path[i]);
  }
  return dist;
}

/**
 * Validate paths
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
          break;  // Record only one per pair
        }
      }
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}
