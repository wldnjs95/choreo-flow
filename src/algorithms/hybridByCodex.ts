/**
 * Hybrid By Codex
 *
 * Goals:
 * - Collision free (hard)
 * - Prefer straight-line motion; use curved detours only when needed
 * - Favor simultaneous arrival; delay only when unavoidable (prefer lower Y)
 * - Respect human speed limit
 * - Avoid extreme detours for load balancing
 */

import type { Assignment, Position } from './hungarian';
import type { DancerPath, PathPoint } from './pathfinder';
import { generateCubicBezierPath } from './choreographyHybrid';
import {
  distance,
  calculatePathDistance,
  getPositionAtTime,
} from './utils/pathUtils';

export interface HybridByCodexConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;
  maxCurveOffset: number;
  maxDetourRatio: number;
  timeStep: number;
}

const DEFAULT_CONFIG: HybridByCodexConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
  maxCurveOffset: 3.0,
  maxDetourRatio: 1.8,
  timeStep: 0.1,
};

function hasCollisionBetweenPaths(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number,
  timeStep: number
): boolean {
  for (let t = 0; t <= totalCounts; t += timeStep) {
    const pos1 = getPositionAtTime(path1, t);
    const pos2 = getPositionAtTime(path2, t);

    if (pos1 && pos2 && distance(pos1, pos2) < collisionRadius * 2) {
      return true;
    }
  }
  return false;
}

function hasCollisionWithAny(
  newPath: PathPoint[],
  existingPaths: PathPoint[][],
  collisionRadius: number,
  totalCounts: number,
  timeStep: number
): boolean {
  for (const existing of existingPaths) {
    if (hasCollisionBetweenPaths(newPath, existing, collisionRadius, totalCounts, timeStep)) {
      return true;
    }
  }
  return false;
}

function buildCurveOffsets(maxCurveOffset: number): (number | [number, number])[] {
  const base: (number | [number, number])[] = [
    0,
    0.5, -0.5,
    1.0, -1.0,
    1.5, -1.5,
    2.0, -2.0,
    2.5, -2.5,
    3.0, -3.0,
    [0.8, -0.8], [-0.8, 0.8],
    [1.2, -1.2], [-1.2, 1.2],
    [1.6, -1.6], [-1.6, 1.6],
  ];

  return base.filter((offset) => {
    if (typeof offset === 'number') {
      return Math.abs(offset) <= maxCurveOffset;
    }
    return Math.max(Math.abs(offset[0]), Math.abs(offset[1])) <= maxCurveOffset;
  });
}

function computeMaxDelay(
  straightDistance: number,
  totalCounts: number,
  maxHumanSpeed: number
): number {
  const minDuration = straightDistance / Math.max(maxHumanSpeed, 0.1);
  return Math.max(0, totalCounts - minDuration);
}

function getDelayAllowance(startY: number, stageHeight: number): number {
  if (stageHeight <= 0) return 0.5;
  const yNorm = Math.min(1, Math.max(0, startY / stageHeight));
  // Lower Y (back stage) gets higher allowance
  const allowance = 1 - yNorm;
  return Math.min(1, Math.max(0.15, allowance));
}

interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  totalDistance: number;
}

function tryBuildCandidate(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  curveOffset: number | [number, number],
  straightDistance: number,
  maxHumanSpeed: number,
  maxDetourRatio: number
): PathCandidate | null {
  const path = generateCubicBezierPath(
    start,
    end,
    startTime,
    endTime,
    numPoints,
    curveOffset,
    0.33
  );

  const totalDistance = calculatePathDistance(path);
  const duration = Math.max(0.01, endTime - startTime);
  const speed = totalDistance / duration;

  if (speed > maxHumanSpeed) return null;
  if (totalDistance > straightDistance * maxDetourRatio) return null;

  return {
    path,
    startTime,
    endTime,
    totalDistance,
  };
}

export function computeAllPathsWithHybridByCodex(
  assignments: Assignment[],
  config: Partial<HybridByCodexConfig> = {}
): DancerPath[] {
  const cfg: HybridByCodexConfig = { ...DEFAULT_CONFIG, ...config };

  const sorted = [...assignments].sort((a, b) => {
    if (b.distance !== a.distance) return b.distance - a.distance;
    return b.startPosition.y - a.startPosition.y;
  });

  const existingPaths: PathPoint[][] = [];
  const results: DancerPath[] = [];
  const curveOffsets = buildCurveOffsets(cfg.maxCurveOffset);

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition } = assignment;
    const straightDistance = distance(startPosition, endPosition);
    const maxDelayBase = computeMaxDelay(straightDistance, cfg.totalCounts, cfg.maxHumanSpeed);
    const delayAllowance = getDelayAllowance(startPosition.y, cfg.stageHeight);
    const maxDelay = maxDelayBase * delayAllowance;

    let selected: PathCandidate | null = null;

    // 1) Prefer straight-line, full duration
    for (const offset of curveOffsets) {
      const candidate = tryBuildCandidate(
        startPosition,
        endPosition,
        0,
        cfg.totalCounts,
        cfg.numPoints,
        offset,
        straightDistance,
        cfg.maxHumanSpeed,
        cfg.maxDetourRatio
      );

      if (!candidate) continue;
      if (!hasCollisionWithAny(candidate.path, existingPaths, cfg.collisionRadius, cfg.totalCounts, cfg.timeStep)) {
        selected = candidate;
        break;
      }
    }

    // 2) If unavoidable, allow delayed start (prefer back stage)
    if (!selected && maxDelay > 0.01) {
      const delayStep = 0.5;
      for (let delay = delayStep; delay <= maxDelay + 1e-6; delay += delayStep) {
        const startTime = Math.min(delay, cfg.totalCounts - 0.5);
        const endTime = cfg.totalCounts;
        if (endTime - startTime < 1) continue;

        for (const offset of curveOffsets) {
          const candidate = tryBuildCandidate(
            startPosition,
            endPosition,
            startTime,
            endTime,
            cfg.numPoints,
            offset,
            straightDistance,
            cfg.maxHumanSpeed,
            cfg.maxDetourRatio
          );

          if (!candidate) continue;
          if (!hasCollisionWithAny(candidate.path, existingPaths, cfg.collisionRadius, cfg.totalCounts, cfg.timeStep)) {
            selected = candidate;
            break;
          }
        }
        if (selected) break;
      }
    }

    // 3) Final fallback: expand detour range if still colliding
    if (!selected) {
      const fallbackOffsets = buildCurveOffsets(cfg.maxCurveOffset * 1.5);
      for (const offset of fallbackOffsets) {
        const candidate = tryBuildCandidate(
          startPosition,
          endPosition,
          0,
          cfg.totalCounts,
          cfg.numPoints,
          offset,
          straightDistance,
          cfg.maxHumanSpeed,
          cfg.maxDetourRatio * 1.3
        );

        if (!candidate) continue;
        if (!hasCollisionWithAny(candidate.path, existingPaths, cfg.collisionRadius, cfg.totalCounts, cfg.timeStep)) {
          selected = candidate;
          break;
        }
      }
    }

    // 4) If still none, force straight path (will be flagged in validation)
    if (!selected) {
      const path = generateCubicBezierPath(
        startPosition,
        endPosition,
        0,
        cfg.totalCounts,
        cfg.numPoints,
        0,
        0.33
      );
      selected = {
        path,
        startTime: 0,
        endTime: cfg.totalCounts,
        totalDistance: calculatePathDistance(path),
      };
    }

    existingPaths.push(selected.path);
    const duration = Math.max(0.01, selected.endTime - selected.startTime);
    const speed = selected.totalDistance / duration;

    results.push({
      dancerId,
      path: selected.path,
      startTime: selected.startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance: selected.totalDistance,
    });
  }

  return results.sort((a, b) => a.dancerId - b.dancerId);
}
