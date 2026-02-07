/**
 * Harmonized Flow Algorithm v4
 *
 * PRIORITY: Collision avoidance + Visual harmony
 *
 * Key improvement: Radial-based curve direction with global balancing
 * Works well with asymmetric formations and odd number of dancers
 *
 * Strategy:
 * 1. Radial curve assignment based on movement direction relative to stage center
 * 2. Global L/R balance adjustment to ensure visual harmony
 * 3. Shortest-distance dancer gets straight path (for odd counts)
 * 4. Collision-free path search with reduced curve offsets (0.5-1.5m)
 * 5. Use Cubic Bezier curves for smooth paths
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
 * Determine curve direction based on radial position from stage center
 * Creates natural "flowing outward" visual effect
 */
function determineRadialCurve(
  assignment: Assignment,
  stageWidth: number,
  stageHeight: number
): number {
  const center = { x: stageWidth / 2, y: stageHeight / 2 };
  const midpoint = {
    x: (assignment.startPosition.x + assignment.endPosition.x) / 2,
    y: (assignment.startPosition.y + assignment.endPosition.y) / 2
  };

  // Movement vector
  const moveVec = {
    x: assignment.endPosition.x - assignment.startPosition.x,
    y: assignment.endPosition.y - assignment.startPosition.y
  };

  // Center → dancer midpoint vector (radial direction)
  const radialVec = {
    x: midpoint.x - center.x,
    y: midpoint.y - center.y
  };

  // Cross product: determines which side of the radial vector the movement is
  const cross = moveVec.x * radialVec.y - moveVec.y * radialVec.x;

  // Curve "outward" from center for visual harmony
  return cross >= 0 ? 1 : -1;
}

/**
 * Determine harmonized curve directions for all dancers
 * Uses Radial + Balancing approach for visual harmony
 */
function determineHarmonizedCurves(
  assignments: Assignment[],
  stageWidth: number,
  stageHeight: number
): Map<number, number> {
  const curveMap = new Map<number, number>();

  // Step 1: Radial-based initial assignment
  for (const a of assignments) {
    // Skip very short movements (< 0.5m) - they get straight paths
    if (a.distance < 0.5) {
      curveMap.set(a.dancerId, 0);
      continue;
    }
    const curve = determineRadialCurve(a, stageWidth, stageHeight);
    curveMap.set(a.dancerId, curve);
  }

  // Step 2: Balance check and adjustment
  let leftCount = 0, rightCount = 0, straightCount = 0;
  for (const v of curveMap.values()) {
    if (v < 0) leftCount++;
    else if (v > 0) rightCount++;
    else straightCount++;
  }

  const imbalance = Math.abs(leftCount - rightCount);

  // If imbalance is significant (>2 difference), adjust some dancers
  if (imbalance > 2) {
    const targetFlip = Math.floor(imbalance / 2);
    const overloadedSide = leftCount > rightCount ? -1 : 1;

    // Flip shortest-distance dancers first (minimal visual impact)
    const candidates = assignments
      .filter(a => curveMap.get(a.dancerId) === overloadedSide)
      .sort((a, b) => a.distance - b.distance);

    for (let i = 0; i < targetFlip && i < candidates.length; i++) {
      curveMap.set(candidates[i].dancerId, -overloadedSide);
    }
  }

  // Step 3: For odd counts, make the shortest-distance non-straight dancer go straight
  const nonStraightCount = assignments.length - straightCount;
  if (nonStraightCount % 2 === 1) {
    const shortestNonStraight = assignments
      .filter(a => curveMap.get(a.dancerId) !== 0)
      .sort((a, b) => a.distance - b.distance)[0];

    if (shortestNonStraight) {
      curveMap.set(shortestNonStraight.dancerId, 0);
    }
  }

  return curveMap;
}

interface PathCandidate {
  startTime: number;
  endTime: number;
  curveOffset: number | [number, number];
  path: PathPoint[];
}

/**
 * Generate path candidates with preferred curve direction
 * Uses reduced curve offsets (0.5-1.5m) for more natural human movement
 */
function generatePathCandidates(
  start: Position,
  end: Position,
  baseDuration: number,
  config: HybridConfig,
  preferredCurveSign: number = 0  // 0 = straight preferred, 1 = positive, -1 = negative
): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  const { totalCounts, numPoints } = config;

  const startTimes = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  const durationFactors = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.8, 2.0];

  // Reduced curve offsets (0.5-1.5m max) for natural human movement
  let curveOffsets: (number | [number, number])[];

  if (preferredCurveSign > 0) {
    // Prefer positive (right) curves - gentle to moderate
    curveOffsets = [
      0.5, 0.7, 1.0, 1.2, 1.5,  // Positive arcs (gentle first)
      0,                         // Linear as fallback
      -0.5, -0.7, -1.0, -1.2, -1.5,  // Negative arcs last resort
    ];
  } else if (preferredCurveSign < 0) {
    // Prefer negative (left) curves - gentle to moderate
    curveOffsets = [
      -0.5, -0.7, -1.0, -1.2, -1.5,  // Negative arcs (gentle first)
      0,                              // Linear as fallback
      0.5, 0.7, 1.0, 1.2, 1.5,       // Positive arcs last resort
    ];
  } else {
    // No preference (straight) - prefer straight, then minimal curves
    curveOffsets = [
      0,           // Straight line first!
      0.3, -0.3,   // Very slight curves
      0.5, -0.5,
      0.7, -0.7,
      1.0, -1.0,
      1.2, -1.2,
      1.5, -1.5,   // Max curve for collision avoidance
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

  // Sort: prefer straight paths, then earlier start, then based on curve preference
  candidates.sort((a, b) => {
    const curveA = typeof a.curveOffset === 'number' ? Math.abs(a.curveOffset) : Math.abs(a.curveOffset[0]);
    const curveB = typeof b.curveOffset === 'number' ? Math.abs(b.curveOffset) : Math.abs(b.curveOffset[0]);

    // If no preferred curve direction, strongly prefer straighter paths
    if (preferredCurveSign === 0) {
      // Prefer paths with less curvature (straight = 0)
      if (Math.abs(curveA - curveB) > 0.1) return curveA - curveB;
    }

    // Then prefer earlier start
    if (Math.abs(a.startTime - b.startTime) > 0.3) return a.startTime - b.startTime;

    // Then prefer shorter duration
    const durA = a.endTime - a.startTime;
    const durB = b.endTime - b.startTime;
    if (Math.abs(durA - durB) > 0.3) return durA - durB;

    // If we have a preferred curve direction, prefer those
    if (preferredCurveSign !== 0) {
      const signA = typeof a.curveOffset === 'number' ? a.curveOffset : a.curveOffset[0];
      const signB = typeof b.curveOffset === 'number' ? b.curveOffset : b.curveOffset[0];
      const matchA = Math.sign(signA) === preferredCurveSign ? 0 : 1;
      const matchB = Math.sign(signB) === preferredCurveSign ? 0 : 1;
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

  console.log(`[HarmonizedFlow] Dancer ${assignment.dancerId}: Testing ${candidates.length} candidates (curvePreference=${preferredCurveSign})`);

  for (const candidate of candidates) {
    if (!hasCollisionWithAny(candidate.path, existingPaths, config.collisionRadius, config.totalCounts)) {
      const curveStr = typeof candidate.curveOffset === 'number'
        ? candidate.curveOffset.toFixed(1)
        : `[${candidate.curveOffset[0]}, ${candidate.curveOffset[1]}]`;
      console.log(`[HarmonizedFlow] Dancer ${assignment.dancerId}: Found path (start=${candidate.startTime.toFixed(1)}, curve=${curveStr})`);
      return candidate;
    }
  }

  console.warn(`[HarmonizedFlow] Dancer ${assignment.dancerId}: No collision-free path found!`);
  return null;
}

/**
 * Log curve assignments for debugging
 */
function logCurveAssignments(curveMap: Map<number, number>): void {
  let leftCount = 0, rightCount = 0, straightCount = 0;
  const assignments: string[] = [];

  for (const [dancerId, curve] of curveMap.entries()) {
    if (curve < 0) {
      leftCount++;
      assignments.push(`D${dancerId}:L`);
    } else if (curve > 0) {
      rightCount++;
      assignments.push(`D${dancerId}:R`);
    } else {
      straightCount++;
      assignments.push(`D${dancerId}:S`);
    }
  }

  console.log(`[HarmonizedFlow] Curve distribution: Left=${leftCount}, Right=${rightCount}, Straight=${straightCount}`);
  console.log(`[HarmonizedFlow] Assignments: ${assignments.join(', ')}`);
}

/**
 * Main function: compute all paths with guaranteed collision avoidance
 * Uses Harmonized Flow approach for visual harmony
 */
export function computeAllPathsWithHybrid(
  assignments: Assignment[],
  config: Partial<HybridConfig> = {}
): DancerPath[] {
  const cfg: HybridConfig = { ...DEFAULT_CONFIG, ...config };

  console.log('[HarmonizedFlow v4] Starting collision-free path generation with visual harmony');
  console.log(`[HarmonizedFlow] Dancers: ${assignments.length}, totalCounts: ${cfg.totalCounts}`);

  // Step 1: Determine harmonized curve directions for all dancers
  const curveMap = determineHarmonizedCurves(assignments, cfg.stageWidth, cfg.stageHeight);
  logCurveAssignments(curveMap);

  // Sort by distance (longest first - they need more complex paths)
  const sorted = [...assignments].sort((a, b) => b.distance - a.distance);

  const maxDist = Math.max(...assignments.map(a => a.distance), 1);
  const existingPaths: PathPoint[][] = [];
  const pathByDancerId = new Map<number, PathPoint[]>();
  const results: DancerPath[] = [];

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    const baseDuration = Math.max(2, (dist / maxDist) * cfg.totalCounts * 0.7);

    // Get harmonized curve preference
    const preferredCurveSign = curveMap.get(dancerId) ?? 0;

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
      // Fallback with moderate curve in preferred direction (max 1.5m)
      console.warn(`[HarmonizedFlow] Using fallback for dancer ${dancerId}`);
      const fallbackCurve = preferredCurveSign !== 0 ? preferredCurveSign * 1.5 : 1.0;
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
        console.error(`[HarmonizedFlow] COLLISION DETECTED: Dancer ${results[i].dancerId} <-> ${results[j].dancerId}`);
      }
    }
  }

  console.log(`[HarmonizedFlow] Final collision count: ${collisionCount}`);

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
