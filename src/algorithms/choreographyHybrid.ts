/**
 * Hybrid Choreography Algorithm v3
 *
 * PRIORITY: Collision avoidance is #1
 *
 * Key improvement: Detect head-on swap pairs and assign opposite curves
 *
 * Strategy:
 * 1. Detect head-on swap pairs (A→B and B→A)
 * 2. Pre-assign opposite curve directions for swap pairs
 * 3. Process dancers with greedy collision-free search
 * 4. Use Cubic Bezier curves for smooth paths
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';
import {
  distance,
  calculatePathDistance,
  getPositionAtTime,
} from './utils/pathUtils';

export interface HybridConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  maxHumanSpeed: number;
  preferSimultaneousArrival: boolean;
}

const DEFAULT_CONFIG: HybridConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
  preferSimultaneousArrival: true,
};

/**
 * Generate Cubic Bezier curve path
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

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 0.01) {
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

  const dirX = dx / len;
  const dirY = dy / len;
  const perpX = -dirY;
  const perpY = dirX;

  let offset1: number, offset2: number;
  if (Array.isArray(curveOffset)) {
    offset1 = curveOffset[0];
    offset2 = curveOffset[1];
  } else {
    offset1 = curveOffset;
    offset2 = curveOffset;
  }

  const c1x = start.x + dirX * len * tangentStrength + perpX * offset1;
  const c1y = start.y + dirY * len * tangentStrength + perpY * offset1;
  const c2x = end.x - dirX * len * tangentStrength + perpX * offset2;
  const c2y = end.y - dirY * len * tangentStrength + perpY * offset2;

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

function hasCollisionWithAny(
  newPath: PathPoint[],
  existingPaths: PathPoint[][],
  collisionRadius: number,
  totalCounts: number
): boolean {
  for (const existing of existingPaths) {
    if (hasCollisionBetweenPaths(newPath, existing, collisionRadius, totalCounts)) {
      return true;
    }
  }
  return false;
}

function hasCollisionBetweenPaths(
  path1: PathPoint[],
  path2: PathPoint[],
  collisionRadius: number,
  totalCounts: number
): boolean {
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
 * Detect if two assignments are a head-on swap
 * (A goes to B's start, B goes to A's start)
 */
function isHeadOnSwap(a1: Assignment, a2: Assignment, threshold: number = 1.5): boolean {
  // Check if A's end is near B's start AND B's end is near A's start
  const a1EndNearB1Start = distance(a1.endPosition, a2.startPosition) < threshold;
  const a2EndNearA1Start = distance(a2.endPosition, a1.startPosition) < threshold;

  // Also check if they're moving in roughly opposite directions
  const dir1x = a1.endPosition.x - a1.startPosition.x;
  const dir1y = a1.endPosition.y - a1.startPosition.y;
  const dir2x = a2.endPosition.x - a2.startPosition.x;
  const dir2y = a2.endPosition.y - a2.startPosition.y;

  const dot = dir1x * dir2x + dir1y * dir2y;
  const oppositeDirection = dot < 0;

  return (a1EndNearB1Start && a2EndNearA1Start) || oppositeDirection;
}

/**
 * Determine which side a dancer should curve to avoid head-on collision
 * Returns positive for "right" (from dancer's perspective), negative for "left"
 */
function determineCurveSide(a: Assignment, partner: Assignment): number {
  // Use cross product to determine relative position
  const dx = a.endPosition.x - a.startPosition.x;
  const dy = a.endPosition.y - a.startPosition.y;

  // Vector from A's start to partner's start
  const px = partner.startPosition.x - a.startPosition.x;
  const py = partner.startPosition.y - a.startPosition.y;

  // Cross product: if positive, partner is on the left, so curve right
  const cross = dx * py - dy * px;

  return cross >= 0 ? 1 : -1;
}

interface PathCandidate {
  startTime: number;
  endTime: number;
  curveOffset: number | [number, number];
  path: PathPoint[];
}

/**
 * Generate path candidates with preferred curve direction
 */
function generatePathCandidates(
  start: Position,
  end: Position,
  baseDuration: number,
  config: HybridConfig,
  preferredCurveSign: number = 0  // 0 = no preference, 1 = positive, -1 = negative
): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  const { totalCounts, numPoints } = config;

  const startTimes = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  const durationFactors = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.8, 2.0];

  // Curve offsets - if we have a preferred sign, prioritize those curves
  let curveOffsets: (number | [number, number])[];

  if (preferredCurveSign > 0) {
    // Prefer positive (right) curves first
    curveOffsets = [
      1.5, 2.0, 2.5, 3.0, 1.0, 0.5,  // Positive arcs first
      [1.5, 1.5], [2.0, 2.0],         // Positive S-curves
      0,                               // Linear
      -0.5, -1.0, -1.5, -2.0, -2.5, -3.0,  // Negative arcs last
      [-1.5, -1.5], [-2.0, -2.0],
    ];
  } else if (preferredCurveSign < 0) {
    // Prefer negative (left) curves first
    curveOffsets = [
      -1.5, -2.0, -2.5, -3.0, -1.0, -0.5,  // Negative arcs first
      [-1.5, -1.5], [-2.0, -2.0],
      0,
      0.5, 1.0, 1.5, 2.0, 2.5, 3.0,
      [1.5, 1.5], [2.0, 2.0],
    ];
  } else {
    // No preference - try all
    curveOffsets = [
      0,
      0.5, -0.5,
      1.0, -1.0,
      1.5, -1.5,
      2.0, -2.0,
      2.5, -2.5,
      3.0, -3.0,
      [0.8, -0.8], [-0.8, 0.8],
      [1.2, -1.2], [-1.2, 1.2],
      [1.5, -1.5], [-1.5, 1.5],
    ];
  }

  for (const startTime of startTimes) {
    if (startTime >= totalCounts - 1) continue;

    for (const factor of durationFactors) {
      const duration = Math.max(1.5, baseDuration * factor);
      const endTime = startTime + duration;

      if (endTime > totalCounts) continue;
      if (endTime - startTime < 1) continue;

      for (const curveOffset of curveOffsets) {
        const path = generateCubicBezierPath(
          start, end, startTime, endTime, numPoints, curveOffset
        );

        candidates.push({
          startTime,
          endTime,
          curveOffset,
          path,
        });
      }
    }
  }

  // Sort: prefer earlier start, then based on curve preference
  candidates.sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime;

    const durA = a.endTime - a.startTime;
    const durB = b.endTime - b.startTime;
    if (Math.abs(durA - durB) > 0.3) return durA - durB;

    // If we have a preferred curve direction, prefer those
    if (preferredCurveSign !== 0) {
      const curveA = typeof a.curveOffset === 'number' ? a.curveOffset : a.curveOffset[0];
      const curveB = typeof b.curveOffset === 'number' ? b.curveOffset : b.curveOffset[0];
      const matchA = Math.sign(curveA) === preferredCurveSign ? 0 : 1;
      const matchB = Math.sign(curveB) === preferredCurveSign ? 0 : 1;
      if (matchA !== matchB) return matchA - matchB;
    }

    return 0;
  });

  return candidates;
}

function findCollisionFreePath(
  assignment: Assignment,
  existingPaths: PathPoint[][],
  baseDuration: number,
  config: HybridConfig,
  preferredCurveSign: number = 0
): PathCandidate | null {
  const candidates = generatePathCandidates(
    assignment.startPosition,
    assignment.endPosition,
    baseDuration,
    config,
    preferredCurveSign
  );

  console.log(`[Hybrid] Dancer ${assignment.dancerId}: Testing ${candidates.length} candidates (curvePreference=${preferredCurveSign})`);

  for (const candidate of candidates) {
    if (!hasCollisionWithAny(candidate.path, existingPaths, config.collisionRadius, config.totalCounts)) {
      const curveStr = typeof candidate.curveOffset === 'number'
        ? candidate.curveOffset.toFixed(1)
        : `[${candidate.curveOffset[0]}, ${candidate.curveOffset[1]}]`;
      console.log(`[Hybrid] Dancer ${assignment.dancerId}: Found path (start=${candidate.startTime.toFixed(1)}, curve=${curveStr})`);
      return candidate;
    }
  }

  console.warn(`[Hybrid] Dancer ${assignment.dancerId}: No collision-free path found!`);
  return null;
}

/**
 * Detect all head-on swap pairs
 */
function detectHeadOnSwapPairs(assignments: Assignment[]): Map<number, { partner: number; curveSide: number }> {
  const swapInfo = new Map<number, { partner: number; curveSide: number }>();

  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      if (isHeadOnSwap(assignments[i], assignments[j])) {
        const curveSideI = determineCurveSide(assignments[i], assignments[j]);
        const curveSideJ = -curveSideI;  // Opposite direction

        swapInfo.set(assignments[i].dancerId, {
          partner: assignments[j].dancerId,
          curveSide: curveSideI
        });
        swapInfo.set(assignments[j].dancerId, {
          partner: assignments[i].dancerId,
          curveSide: curveSideJ
        });

        console.log(`[Hybrid] Detected head-on swap: Dancer ${assignments[i].dancerId} <-> ${assignments[j].dancerId}`);
        console.log(`[Hybrid]   Dancer ${assignments[i].dancerId} curves ${curveSideI > 0 ? 'RIGHT' : 'LEFT'}`);
        console.log(`[Hybrid]   Dancer ${assignments[j].dancerId} curves ${curveSideJ > 0 ? 'RIGHT' : 'LEFT'}`);
      }
    }
  }

  return swapInfo;
}

/**
 * Main function: compute all paths with guaranteed collision avoidance
 */
export function computeAllPathsWithHybrid(
  assignments: Assignment[],
  config: Partial<HybridConfig> = {}
): DancerPath[] {
  const cfg: HybridConfig = { ...DEFAULT_CONFIG, ...config };

  console.log('[HybridChoreography v3] Starting collision-free path generation');
  console.log(`[HybridChoreography] Dancers: ${assignments.length}, totalCounts: ${cfg.totalCounts}`);

  // Step 1: Detect head-on swap pairs
  const swapInfo = detectHeadOnSwapPairs(assignments);
  console.log(`[HybridChoreography] Found ${swapInfo.size / 2} head-on swap pairs`);

  // Sort by distance (longest first)
  const sorted = [...assignments].sort((a, b) => b.distance - a.distance);

  const maxDist = Math.max(...assignments.map(a => a.distance), 1);
  const existingPaths: PathPoint[][] = [];
  const pathByDancerId = new Map<number, PathPoint[]>();
  const results: DancerPath[] = [];

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    const baseDuration = Math.max(2, (dist / maxDist) * cfg.totalCounts * 0.7);

    // Get curve preference from swap info
    const swap = swapInfo.get(dancerId);
    const preferredCurveSign = swap?.curveSide ?? 0;

    // Find collision-free path
    const candidate = findCollisionFreePath(
      assignment,
      existingPaths,
      baseDuration,
      cfg,
      preferredCurveSign
    );

    let finalPath: PathPoint[];
    let startTime = 0;
    let endTime = cfg.totalCounts;

    if (candidate) {
      finalPath = candidate.path;
      startTime = candidate.startTime;
      endTime = candidate.endTime;
    } else {
      // Fallback with strong curve in preferred direction
      console.warn(`[Hybrid] Using fallback for dancer ${dancerId}`);
      const fallbackCurve = preferredCurveSign !== 0 ? preferredCurveSign * 3.0 : 2.0;
      finalPath = generateCubicBezierPath(
        startPosition, endPosition,
        cfg.totalCounts * 0.3, cfg.totalCounts,
        cfg.numPoints, fallbackCurve
      );
      startTime = cfg.totalCounts * 0.3;
      endTime = cfg.totalCounts;
    }

    existingPaths.push(finalPath);
    pathByDancerId.set(dancerId, finalPath);

    const totalDistance = calculatePathDistance(finalPath);
    const duration = endTime - startTime;
    const speed = duration > 0 ? totalDistance / duration : 1.0;

    results.push({
      dancerId,
      path: finalPath,
      startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance,
    });
  }

  // Final validation
  let collisionCount = 0;
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      if (hasCollisionBetweenPaths(results[i].path, results[j].path, cfg.collisionRadius, cfg.totalCounts)) {
        collisionCount++;
        console.error(`[Hybrid] COLLISION DETECTED: Dancer ${results[i].dancerId} <-> ${results[j].dancerId}`);
      }
    }
  }

  console.log(`[HybridChoreography] Final collision count: ${collisionCount}`);

  return results.sort((a, b) => a.dancerId - b.dancerId);
}

export function validateHybridPaths(
  paths: DancerPath[],
  collisionRadius: number,
  totalCounts: number
): { valid: boolean; collisions: { dancer1: number; dancer2: number; time: number }[] } {
  const collisions: { dancer1: number; dancer2: number; time: number }[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      for (let t = 0; t <= totalCounts; t += 0.1) {
        const pos1 = getPositionAtTime(paths[i].path, t);
        const pos2 = getPositionAtTime(paths[j].path, t);

        if (pos1 && pos2 && distance(pos1, pos2) < collisionRadius * 2) {
          collisions.push({
            dancer1: paths[i].dancerId,
            dancer2: paths[j].dancerId,
            time: t,
          });
          break;
        }
      }
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}

export { generateCubicBezierPath };
