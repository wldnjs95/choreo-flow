/**
 * Path Utilities
 * Shared utility functions for pathfinding algorithms
 */

import type { Position, PathPoint } from '../../types';

// ============================================
// Distance & Position Utilities
// ============================================

/**
 * Calculate Euclidean distance between two points
 */
export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Get position at specific time along a path (linear interpolation)
 */
export function getPositionAtTime(path: PathPoint[], time: number): Position {
  if (path.length === 0) return { x: 0, y: 0 };
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
  return { x: path[path.length - 1].x, y: path[path.length - 1].y };
}

/**
 * Calculate total distance of a path
 */
export function calculatePathDistance(path: PathPoint[]): number {
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    dist += distance(path[i - 1], path[i]);
  }
  return dist;
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate between two positions
 */
export function lerpPosition(a: Position, b: Position, t: number): Position {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

// ============================================
// Collision Detection
// ============================================

/**
 * Find collision time between two paths (returns null if no collision)
 */
export function findCollisionTime(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number,
  checkInterval: number = 0.05
): number | null {
  const minDist = collisionRadius * 2;

  for (let t = 0; t <= totalCounts; t += checkInterval) {
    const pos1 = getPositionAtTime(path1, t);
    const pos2 = getPositionAtTime(path2, t);

    if (distance(pos1, pos2) < minDist) {
      return t;
    }
  }
  return null;
}

/**
 * Check if two paths have collision
 */
export function hasCollision(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): boolean {
  return findCollisionTime(path1, path2, collisionRadius, totalCounts) !== null;
}

/**
 * Check collision at specific time
 */
export function checkCollisionAtTime(
  path1: PathPoint[],
  path2: PathPoint[],
  time: number,
  collisionRadius: number
): boolean {
  const pos1 = getPositionAtTime(path1, time);
  const pos2 = getPositionAtTime(path2, time);
  return distance(pos1, pos2) < collisionRadius * 2;
}

/**
 * Count total collisions between all path pairs
 */
export function countTotalCollisions(
  paths: PathPoint[][],
  collisionRadius: number,
  totalCounts: number
): number {
  let count = 0;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (hasCollision(paths[i], paths[j], collisionRadius, totalCounts)) {
        count++;
      }
    }
  }
  return count;
}

// ============================================
// Path Crossing Detection
// ============================================

/**
 * Calculate direction for segment intersection test
 */
function direction(p1: Position, p2: Position, p3: Position): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

/**
 * Check if two line segments intersect
 */
export function segmentsIntersect(
  p1: Position, p2: Position,
  p3: Position, p4: Position
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

/**
 * Count path crossings (spatial intersections, ignoring time)
 */
export function countPathCrossings(path1: PathPoint[], path2: PathPoint[]): number {
  let crossings = 0;

  for (let i = 0; i < path1.length - 1; i++) {
    for (let j = 0; j < path2.length - 1; j++) {
      const p1 = { x: path1[i].x, y: path1[i].y };
      const p2 = { x: path1[i + 1].x, y: path1[i + 1].y };
      const p3 = { x: path2[j].x, y: path2[j].y };
      const p4 = { x: path2[j + 1].x, y: path2[j + 1].y };

      if (segmentsIntersect(p1, p2, p3, p4)) {
        crossings++;
      }
    }
  }

  return crossings;
}

// ============================================
// Path Generation Utilities
// ============================================

/**
 * Generate linear path from start to end
 */
export function generateLinearPath(
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
 * Generate curved path with offset (quadratic Bezier-like)
 */
export function generateCurvedPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  offset: number
): PathPoint[] {
  const path: PathPoint[] = [];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // Perpendicular direction
  const perpX = -dy;
  const perpY = dx;
  const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);

  const midX = (start.x + end.x) / 2 + (perpLen > 0 ? (perpX / perpLen) * offset : 0);
  const midY = (start.y + end.y) / 2 + (perpLen > 0 ? (perpY / perpLen) * offset : 0);

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    // Quadratic Bezier curve
    const oneMinusT = 1 - t;
    const x = oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * midX + t * t * end.x;
    const y = oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * midY + t * t * end.y;

    path.push({ x, y, t: time });
  }

  return path;
}

/**
 * Generate cubic Bezier path
 */
export function generateCubicBezierPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  ctrl1Offset: Position,
  ctrl2Offset: Position
): PathPoint[] {
  const path: PathPoint[] = [];

  const ctrl1: Position = {
    x: start.x + ctrl1Offset.x,
    y: start.y + ctrl1Offset.y,
  };
  const ctrl2: Position = {
    x: end.x + ctrl2Offset.x,
    y: end.y + ctrl2Offset.y,
  };

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const time = startTime + (endTime - startTime) * t;

    const oneMinusT = 1 - t;
    const x = oneMinusT ** 3 * start.x +
              3 * oneMinusT ** 2 * t * ctrl1.x +
              3 * oneMinusT * t ** 2 * ctrl2.x +
              t ** 3 * end.x;
    const y = oneMinusT ** 3 * start.y +
              3 * oneMinusT ** 2 * t * ctrl1.y +
              3 * oneMinusT * t ** 2 * ctrl2.y +
              t ** 3 * end.y;

    path.push({ x, y, t: time });
  }

  return path;
}

// ============================================
// Path Validation & Metrics
// ============================================

/**
 * Calculate path curvature (deviation from straight line)
 */
export function calculatePathCurvature(path: PathPoint[]): number {
  if (path.length < 3) return 0;

  const start = path[0];
  const end = path[path.length - 1];
  const straightDist = distance(start, end);

  if (straightDist === 0) return 0;

  let maxDeviation = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const point = path[i];
    const t = i / (path.length - 1);
    const expectedX = start.x + (end.x - start.x) * t;
    const expectedY = start.y + (end.y - start.y) * t;
    const deviation = distance(point, { x: expectedX, y: expectedY });
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return maxDeviation / straightDist;
}

/**
 * Calculate path smoothness score (0-100, higher is straighter)
 */
export function calculatePathSmoothness(path: PathPoint[]): number {
  const curvature = calculatePathCurvature(path);
  // Score decreases as curvature increases
  return Math.max(0, Math.min(100, 100 - curvature * 200));
}

/**
 * Check if path stays within stage bounds
 */
export function isPathInBounds(
  path: PathPoint[],
  stageWidth: number,
  stageHeight: number,
  margin: number = 0.5
): boolean {
  for (const point of path) {
    if (point.x < margin || point.x > stageWidth - margin ||
        point.y < margin || point.y > stageHeight - margin) {
      return false;
    }
  }
  return true;
}

/**
 * Clamp path points to stage bounds
 */
export function clampPathToBounds(
  path: PathPoint[],
  stageWidth: number,
  stageHeight: number,
  margin: number = 0.5
): PathPoint[] {
  return path.map(p => ({
    x: clamp(p.x, margin, stageWidth - margin),
    y: clamp(p.y, margin, stageHeight - margin),
    t: p.t,
  }));
}

// ============================================
// Time-related Utilities
// ============================================

/**
 * Calculate required speed for distance in given time
 */
export function calculateRequiredSpeed(dist: number, time: number): number {
  return time > 0 ? dist / time : 0;
}

/**
 * Check if speed is within human limits
 */
export function isSpeedHumanPossible(speed: number, maxHumanSpeed: number = 1.5): boolean {
  return speed <= maxHumanSpeed;
}

/**
 * Retime path to new start/end times
 */
export function retimePath(
  path: PathPoint[],
  newStartTime: number,
  newEndTime: number
): PathPoint[] {
  if (path.length === 0) return [];

  const oldStartTime = path[0].t;
  const oldEndTime = path[path.length - 1].t;
  const oldDuration = oldEndTime - oldStartTime;
  const newDuration = newEndTime - newStartTime;

  if (oldDuration === 0) {
    return path.map(p => ({ ...p, t: newStartTime }));
  }

  return path.map(p => ({
    x: p.x,
    y: p.y,
    t: newStartTime + ((p.t - oldStartTime) / oldDuration) * newDuration,
  }));
}
