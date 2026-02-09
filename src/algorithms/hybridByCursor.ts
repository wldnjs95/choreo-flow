/**
 * Hybrid By Cursor
 *
 * Multi-candidate Mode: Start formation → End formation path calculation.
 * Priority:
 * 1. [Hard] Collision Free
 * 2. [Movement] Linear path first, curved detour for avoidance/delay
 * 3. [Time] Arrival time sync — Time Filling (curved detour), delay for back dancers (lower Y)
 * 4. [Kinematics] Natural speed, no abrupt direction changes
 * 5. [Load] Travel distance deviation control (maxDetourRatio)
 */

import type { Assignment, Position } from './hungarian';
import type { DancerPath, PathPoint } from './pathfinder';
import { generateCubicBezierPath } from './choreographyHybrid';
import {
  distance,
  calculatePathDistance,
  getPositionAtTime,
  generateLinearPath,
} from './utils/pathUtils';

export interface HybridByCursorConfig {
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

const DEFAULT_CONFIG: HybridByCursorConfig = {
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

/** Curve offset candidates (linear first, smooth curve for avoidance) */
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

/** Maximum delay time (physical limit) */
function computeMaxDelay(
  straightDistance: number,
  totalCounts: number,
  maxHumanSpeed: number
): number {
  const minDuration = straightDistance / Math.max(maxHumanSpeed, 0.1);
  return Math.max(0, totalCounts - minDuration);
}

/** Delay allowance: lower Y (back of stage) allows more delay */
function getDelayAllowance(startY: number, stageHeight: number): number {
  if (stageHeight <= 0) return 0.5;
  const yNorm = Math.min(1, Math.max(0, startY / stageHeight));
  const allowance = 1 - yNorm;
  return Math.min(1, Math.max(0.15, allowance));
}

interface PathCandidate {
  path: PathPoint[];
  startTime: number;
  endTime: number;
  totalDistance: number;
  isLinear: boolean;
}

function tryBuildLinearCandidate(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  numPoints: number,
  straightDistance: number,
  maxHumanSpeed: number
): PathCandidate | null {
  const path = generateLinearPath(start, end, startTime, endTime, numPoints);
  const totalDistance = straightDistance;
  const duration = Math.max(0.01, endTime - startTime);
  const speed = totalDistance / duration;
  if (speed > maxHumanSpeed) return null;
  return {
    path,
    startTime,
    endTime,
    totalDistance,
    isLinear: true,
  };
}

function tryBuildCurvedCandidate(
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
    isLinear: false,
  };
}

/**
 * Time Filling: Adjust arrival time to totalCounts using curved detour for early arrivers.
 * Target length = min(maxHumanSpeed * totalCounts, straightDistance * maxDetourRatio)
 */
function buildTimeFillingPath(
  start: Position,
  end: Position,
  totalCounts: number,
  numPoints: number,
  targetLength: number,
  straightDistance: number,
  maxDetourRatio: number
): PathPoint[] {
  const maxAllowedLength = straightDistance * maxDetourRatio;
  const desiredLength = Math.min(targetLength, maxAllowedLength);
  if (desiredLength <= straightDistance + 0.01) {
    return generateLinearPath(start, end, 0, totalCounts, numPoints);
  }
  const curveOffsets: (number | [number, number])[] = [
    0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.5, -2.5, 3.0, -3.0,
    [1, -1], [-1, 1], [1.5, -1.5], [-1.5, 1.5],
  ];
  let bestPath: PathPoint[] = generateLinearPath(start, end, 0, totalCounts, numPoints);
  let bestLength = straightDistance;
  let bestDiff = Math.abs(desiredLength - bestLength);

  for (const offset of curveOffsets) {
    const path = generateCubicBezierPath(
      start,
      end,
      0,
      totalCounts,
      numPoints,
      offset,
      0.33
    );
    const len = calculatePathDistance(path);
    if (len > maxAllowedLength) continue;
    const diff = Math.abs(desiredLength - len);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPath = path;
      bestLength = len;
    }
  }
  return bestPath;
}

export function computeAllPathsWithHybridByCursor(
  assignments: Assignment[],
  config: Partial<HybridByCursorConfig> = {}
): DancerPath[] {
  const cfg: HybridByCursorConfig = { ...DEFAULT_CONFIG, ...config };
  const targetEndTime = cfg.totalCounts;

  // Processing order: longest distance first, then higher Y first (front dancers) → back dancers (lower Y) processed later for delay allowance
  const sorted = [...assignments].sort((a, b) => {
    if (b.distance !== a.distance) return b.distance - a.distance;
    return b.startPosition.y - a.startPosition.y;
  });

  const existingPaths: PathPoint[][] = [];
  const results: { dancerId: number; candidate: PathCandidate }[] = [];
  const curveOffsets = buildCurveOffsets(cfg.maxCurveOffset);

  // ---------- Phase 1: Assign collision-free paths (linear first, curve/delay if needed) ----------
  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition } = assignment;
    const straightDistance = distance(startPosition, endPosition);
    const maxDelayBase = computeMaxDelay(straightDistance, cfg.totalCounts, cfg.maxHumanSpeed);
    const delayAllowance = getDelayAllowance(startPosition.y, cfg.stageHeight);
    const maxDelay = maxDelayBase * delayAllowance;

    let selected: PathCandidate | null = null;

    // 1) Linear first: start 0, end totalCounts
    const linearCandidate = tryBuildLinearCandidate(
      startPosition,
      endPosition,
      0,
      targetEndTime,
      cfg.numPoints,
      straightDistance,
      cfg.maxHumanSpeed
    );
    if (
      linearCandidate &&
      !hasCollisionWithAny(
        linearCandidate.path,
        existingPaths,
        cfg.collisionRadius,
        cfg.totalCounts,
        cfg.timeStep
      )
    ) {
      selected = linearCandidate;
    }

    // 2) If linear fails, try smooth curved (Bezier) detour
    if (!selected) {
      for (const offset of curveOffsets) {
        const candidate = tryBuildCurvedCandidate(
          startPosition,
          endPosition,
          0,
          targetEndTime,
          cfg.numPoints,
          offset,
          straightDistance,
          cfg.maxHumanSpeed,
          cfg.maxDetourRatio
        );
        if (!candidate) continue;
        if (
          !hasCollisionWithAny(
            candidate.path,
            existingPaths,
            cfg.collisionRadius,
            cfg.totalCounts,
            cfg.timeStep
          )
        ) {
          selected = candidate;
          break;
        }
      }
    }

    // 3) If still colliding, delay: back dancers (lower Y) arrive later
    if (!selected && maxDelay > 0.01) {
      const delayStep = 0.5;
      for (let delay = delayStep; delay <= maxDelay + 1e-6; delay += delayStep) {
        const startTime = Math.min(delay, cfg.totalCounts - 0.5);
        const endTime = cfg.totalCounts;
        if (endTime - startTime < 1) continue;

        const linearDelayed = tryBuildLinearCandidate(
          startPosition,
          endPosition,
          startTime,
          endTime,
          cfg.numPoints,
          straightDistance,
          cfg.maxHumanSpeed
        );
        if (
          linearDelayed &&
          !hasCollisionWithAny(
            linearDelayed.path,
            existingPaths,
            cfg.collisionRadius,
            cfg.totalCounts,
            cfg.timeStep
          )
        ) {
          selected = linearDelayed;
          break;
        }
        for (const offset of curveOffsets) {
          const candidate = tryBuildCurvedCandidate(
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
          if (
            !hasCollisionWithAny(
              candidate.path,
              existingPaths,
              cfg.collisionRadius,
              cfg.totalCounts,
              cfg.timeStep
            )
          ) {
            selected = candidate;
            break;
          }
        }
        if (selected) break;
      }
    }

    // 4) Fallback: expand detour range
    if (!selected) {
      const fallbackOffsets = buildCurveOffsets(cfg.maxCurveOffset * 1.5);
      for (const offset of fallbackOffsets) {
        const candidate = tryBuildCurvedCandidate(
          startPosition,
          endPosition,
          0,
          targetEndTime,
          cfg.numPoints,
          offset,
          straightDistance,
          cfg.maxHumanSpeed,
          cfg.maxDetourRatio * 1.3
        );
        if (!candidate) continue;
        if (
          !hasCollisionWithAny(
            candidate.path,
            existingPaths,
            cfg.collisionRadius,
            cfg.totalCounts,
            cfg.timeStep
          )
        ) {
          selected = candidate;
          break;
        }
      }
    }

    // 5) Last resort: force linear path (will be flagged as collision during validation)
    if (!selected) {
      const path = generateLinearPath(
        startPosition,
        endPosition,
        0,
        targetEndTime,
        cfg.numPoints
      );
      selected = {
        path,
        startTime: 0,
        endTime: targetEndTime,
        totalDistance: straightDistance,
        isLinear: true,
      };
    }

    existingPaths.push(selected.path);
    results.push({ dancerId, candidate: selected });
  }

  // ---------- Phase 2: Arrival time sync — Time Filling (curved detour for simultaneous arrival) ----------
  const targetPathLengthForSync = cfg.maxHumanSpeed * targetEndTime;

  const finalResults: DancerPath[] = results.map(({ dancerId, candidate }, idx) => {
    const assignment = assignments.find((a) => a.dancerId === dancerId)!;
    const straightDistance = distance(assignment.startPosition, assignment.endPosition);
    const duration = candidate.endTime - candidate.startTime;

    let path = candidate.path;
    let totalDistance = candidate.totalDistance;

    // Apply Time Filling if startTime === 0 and current path doesn't use full target time (only if no collision)
    if (candidate.startTime === 0 && duration >= targetEndTime - 0.01) {
      const wouldArriveEarly =
        candidate.totalDistance / cfg.maxHumanSpeed < targetEndTime - 0.5;
      const maxAllowedLength = straightDistance * cfg.maxDetourRatio;
      const targetLength = Math.min(targetPathLengthForSync, maxAllowedLength);

      if (wouldArriveEarly && targetLength > candidate.totalDistance + 0.1) {
        const filledPath = buildTimeFillingPath(
          assignment.startPosition,
          assignment.endPosition,
          cfg.totalCounts,
          cfg.numPoints,
          targetLength,
          straightDistance,
          cfg.maxDetourRatio
        );
        const filledLength = calculatePathDistance(filledPath);
        if (filledLength <= maxAllowedLength) {
          const otherPaths = results
            .filter((_, j) => j !== idx)
            .map((r) => r.candidate.path);
          if (
            !hasCollisionWithAny(
              filledPath,
              otherPaths,
              cfg.collisionRadius,
              cfg.totalCounts,
              cfg.timeStep
            )
          ) {
            path = filledPath;
            totalDistance = filledLength;
          }
        }
      }
    }

    const finalDuration = path.length > 0
      ? path[path.length - 1].t - path[0].t
      : duration;
    const speed = totalDistance / Math.max(finalDuration, 0.01);

    return {
      dancerId,
      path,
      startTime: path.length > 0 ? path[0].t : candidate.startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance,
    };
  });

  return finalResults.sort((a, b) => a.dancerId - b.dancerId);
}
