/**
 * Hybrid By Cursor
 *
 * Multidate Candidate Mode: Start formation → End formation 경로 계산.
 * 우선순위:
 * 1. [Hard] 충돌 방지 (Collision Free)
 * 2. [Movement] 직선 우선, 회피/지연 시 부드러운 곡선 (Linear Base + Curved Detour)
 * 3. [Time] 도착 시간 동기화 — Time Filling(곡선 데투어), Delay 시 Y 작은 인원 지연
 * 4. [Kinematics] 자연스러운 속도, 급격한 방향 전환 없음
 * 5. [Load] 이동 거리 편차 제어 (maxDetourRatio)
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

/** 곡선 오프셋 후보 (직선 우선, 회피 시 부드러운 곡선) */
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

/** 최대 지연 가능 시간 (물리적 한계) */
function computeMaxDelay(
  straightDistance: number,
  totalCounts: number,
  maxHumanSpeed: number
): number {
  const minDuration = straightDistance / Math.max(maxHumanSpeed, 0.1);
  return Math.max(0, totalCounts - minDuration);
}

/** Delay 허용도: Y가 작을수록(무대 뒤) 더 많이 지연 가능 */
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
 * Time Filling: 일찍 도착하는 인원을 위해 곡선 데투어로 도착 시간을 totalCounts에 맞춤.
 * 목표 길이 = min(maxHumanSpeed * totalCounts, straightDistance * maxDetourRatio)
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

  // 처리 순서: 거리 긴 순, 동일하면 Y 큰 순(앞쪽 먼저) → 뒤쪽(Y 작은)이 나중에 처리되어 지연 허용 대상이 됨
  const sorted = [...assignments].sort((a, b) => {
    if (b.distance !== a.distance) return b.distance - a.distance;
    return b.startPosition.y - a.startPosition.y;
  });

  const existingPaths: PathPoint[][] = [];
  const results: { dancerId: number; candidate: PathCandidate }[] = [];
  const curveOffsets = buildCurveOffsets(cfg.maxCurveOffset);

  // ---------- Phase 1: 충돌 없이 경로 배정 (직선 우선, 필요 시 곡선/지연) ----------
  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition } = assignment;
    const straightDistance = distance(startPosition, endPosition);
    const maxDelayBase = computeMaxDelay(straightDistance, cfg.totalCounts, cfg.maxHumanSpeed);
    const delayAllowance = getDelayAllowance(startPosition.y, cfg.stageHeight);
    const maxDelay = maxDelayBase * delayAllowance;

    let selected: PathCandidate | null = null;

    // 1) 직선 우선: start 0, end totalCounts
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

    // 2) 직선 불가 시 부드러운 곡선(Bezier) 데투어 시도
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

    // 3) 여전히 충돌 시 지연: Y 작은 인원(뒤쪽) 도착 지연
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

    // 4) Fallback: 데투어 범위 확대
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

    // 5) 최후: 직선 강제 (검증 시 충돌 플래그됨)
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

  // ---------- Phase 2: 도착 시간 동기화 — Time Filling (곡선 데투어로 동시 도착) ----------
  const targetPathLengthForSync = cfg.maxHumanSpeed * targetEndTime;

  const finalResults: DancerPath[] = results.map(({ dancerId, candidate }, idx) => {
    const assignment = assignments.find((a) => a.dancerId === dancerId)!;
    const straightDistance = distance(assignment.startPosition, assignment.endPosition);
    const duration = candidate.endTime - candidate.startTime;

    let path = candidate.path;
    let totalDistance = candidate.totalDistance;

    // startTime === 0 이고, 현재 경로가 목표 시간을 다 쓰지 않으면 Time Filling (충돌 없을 때만)
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
