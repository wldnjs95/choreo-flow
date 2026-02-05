/**
 * HybridAlgorithmBase
 *
 * Base class for hybrid pathfinding algorithms.
 * Provides common functionality for collision detection, path generation, and optimization.
 *
 * Extend this class and implement the abstract methods for specific algorithm variants.
 */

import type { Position, PathPoint, Assignment, DancerPath } from '../types';
import {
  distance,
  getPositionAtTime,
  calculatePathDistance,
  findCollisionTime,
  hasCollision,
  countPathCrossings,
  generateLinearPath,
  generateCurvedPath,
  clamp,
} from './utils/pathUtils';

// Re-export utility functions for backward compatibility
export {
  distance,
  getPositionAtTime,
  calculatePathDistance,
  findCollisionTime,
  hasCollision,
  countPathCrossings,
  generateLinearPath,
  generateCurvedPath,
  clamp,
};

/**
 * Base configuration for hybrid algorithms
 */
export interface BaseHybridConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;
}

/**
 * Extended dancer path info with timing and curve data
 */
export interface DancerPathInfo {
  dancerId: number;
  assignment: Assignment;
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveOffset: number;
}

/**
 * Collision info between two dancers
 */
export interface CollisionInfo {
  dancer1: number;
  dancer2: number;
  time: number;
}

/**
 * Path candidate with metrics
 */
export interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  curveOffset: number;
  crossings: number;
  syncPenalty: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_BASE_CONFIG: BaseHybridConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
};

/**
 * Find all collisions between paths
 */
export function findAllCollisions(
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

/**
 * Check if a path has collision with any other paths
 */
export function hasCollisionWithOthers(
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
 * Count crossings with other paths
 */
export function countCrossingsWithOthers(
  dancerPath: PathPoint[],
  otherPaths: DancerPathInfo[]
): number {
  let total = 0;
  for (const other of otherPaths) {
    total += countPathCrossings(dancerPath, other.path);
  }
  return total;
}

/**
 * Sort assignments by distance (longest first by default)
 */
export function sortAssignmentsByDistance(
  assignments: Assignment[],
  longestFirst: boolean = true
): Assignment[] {
  return [...assignments].sort((a, b) =>
    longestFirst ? b.distance - a.distance : a.distance - b.distance
  );
}

/**
 * Convert DancerPathInfo array to DancerPath array
 */
export function toDancerPaths(pathInfos: DancerPathInfo[]): DancerPath[] {
  return pathInfos.map(info => ({
    dancerId: info.dancerId,
    path: info.path,
    startTime: info.startTime,
    speed: calculatePathDistance(info.path) / (info.endTime - info.startTime) || 0,
    totalDistance: calculatePathDistance(info.path),
  }));
}

/**
 * Generate path candidates with varying parameters
 */
export function generatePathCandidates(
  start: Position,
  end: Position,
  options: {
    numPoints: number;
    totalCounts: number;
    delays: number[];
    durations: number[];
    curveOffsets: number[];
  }
): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  const { numPoints, totalCounts, delays, durations, curveOffsets } = options;

  // Always try linear path first
  for (const delay of delays) {
    for (const duration of durations) {
      const startTime = delay;
      const endTime = Math.min(delay + duration, totalCounts);

      // Linear path
      candidates.push({
        path: generateLinearPath(start, end, startTime, endTime, numPoints),
        startTime,
        endTime,
        curveOffset: 0,
        crossings: 0,
        syncPenalty: delay,
      });

      // Curved paths
      for (const offset of curveOffsets) {
        candidates.push({
          path: generateCurvedPath(start, end, startTime, endTime, numPoints, offset),
          startTime,
          endTime,
          curveOffset: offset,
          crossings: 0,
          syncPenalty: delay,
        });
      }
    }
  }

  return candidates;
}

/**
 * Select best path candidate based on collision and crossing criteria
 */
export function selectBestCandidate(
  candidates: PathCandidate[],
  otherPaths: DancerPathInfo[],
  collisionRadius: number,
  totalCounts: number,
  syncPenaltyMultiplier: number = 1
): PathCandidate | null {
  let bestCandidate: PathCandidate | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    // Check for collisions
    if (hasCollisionWithOthers(candidate.path, otherPaths, collisionRadius, totalCounts)) {
      continue;
    }

    // Calculate score
    const crossings = countCrossingsWithOthers(candidate.path, otherPaths);
    const curveComplexity = Math.abs(candidate.curveOffset);
    const syncPenalty = candidate.syncPenalty * syncPenaltyMultiplier;

    // Score: prefer fewer crossings, simpler curves, better sync
    const score = crossings * 10 + curveComplexity + syncPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = { ...candidate, crossings };
    }
  }

  return bestCandidate;
}

/**
 * Clamp path to stage bounds
 */
export function clampPathToStage(
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

/**
 * Check if required speed is humanly possible
 */
export function isSpeedValid(dist: number, duration: number, maxSpeed: number): boolean {
  if (duration <= 0) return dist === 0;
  return dist / duration <= maxSpeed;
}

/**
 * Calculate minimum duration needed for distance at max speed
 */
export function minDurationForDistance(dist: number, maxSpeed: number): number {
  return dist / maxSpeed;
}
