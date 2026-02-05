/**
 * Hybrid Choreography Algorithm by Gemini
 *
 * PRIORITY:
 * 1. Collision Free (Hard Constraint)
 * 2. Time Synchronization
 * 3. Linear Base with Curved Detour
 * 4. Natural Kinematics
 * 5. Load Balancing
 *
 * Strategy:
 * 1. Calculate max duration based on the longest straight path.
 * 2. All dancers have the same start and end time.
 * 3. Initially, all paths are linear.
 * 4. Iteratively resolve collisions by adding curves.
 * 5. Dancers with more slack time are prioritized for detours.
 * 6. If collision persists, delay dancers with smaller Y coordinates.
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
}

const DEFAULT_CONFIG: HybridConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 30,
  maxHumanSpeed: 1.5,
};

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

    const x = oneMinusT3 * start.x + 3 * oneMinusT2 * t * c1x + 3 * oneMinusT * t2 * c2x + t3 * end.x;
    const y = oneMinusT3 * start.y + 3 * oneMinusT2 * t * c1y + 3 * oneMinusT * t2 * c2y + t3 * end.y;

    path.push({ x, y, t: time });
  }
  return path;
}

function findCollisions(
  paths: DancerPath[],
  collisionRadius: number
): { dancer1: number; dancer2: number; time: number }[] {
  const collisions: { dancer1: number; dancer2: number; time: number }[] = [];
  const maxTime = Math.max(...paths.map(p => p.path[p.path.length - 1]?.t || 0));

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const path1 = paths[i];
      const path2 = paths[j];
      const duration = Math.min(maxTime, path1.path[path1.path.length - 1].t, path2.path[path2.path.length - 1].t);

      for (let t = 0; t <= duration; t += 0.2) {
        const pos1 = getPositionAtTime(path1.path, t);
        const pos2 = getPositionAtTime(path2.path, t);
        if (pos1 && pos2 && distance(pos1, pos2) < collisionRadius * 2) {
          collisions.push({ dancer1: path1.dancerId, dancer2: path2.dancerId, time: t });
          break; 
        }
      }
    }
  }
  return collisions;
}

export function computeAllPathsWithHybridByGemini(
  assignments: Assignment[],
  config: Partial<HybridConfig> = {}
): DancerPath[] {
  const cfg: HybridConfig = { ...DEFAULT_CONFIG, ...config };
  console.log('[HybridByGemini] Starting path generation...');

  const speed = cfg.maxHumanSpeed;
  const minDuration = 2;
  const maxDuration = Math.max(
    minDuration,
    ...assignments.map(a => a.distance / speed)
  );

  const startTime = 0;
  const endTime = Math.min(cfg.totalCounts, maxDuration + 1);

  let paths: DancerPath[] = assignments.map(assignment => {
    const duration = endTime - startTime;
    const path = generateCubicBezierPath(
      assignment.startPosition,
      assignment.endPosition,
      startTime,
      endTime,
      cfg.numPoints,
      0
    );
    const totalDistance = calculatePathDistance(path);
    return {
      dancerId: assignment.dancerId,
      path,
      startTime,
      speed: totalDistance / duration,
      totalDistance,
      curveOffset: 0,
      slack: duration - assignment.distance / speed,
    };
  });

  const MAX_ITERATIONS = 15;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const collisions = findCollisions(paths, cfg.collisionRadius);
    if (collisions.length === 0) {
      console.log(`[HybridByGemini] Found collision-free paths after ${iter} iterations.`);
      break;
    }

    console.log(`[HybridByGemini] Iteration ${iter}, Collisions: ${collisions.length}`);

    const involvedDancers = new Set<number>();
    collisions.forEach(c => {
      involvedDancers.add(c.dancer1);
      involvedDancers.add(c.dancer2);
    });

    involvedDancers.forEach(dancerId => {
      const dancerPath = paths.find(p => p.dancerId === dancerId);
      if (!dancerPath) return;

      const assignment = assignments.find(a => a.dancerId === dancerId);
      if (!assignment) return;

      const otherPaths = paths.filter(p => p.dancerId !== dancerId);
      let bestPath = dancerPath;
      let minCollisions = findCollisions([dancerPath, ...otherPaths], cfg.collisionRadius).length;

      const curveCandidates = [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.5, -2.5];
      for (const curve of curveCandidates) {
        const newPathPoints = generateCubicBezierPath(
          assignment.startPosition,
          assignment.endPosition,
          dancerPath.startTime,
          endTime,
          cfg.numPoints,
          curve
        );
        const newPath: DancerPath = { ...dancerPath, path: newPathPoints };
        const currentCollisions = findCollisions([newPath, ...otherPaths], cfg.collisionRadius).length;

        if (currentCollisions < minCollisions) {
          minCollisions = currentCollisions;
          bestPath = newPath;
        }
      }
      paths = paths.map(p => (p.dancerId === dancerId ? bestPath : p));
    });

    if (iter === MAX_ITERATIONS - 1) {
      console.warn('[HybridByGemini] Max iterations reached, attempting to delay paths.');
      const collisions = findCollisions(paths, cfg.collisionRadius);
      const dancersToDelay = new Set<number>();
      collisions.forEach(c => {
        const d1 = assignments.find(a => a.dancerId === c.dancer1);
        const d2 = assignments.find(a => a.dancerId === c.dancer2);
        if (!d1 || !d2) return;

        if (d1.startPosition.y < d2.startPosition.y) {
          dancersToDelay.add(d1.dancerId);
        } else {
          dancersToDelay.add(d2.dancerId);
        }
      });

      dancersToDelay.forEach(dancerId => {
        const dancerPath = paths.find(p => p.dancerId === dancerId);
        const assignment = assignments.find(a => a.dancerId === dancerId);
        if (!dancerPath || !assignment) return;

        const newStartTime = Math.min(dancerPath.startTime + 0.5, endTime - minDuration);
        if (newStartTime > dancerPath.startTime) {
          const newPathPoints = generateCubicBezierPath(
            assignment.startPosition,
            assignment.endPosition,
            newStartTime,
            endTime,
            cfg.numPoints,
            0 // Use default curve offset for delayed paths
          );
          paths = paths.map(p => (p.dancerId === dancerId ? { ...dancerPath, path: newPathPoints, startTime: newStartTime } : p));
        }
      });
    }
  }

  const finalCollisions = findCollisions(paths, cfg.collisionRadius);
  console.log(`[HybridByGemini] Final collision count: ${finalCollisions.length}`);
  if (finalCollisions.length > 0) {
    console.error('[HybridByGemini] Could not resolve all collisions.', finalCollisions);
  }

  return paths.sort((a, b) => a.dancerId - b.dancerId);
}

export function validateHybridPaths(
  paths: DancerPath[],
  collisionRadius: number
): { valid: boolean; collisions: { dancer1: number; dancer2: number; time: number }[] } {
  const collisions = findCollisions(paths, collisionRadius);
  return {
    valid: collisions.length === 0,
    collisions,
  };
}

export { generateCubicBezierPath };
