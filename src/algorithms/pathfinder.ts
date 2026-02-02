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
 * Generate curved path using Catmull-Rom Spline
 * offset: deviation of control points from straight line
 * 
 * Catmull-Rom Spline advantages:
 * - Passes through all control points (unlike B-spline)
 * - More flexible than Quadratic Bezier (can create S-curves)
 * - Natural and smooth curves
 * - Better for complex path patterns
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
  const perpX = len > 0.001 ? -dy / len : 0;
  const perpY = len > 0.001 ? dx / len : 1;

  // Create control points for Catmull-Rom spline
  // We need at least 4 points: P0 (start), P1, P2 (control), P3 (end)
  // For more complex curves, we can add more control points
  
  // Control point 1: offset from start towards midpoint
  const ctrl1X = start.x + (midX - start.x) * 0.3 + perpX * curveOffset * 0.5;
  const ctrl1Y = start.y + (midY - start.y) * 0.3 + perpY * curveOffset * 0.5;

  // Control point 2: offset from midpoint towards end
  const ctrl2X = midX + perpX * curveOffset;
  const ctrl2Y = midY + perpY * curveOffset;

  // Control point 3: offset from end back towards midpoint
  const ctrl3X = end.x - (end.x - midX) * 0.3 + perpX * curveOffset * 0.5;
  const ctrl3Y = end.y - (end.y - midY) * 0.3 + perpY * curveOffset * 0.5;

  // Catmull-Rom spline points: [start, ctrl1, ctrl2, ctrl3, end]
  const splinePoints: Position[] = [
    start,
    { x: ctrl1X, y: ctrl1Y },
    { x: ctrl2X, y: ctrl2Y },
    { x: ctrl3X, y: ctrl3Y },
    end,
  ];

  // Generate path using Catmull-Rom interpolation
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    // Map t (0-1) to spline segment index
    // We have 4 segments (5 points = 4 segments)
    const segmentCount = splinePoints.length - 1;
    const segmentT = t * segmentCount;
    const segmentIndex = Math.floor(segmentT);
    const localT = segmentT - segmentIndex;

    // Clamp segment index
    const clampedIndex = Math.min(segmentIndex, segmentCount - 1);
    const clampedT = clampedIndex === segmentCount - 1 ? 1 : localT;

    // Get 4 points for Catmull-Rom (P0, P1, P2, P3)
    // For edge cases, use the point itself
    const p0 = splinePoints[Math.max(0, clampedIndex - 1)];
    const p1 = splinePoints[clampedIndex];
    const p2 = splinePoints[Math.min(splinePoints.length - 1, clampedIndex + 1)];
    const p3 = splinePoints[Math.min(splinePoints.length - 1, clampedIndex + 2)];

    // Catmull-Rom spline interpolation
    const t2 = clampedT * clampedT;
    const t3 = t2 * clampedT;

    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * clampedT +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * clampedT +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    path.push({ x, y, t: time });
  }

  // Ensure first and last points are exactly at start and end
  if (path.length > 0) {
    path[0] = { x: start.x, y: start.y, t: startTime };
    path[path.length - 1] = { x: end.x, y: end.y, t: endTime };
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

      // Method 2: Start late (various delays) - extended range
      if (hasConflict) {
        for (let delay = 0.5; delay <= 6 && hasConflict; delay += 0.5) {
          // Late start + same speed
          const newStartTime = delay;
          const duration = originalEndTime - startTime;  // Keep original duration
          const newEndTime = Math.min(newStartTime + duration, cfg.totalCounts);

          // Skip if not enough time to complete
          if (newEndTime - newStartTime < 1) continue;

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

      // Method 3: Move SLOWER (increase duration) - let others pass first
      if (hasConflict) {
        for (const slowFactor of [1.5, 2.0, 2.5, 3.0]) {
          const newEndTime = Math.min(originalEndTime * slowFactor, cfg.totalCounts);
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
      }

      // Method 4: Late start + fast movement combination
      if (hasConflict) {
        for (const delay of [0.5, 1, 1.5, 2, 2.5, 3, 4]) {
          for (const speedFactor of [0.7, 0.5, 0.4, 0.3]) {
            const newStartTime = delay;
            const newEndTime = Math.min(newStartTime + originalEndTime * speedFactor, cfg.totalCounts);

            if (newEndTime - newStartTime < 1) continue;

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

      // Method 5: Late start + SLOW movement (wait then take your time)
      if (hasConflict) {
        for (const delay of [1, 2, 3, 4]) {
          for (const slowFactor of [1.2, 1.5, 2.0]) {
            const newStartTime = delay;
            const baseDuration = originalEndTime - startTime;
            const newEndTime = Math.min(newStartTime + baseDuration * slowFactor, cfg.totalCounts);

            if (newEndTime - newStartTime < 1) continue;

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

      // Method 6: Curved path (uses maxCurveOffset)
      if (hasConflict) {
        const maxOffset = cfg.maxCurveOffset ?? 0.5;
        // Generate curve offsets dynamically based on maxOffset
        // Try small curves first, then progressively larger ones
        const curveOffsets: number[] = [];
        for (let o = 0.2; o <= maxOffset; o += 0.3) {
          curveOffsets.push(o, -o);
        }
        // Also add some larger offsets if maxOffset allows
        if (maxOffset > 1.0) {
          curveOffsets.push(1.0, -1.0, 1.5, -1.5);
        }
        if (maxOffset > 2.0) {
          curveOffsets.push(2.0, -2.0);
        }

        for (const offset of curveOffsets) {
          if (Math.abs(offset) > maxOffset) continue;

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

      // Method 7: Combined timing + curve if still conflicting
      if (hasConflict) {
        const maxOffset = cfg.maxCurveOffset ?? 0.5;
        outerLoop:
        for (let delay = 0.5; delay <= 3; delay += 0.5) {
          for (const offset of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
            if (Math.abs(offset) > maxOffset) continue;

            const newStartTime = delay;
            const newEndTime = Math.min(newStartTime + cfg.totalCounts * 0.7, cfg.totalCounts);
            path = generateCurvedPath(startPosition, endPosition, newStartTime, newEndTime, cfg.numPoints, offset);

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
              break outerLoop;
            }
          }
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
