/**
 * Hybrid Choreography Algorithm
 *
 * Combines:
 * 1. Cubic Bezier curves for smooth, natural paths
 * 2. Heuristic-based timing optimization for collision avoidance
 * 3. Human speed constraints (max 3m/s)
 * 4. Back stage positioning for late arrivers (lower Y = back)
 *
 * Goals:
 * - No collisions
 * - Curved movement paths (unless straight is necessary)
 * - Balanced movement distance across dancers
 * - Late arrivers positioned toward back of stage
 * - Realistic human movement speeds
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';

export interface HybridConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;        // Maximum human speed in meters per count (default: 1.5)
  minCurveRadius: number;       // Minimum curve radius for natural movement (default: 0.5)
  preferSimultaneousArrival: boolean;  // Try to make dancers arrive together (default: true)
  backStageY: number;           // Y coordinate threshold for "back stage" (lower Y = back)
}

const DEFAULT_CONFIG: HybridConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,               // More points for smoother curves
  maxHumanSpeed: 1.5,          // ~1.5m per count is reasonable for dance
  minCurveRadius: 0.5,
  preferSimultaneousArrival: true,
  backStageY: 5,               // Below this Y is considered "back stage"
};

/**
 * Distance between two points
 */
function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Generate Cubic Bezier curve path
 *
 * Unlike Quadratic Bezier (1 control point), Cubic Bezier uses 2 control points
 * allowing for S-curves and better tangent control at start/end points.
 *
 * @param start - Start position
 * @param end - End position
 * @param startTime - Start time
 * @param endTime - End time
 * @param numPoints - Number of points in path
 * @param curveOffset - Perpendicular offset for curve (can be [offset1, offset2] for S-curve)
 * @param tangentStrength - How much the control points extend along tangent (0-1)
 */
function generateCubicBezierPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  curveOffset: number | [number, number] = 0,
  tangentStrength: number = 0.33
): PathPoint[] {
  const path: PathPoint[] = [];

  // Direction vector from start to end
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 0.01) {
    // Start and end are the same, return stationary path
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      path.push({
        x: start.x,
        y: start.y,
        t: startTime + (endTime - startTime) * t,
      });
    }
    return path;
  }

  // Normalized direction
  const dirX = dx / len;
  const dirY = dy / len;

  // Perpendicular vector (for curve offset)
  const perpX = -dirY;
  const perpY = dirX;

  // Parse curve offset
  let offset1: number, offset2: number;
  if (Array.isArray(curveOffset)) {
    offset1 = curveOffset[0];
    offset2 = curveOffset[1];
  } else {
    // Single offset creates a smooth arc
    offset1 = curveOffset;
    offset2 = curveOffset;
  }

  // Control points for Cubic Bezier
  // C1 is 1/3 along the path, offset perpendicular
  // C2 is 2/3 along the path, offset perpendicular
  const c1x = start.x + dirX * len * tangentStrength + perpX * offset1;
  const c1y = start.y + dirY * len * tangentStrength + perpY * offset1;
  const c2x = end.x - dirX * len * tangentStrength + perpX * offset2;
  const c2y = end.y - dirY * len * tangentStrength + perpY * offset2;

  // Generate points along Cubic Bezier curve
  // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    const oneMinusT = 1 - t;
    const oneMinusT2 = oneMinusT * oneMinusT;
    const oneMinusT3 = oneMinusT2 * oneMinusT;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = oneMinusT3 * start.x +
              3 * oneMinusT2 * t * c1x +
              3 * oneMinusT * t2 * c2x +
              t3 * end.x;
    const y = oneMinusT3 * start.y +
              3 * oneMinusT2 * t * c1y +
              3 * oneMinusT * t2 * c2y +
              t3 * end.y;

    path.push({ x, y, t: time });
  }

  return path;
}

/**
 * Generate S-curve path (for crossing scenarios)
 * The curve goes one direction first, then the other
 */
export function generateSCurvePath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  amplitude: number = 1.0
): PathPoint[] {
  // S-curve: offset1 and offset2 have opposite signs
  return generateCubicBezierPath(
    start, end, startTime, endTime, numPoints,
    [amplitude, -amplitude],
    0.4  // Stronger tangent for S-curve
  );
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
 * Calculate maximum speed in path (distance per time unit)
 */
function calculateMaxSpeed(path: PathPoint[]): number {
  let maxSpeed = 0;
  for (let i = 1; i < path.length; i++) {
    const segmentDist = distance(path[i - 1], path[i]);
    const segmentTime = path[i].t - path[i - 1].t;
    if (segmentTime > 0) {
      const speed = segmentDist / segmentTime;
      maxSpeed = Math.max(maxSpeed, speed);
    }
  }
  return maxSpeed;
}

/**
 * Interpolate position at specific time
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
 * Check collision between two paths
 */
export function hasCollision(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): boolean {
  // Check at fine time intervals
  for (let t = 0; t <= totalCounts; t += 0.1) {
    const pos1 = getPositionAtTime(path1, t);
    const pos2 = getPositionAtTime(path2, t);

    if (pos1 && pos2 && distance(pos1, pos2) < collisionRadius * 2) {
      return true;
    }
  }
  return false;
}

/**
 * Find collision time between two paths (returns -1 if no collision)
 */
function findCollisionTime(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): number {
  for (let t = 0; t <= totalCounts; t += 0.1) {
    const pos1 = getPositionAtTime(path1, t);
    const pos2 = getPositionAtTime(path2, t);

    if (pos1 && pos2 && distance(pos1, pos2) < collisionRadius * 2) {
      return t;
    }
  }
  return -1;
}

/**
 * Determine if two paths are "crossing" (moving in opposite directions)
 */
function arePathsCrossing(a1: Assignment, a2: Assignment): boolean {
  // Calculate direction vectors
  const dir1x = a1.endPosition.x - a1.startPosition.x;
  const dir1y = a1.endPosition.y - a1.startPosition.y;
  const dir2x = a2.endPosition.x - a2.startPosition.x;
  const dir2y = a2.endPosition.y - a2.startPosition.y;

  // Dot product < 0 means opposite directions
  const dot = dir1x * dir2x + dir1y * dir2y;

  // Also check if paths actually intersect geometrically
  // Simplified: check if midpoints are close and directions are opposite
  const mid1x = (a1.startPosition.x + a1.endPosition.x) / 2;
  const mid1y = (a1.startPosition.y + a1.endPosition.y) / 2;
  const mid2x = (a2.startPosition.x + a2.endPosition.x) / 2;
  const mid2y = (a2.startPosition.y + a2.endPosition.y) / 2;

  const midDist = Math.sqrt((mid1x - mid2x) ** 2 + (mid1y - mid2y) ** 2);

  return dot < 0 && midDist < 3.0;
}

/**
 * Heuristic timing optimizer
 *
 * Strategy:
 * 1. Sort dancers by priority (front stage dancers have higher priority)
 * 2. Assign timing based on crossing conflicts
 * 3. Dancers in back can arrive later
 */
interface TimingInfo {
  dancerId: number;
  startTime: number;
  endTime: number;
  priority: number;  // Higher = should arrive on time
  curveOffset: number | [number, number];
  curveType: 'arc' | 's-curve' | 'linear';
}

function calculateTimings(
  assignments: Assignment[],
  config: HybridConfig
): TimingInfo[] {
  const timings: TimingInfo[] = [];

  // Calculate base timing for each dancer
  const maxDist = Math.max(...assignments.map(a => a.distance), 1);

  for (const assignment of assignments) {
    const { dancerId, endPosition, distance: dist } = assignment;

    // Priority based on end position Y (higher Y = front = higher priority)
    const priority = endPosition.y / config.stageHeight;

    // Base duration proportional to distance
    const baseDuration = (dist / maxDist) * config.totalCounts * 0.8;
    const minDuration = Math.max(2, dist / config.maxHumanSpeed);  // Speed limit
    const duration = Math.max(baseDuration, minDuration);

    // Front stage dancers should arrive on time
    // Back stage dancers can start/end later
    let startTime = 0;
    let endTime = duration;

    if (endPosition.y < config.backStageY) {
      // Back stage: can arrive later
      const delayAllowed = (1 - priority) * config.totalCounts * 0.3;
      endTime = Math.min(config.totalCounts, duration + delayAllowed);
    } else {
      // Front stage: try to arrive at reasonable time
      endTime = Math.min(config.totalCounts * 0.9, duration);
    }

    timings.push({
      dancerId,
      startTime,
      endTime,
      priority,
      curveOffset: 0,
      curveType: 'linear',
    });
  }

  return timings;
}

/**
 * Resolve collisions using heuristic approach
 */
function resolveCollisions(
  assignments: Assignment[],
  timings: TimingInfo[],
  config: HybridConfig
): TimingInfo[] {
  const resolved = [...timings];

  // Build initial paths
  const paths: Map<number, PathPoint[]> = new Map();
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    const t = resolved[i];
    const path = generateCubicBezierPath(
      a.startPosition, a.endPosition,
      t.startTime, t.endTime,
      config.numPoints,
      t.curveOffset
    );
    paths.set(a.dancerId, path);
  }

  // Iterate to resolve collisions
  const maxIterations = 50;
  for (let iter = 0; iter < maxIterations; iter++) {
    let hasCollisions = false;

    // Check all pairs
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i];
        const a2 = assignments[j];
        const t1 = resolved[i];
        const t2 = resolved[j];
        const path1 = paths.get(a1.dancerId)!;
        const path2 = paths.get(a2.dancerId)!;

        const collisionTime = findCollisionTime(path1, path2, config.collisionRadius, config.totalCounts);

        if (collisionTime >= 0) {
          hasCollisions = true;

          // Determine who should yield based on priority and crossing type
          const isCrossing = arePathsCrossing(a1, a2);

          // Lower priority dancer yields
          const yielder = t1.priority < t2.priority ? i : j;
          const other = yielder === i ? j : i;

          const tYielder = resolved[yielder];
          const aYielder = assignments[yielder];
          const aOther = assignments[other];

          if (isCrossing) {
            // Crossing paths: try S-curve or timing adjustment
            if (tYielder.curveType === 'linear') {
              // Try curve first
              const curveDir = (aYielder.startPosition.x < aOther.startPosition.x) ? 1 : -1;
              tYielder.curveOffset = curveDir * 1.0;
              tYielder.curveType = 'arc';
            } else if (tYielder.curveType === 'arc') {
              // Increase curve
              const currentOffset = typeof tYielder.curveOffset === 'number'
                ? tYielder.curveOffset : tYielder.curveOffset[0];
              const newOffset = currentOffset * 1.5;
              if (Math.abs(newOffset) < 3.0) {
                tYielder.curveOffset = newOffset;
              } else {
                // Max curve reached, try S-curve
                tYielder.curveOffset = [1.5, -1.5];
                tYielder.curveType = 's-curve';
              }
            } else {
              // S-curve didn't work, adjust timing
              if (collisionTime < config.totalCounts / 2) {
                // Collision in first half: yielder starts later
                tYielder.startTime = Math.min(tYielder.startTime + 0.5, config.totalCounts - 2);
                tYielder.endTime = Math.min(tYielder.endTime + 0.5, config.totalCounts);
              } else {
                // Collision in second half: yielder slows down
                tYielder.endTime = Math.min(tYielder.endTime + 0.5, config.totalCounts);
              }
            }
          } else {
            // Non-crossing: timing adjustment is usually enough
            if (collisionTime < config.totalCounts / 2) {
              // Yielder starts later
              tYielder.startTime = Math.min(tYielder.startTime + 0.5, config.totalCounts - 2);
              tYielder.endTime = Math.min(tYielder.endTime + 0.5, config.totalCounts);
            } else {
              // Yielder moves faster (ends earlier) or curves
              if (tYielder.curveType === 'linear') {
                tYielder.curveOffset = 0.5;
                tYielder.curveType = 'arc';
              } else {
                tYielder.endTime = Math.max(tYielder.startTime + 1, tYielder.endTime - 0.3);
              }
            }
          }

          // Regenerate path for yielder
          const newPath = generateCubicBezierPath(
            aYielder.startPosition, aYielder.endPosition,
            tYielder.startTime, tYielder.endTime,
            config.numPoints,
            tYielder.curveOffset
          );
          paths.set(aYielder.dancerId, newPath);
        }
      }
    }

    if (!hasCollisions) {
      console.log(`[HybridChoreography] Resolved all collisions in ${iter + 1} iterations`);
      break;
    }
  }

  return resolved;
}

/**
 * Enforce human speed limits
 * If any segment is too fast, extend the duration
 */
function enforceSpeedLimits(
  path: PathPoint[],
  maxSpeed: number,
  totalCounts: number
): PathPoint[] {
  const currentMaxSpeed = calculateMaxSpeed(path);

  if (currentMaxSpeed <= maxSpeed) {
    return path;
  }

  // Need to slow down: scale time proportionally
  const speedRatio = currentMaxSpeed / maxSpeed;
  const originalDuration = path[path.length - 1].t - path[0].t;
  const newDuration = Math.min(originalDuration * speedRatio, totalCounts - path[0].t);

  // Rescale times
  const startTime = path[0].t;
  const scaledPath: PathPoint[] = path.map((p, i) => {
    const progress = i / (path.length - 1);
    return {
      x: p.x,
      y: p.y,
      t: startTime + progress * newDuration,
    };
  });

  return scaledPath;
}

/**
 * Main function: compute all paths with hybrid algorithm
 */
export function computeAllPathsWithHybrid(
  assignments: Assignment[],
  config: Partial<HybridConfig> = {}
): DancerPath[] {
  const cfg: HybridConfig = { ...DEFAULT_CONFIG, ...config };

  // Stage back is lower Y
  cfg.backStageY = cfg.stageHeight * 0.4;

  console.log('[HybridChoreography] Starting with config:', {
    totalCounts: cfg.totalCounts,
    maxHumanSpeed: cfg.maxHumanSpeed,
    backStageY: cfg.backStageY,
  });

  // Step 1: Calculate initial timings based on priority
  let timings = calculateTimings(assignments, cfg);

  // Step 2: Resolve collisions
  timings = resolveCollisions(assignments, timings, cfg);

  // Step 3: Generate final paths
  const results: DancerPath[] = [];

  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    const timing = timings[i];

    // Generate curved path
    let path = generateCubicBezierPath(
      assignment.startPosition,
      assignment.endPosition,
      timing.startTime,
      timing.endTime,
      cfg.numPoints,
      timing.curveOffset
    );

    // Enforce speed limits
    path = enforceSpeedLimits(path, cfg.maxHumanSpeed, cfg.totalCounts);

    const totalDistance = calculatePathDistance(path);
    const duration = path[path.length - 1].t - path[0].t;
    const speed = duration > 0 ? totalDistance / duration : 1.0;

    results.push({
      dancerId: assignment.dancerId,
      path,
      startTime: timing.startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance,
    });
  }

  // Sort by dancerId
  return results.sort((a, b) => a.dancerId - b.dancerId);
}

/**
 * Validate paths for collisions
 */
export function validateHybridPaths(
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

      if (collisionTime >= 0) {
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
