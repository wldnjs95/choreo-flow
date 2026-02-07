/**
 * Multi-Candidate Generator
 *
 * Strategy:
 * 1. Generate multiple path candidates with various parameter combinations
 * 2. Calculate metrics for each candidate
 * 3. Gemini selects optimal candidate based on metrics
 */

import { computeAssignment } from './hungarian';
import type { Position, Assignment, AssignmentMode } from './hungarian';
import { validatePathsSimple } from './pathfinder';
import type { DancerPath, PathPoint } from './pathfinder';
import { computeAllPathsWithHybrid } from './choreographyHybrid';
import { computeAllPathsWithHybridByCodex } from './hybridByCodex';
import { computeAllPathsWithHybridByClaude } from './hybridByClaude';
import { computeAllPathsWithHybridByClaudeCubic } from './hybridByClaudeCubic';
import { computeAllPathsWithHybridByCursor } from './hybridByCursor';
import { computeAllPathsWithHybridByGemini } from './choreographyHybridByGemini';

/**
 * Candidate generation strategy (Pathfinding algorithms)
 */
export type CandidateStrategy =
  | 'harmonized_flow'    // Harmonized flow (radial + balanced curves)
  | 'balanced_direct'    // Balanced direct paths (load balanced)
  | 'clean_flow'         // Clean flow (minimizes path crossings)
  | 'natural_curves'     // Natural curves (asymmetric Cubic Bezier)
  | 'wave_sync'          // Wave sync (staggered timing)
  | 'perfect_sync';      // Perfect sync (strict time synchronization)

/**
 * Candidate metrics
 */
export interface CandidateMetrics {
  collisionCount: number;      // Collision count (0 is best)
  symmetryScore: number;       // Symmetry score (0-100)
  pathSmoothness: number;      // Path smoothness (0-100, higher for straighter)
  crossingCount: number;       // Path crossing count
  maxDelay: number;            // Maximum start delay time
  avgDelay: number;            // Average start delay time
  simultaneousArrival: number; // Simultaneous arrival score (0-100)
  totalDistance: number;       // Total travel distance
}

/**
 * Candidate result
 */
export interface CandidateResult {
  id: string;
  strategy: CandidateStrategy;
  paths: DancerPath[];
  metrics: CandidateMetrics;
  assignments: Assignment[];
}

/**
 * Multi-candidate generation config
 */
export interface CandidateGeneratorConfig {
  strategies: CandidateStrategy[];
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  assignmentMode: AssignmentMode;  // 'fixed', 'partial', or 'optimal'
  lockedDancers?: Set<number>;     // For partial mode: locked dancer indices
}

const DEFAULT_STRATEGIES: CandidateStrategy[] = [
  'perfect_sync',
  'wave_sync',
  'natural_curves',   // Cubic Bezier (asymmetric curves)
  'clean_flow',       // Quadratic Bezier (symmetric curves)
  'balanced_direct',
  'harmonized_flow',  // Radial + balanced curves
];

/**
 * Distance between two points
 */
function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Compare if two path arrays are equal (with tolerance)
 */
function arePathsEqual(paths1: DancerPath[], paths2: DancerPath[], tolerance: number = 0.01): boolean {
  if (paths1.length !== paths2.length) return false;

  // Sort by dancerId for comparison
  const sorted1 = [...paths1].sort((a, b) => a.dancerId - b.dancerId);
  const sorted2 = [...paths2].sort((a, b) => a.dancerId - b.dancerId);

  for (let i = 0; i < sorted1.length; i++) {
    const p1 = sorted1[i];
    const p2 = sorted2[i];

    if (p1.dancerId !== p2.dancerId) return false;
    if (Math.abs(p1.startTime - p2.startTime) > tolerance) return false;
    if (p1.path.length !== p2.path.length) return false;

    // Compare main points of path (start, middle, end)
    const checkIndices = [0, Math.floor(p1.path.length / 2), p1.path.length - 1];
    for (const idx of checkIndices) {
      if (idx < p1.path.length && idx < p2.path.length) {
        const pt1 = p1.path[idx];
        const pt2 = p2.path[idx];
        if (Math.abs(pt1.x - pt2.x) > tolerance || Math.abs(pt1.y - pt2.y) > tolerance) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Calculate path curvature (deviation from straight line)
 */
function calculatePathCurvature(path: PathPoint[]): number {
  if (path.length < 3) return 0;

  const start = path[0];
  const end = path[path.length - 1];
  const directDistance = distance(start, end);

  if (directDistance === 0) return 0;

  let maxDeviation = 0;
  for (let i = 1; i < path.length - 1; i++) {
    // Calculate distance from point to line
    const t = ((path[i].x - start.x) * (end.x - start.x) +
               (path[i].y - start.y) * (end.y - start.y)) / (directDistance * directDistance);
    const projX = start.x + t * (end.x - start.x);
    const projY = start.y + t * (end.y - start.y);
    const deviation = distance(path[i], { x: projX, y: projY });
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return maxDeviation;
}

/**
 * Calculate path crossing count
 */
function countPathCrossings(paths: DancerPath[], totalCounts: number): number {
  let crossings = 0;
  const timeStep = 0.5;

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      // Check if two paths cross
      let prevOrder: number | null = null;

      for (let t = 0; t <= totalCounts; t += timeStep) {
        const pos1 = getPositionAtTime(paths[i].path, t);
        const pos2 = getPositionAtTime(paths[j].path, t);

        if (!pos1 || !pos2) continue;

        // Order based on X coordinate
        const currentOrder = pos1.x < pos2.x ? 1 : -1;

        if (prevOrder !== null && prevOrder !== currentOrder) {
          crossings++;
        }
        prevOrder = currentOrder;
      }
    }
  }

  return crossings;
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
 * Calculate symmetry score
 */
function calculateSymmetryScore(paths: DancerPath[], stageWidth: number, totalCounts: number): number {
  const centerX = stageWidth / 2;
  let totalSymmetry = 0;
  let sampleCount = 0;

  for (let t = 0; t <= totalCounts; t += 1) {
    const positions = paths.map(p => getPositionAtTime(p.path, t)).filter(Boolean) as Position[];

    if (positions.length === 0) continue;

    // Check if there's a dancer at the symmetric position relative to center line
    let matchedPairs = 0;
    const used = new Set<number>();

    for (let i = 0; i < positions.length; i++) {
      if (used.has(i)) continue;

      const mirrorX = 2 * centerX - positions[i].x;

      // Find closest dancer to symmetric position
      let bestMatch = -1;
      let bestDist = Infinity;

      for (let j = 0; j < positions.length; j++) {
        if (i === j || used.has(j)) continue;

        const dist = distance(positions[j], { x: mirrorX, y: positions[i].y });
        if (dist < bestDist && dist < 1.0) { // Within 1m counts as symmetric
          bestDist = dist;
          bestMatch = j;
        }
      }

      if (bestMatch !== -1) {
        matchedPairs++;
        used.add(i);
        used.add(bestMatch);
      }
    }

    const symmetryRatio = positions.length > 1
      ? (matchedPairs * 2) / positions.length
      : 1;
    totalSymmetry += symmetryRatio;
    sampleCount++;
  }

  return sampleCount > 0 ? Math.round((totalSymmetry / sampleCount) * 100) : 0;
}

/**
 * Calculate simultaneous arrival score
 */
function calculateSimultaneousArrivalScore(paths: DancerPath[], totalCounts: number): number {
  if (paths.length === 0) return 100;

  // Each dancer's arrival time (last movement time)
  const arrivalTimes = paths.map(p => {
    const lastPoint = p.path[p.path.length - 1];
    return lastPoint ? lastPoint.t : totalCounts;
  });

  const maxArrival = Math.max(...arrivalTimes);
  const minArrival = Math.min(...arrivalTimes);
  const spread = maxArrival - minArrival;

  // spread 0 = perfect simultaneous arrival
  // spread = totalCounts = worst
  const score = Math.max(0, 100 - (spread / totalCounts) * 100);
  return Math.round(score);
}

/**
 * Calculate metrics
 */
export function calculateMetrics(
  paths: DancerPath[],
  totalCounts: number,
  collisionRadius: number,
  stageWidth: number
): CandidateMetrics {
  // Collision check
  const validation = validatePathsSimple(paths, collisionRadius, totalCounts);

  // Path smoothness (inverse of curvature)
  const curvatures = paths.map(p => calculatePathCurvature(p.path));
  const avgCurvature = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
  const smoothness = Math.max(0, Math.round(100 - avgCurvature * 50));

  // Crossing count
  const crossingCount = countPathCrossings(paths, totalCounts);

  // Delay time
  const delays = paths.map(p => p.startTime);
  const maxDelay = Math.max(...delays);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

  // Symmetry
  const symmetryScore = calculateSymmetryScore(paths, stageWidth, totalCounts);

  // Simultaneous arrival
  const simultaneousArrival = calculateSimultaneousArrivalScore(paths, totalCounts);

  // Total distance
  const totalDistance = paths.reduce((sum, p) => sum + p.totalDistance, 0);

  return {
    collisionCount: validation.collisions.length,
    symmetryScore,
    pathSmoothness: smoothness,
    crossingCount,
    maxDelay,
    avgDelay,
    simultaneousArrival,
    totalDistance,
  };
}


/**
 * Generate single candidate
 */
export function generateCandidate(
  strategy: CandidateStrategy,
  startPositions: Position[],
  endPositions: Position[],
  config: {
    totalCounts: number;
    collisionRadius: number;
    stageWidth: number;
    stageHeight: number;
    assignmentMode?: AssignmentMode;
    lockedDancers?: Set<number>;
  }
): CandidateResult {
  // 1. Assignment (fixed by default, optimal for large groups)
  const assignmentMode = config.assignmentMode || 'fixed';
  const assignments = computeAssignment(startPositions, endPositions, assignmentMode, config.lockedDancers);

  // 2. Generate paths with selected algorithm
  let paths: DancerPath[];
  if (strategy === 'harmonized_flow') {
    // Harmonized Flow: radial + balanced curves for visual harmony
    paths = computeAllPathsWithHybrid(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
      preferSimultaneousArrival: true,
    });
  } else if (strategy === 'balanced_direct') {
    // Balanced Direct: linear base + curved detour, load balanced
    paths = computeAllPathsWithHybridByCodex(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
      maxCurveOffset: 3.0,
      maxDetourRatio: 1.8,
      timeStep: 0.1,
    });
  } else if (strategy === 'clean_flow') {
    // Clean Flow: Quadratic Bezier, minimizes path crossings
    paths = computeAllPathsWithHybridByClaude(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
      syncMode: 'balanced',
    });
  } else if (strategy === 'natural_curves') {
    // Natural Curves: Cubic Bezier, asymmetric curves for organic movement
    paths = computeAllPathsWithHybridByClaudeCubic(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
      syncMode: 'balanced',
    });
  } else if (strategy === 'wave_sync') {
    // Wave Sync: staggered timing, back-to-front wave motion
    paths = computeAllPathsWithHybridByCursor(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
      maxCurveOffset: 3.0,
      maxDetourRatio: 1.8,
      timeStep: 0.1,
    });
  } else {
    // Default: Perfect Sync (strict time synchronization)
    paths = computeAllPathsWithHybridByGemini(assignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,
    });
  }

  // 4. Calculate metrics
  const metrics = calculateMetrics(
    paths,
    config.totalCounts,
    config.collisionRadius,
    config.stageWidth
  );

  return {
    id: `candidate_${strategy}`,
    strategy,
    paths,
    metrics,
    assignments,
  };
}

/**
 * Generate candidates with all strategies (remove duplicates)
 */
export function generateAllCandidates(
  startPositions: Position[],
  endPositions: Position[],
  config: Partial<CandidateGeneratorConfig> = {}
): CandidateResult[] {
  const fullConfig: CandidateGeneratorConfig = {
    strategies: config.strategies || DEFAULT_STRATEGIES,
    totalCounts: config.totalCounts || 8,
    collisionRadius: config.collisionRadius || 0.5,
    stageWidth: config.stageWidth || 12,
    stageHeight: config.stageHeight || 10,
    assignmentMode: config.assignmentMode || 'fixed',  // Default: fixed assignment
    lockedDancers: config.lockedDancers,
  };

  const allCandidates: CandidateResult[] = [];

  for (const strategy of fullConfig.strategies) {
    const candidate = generateCandidate(strategy, startPositions, endPositions, {
      totalCounts: fullConfig.totalCounts,
      collisionRadius: fullConfig.collisionRadius,
      stageWidth: fullConfig.stageWidth,
      stageHeight: fullConfig.stageHeight,
      assignmentMode: fullConfig.assignmentMode,
      lockedDancers: fullConfig.lockedDancers,
    });
    allCandidates.push(candidate);
  }

  // Remove duplicates: keep only first candidate with same paths
  const uniqueCandidates: CandidateResult[] = [];
  const duplicateInfo: string[] = [];
  for (const candidate of allCandidates) {
    const duplicateOf = uniqueCandidates.find(existing =>
      arePathsEqual(existing.paths, candidate.paths)
    );
    if (!duplicateOf) {
      uniqueCandidates.push(candidate);
    } else {
      duplicateInfo.push(`${candidate.strategy} = duplicate of ${duplicateOf.strategy}`);
    }
  }

  // Debug logging
  console.log('=== Candidate Generation Debug ===');
  console.log('Total strategies:', allCandidates.length);
  console.log('Unique candidates:', uniqueCandidates.length);
  if (duplicateInfo.length > 0) {
    console.log('Duplicates removed:', duplicateInfo);
  }
  console.log('=================================');

  // Prioritize collision-free candidates, then by fewer crossings
  uniqueCandidates.sort((a, b) => {
    if (a.metrics.collisionCount !== b.metrics.collisionCount) {
      return a.metrics.collisionCount - b.metrics.collisionCount;
    }
    return a.metrics.crossingCount - b.metrics.crossingCount;
  });

  return uniqueCandidates;
}

/**
 * Summarize metrics (for Gemini)
 */
export function summarizeCandidatesForGemini(candidates: CandidateResult[]): object {
  return {
    candidates: candidates.map(c => ({
      id: c.id,
      strategy: c.strategy,
      metrics: {
        collisionCount: c.metrics.collisionCount,
        symmetryScore: c.metrics.symmetryScore,
        pathSmoothness: c.metrics.pathSmoothness,
        crossingCount: c.metrics.crossingCount,
        maxDelay: Math.round(c.metrics.maxDelay * 10) / 10,
        simultaneousArrival: c.metrics.simultaneousArrival,
      },
    })),
  };
}

