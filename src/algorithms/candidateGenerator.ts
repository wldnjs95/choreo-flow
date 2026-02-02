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
import { computeAllPathsSimple, validatePathsSimple } from './pathfinder';
import type { DancerPath, PathPoint, SortStrategy, TimingMode } from './pathfinder';
import { computeAllPathsWithPotentialField } from './potentialField';
import { computeAllPathsWithRVO } from './rvo';
import { computeAllPaths } from './astar';
import { computeAllPathsWithCBS } from './cbs';
import { computeAllPathsWithBoids } from './boids';
import { computeAllPathsWithJPS } from './jps';
import { computeAllPathsWithHybrid } from './choreographyHybrid';

/**
 * Candidate generation strategy
 */
export type CandidateStrategy =
  | 'distance_longest_first'   // Long distance first (default)
  | 'distance_shortest_first'  // Short distance first
  | 'synchronized_arrival'     // All dancers arrive at same time
  | 'staggered_wave'           // Sequential start with wave effect
  | 'center_priority'          // Center dancer first
  | 'curved_smooth'            // Force curved paths for aesthetic
  | 'quick_burst'              // Fast movement, all start together
  | 'slow_dramatic'            // Slow dramatic entrance with delays
  | 'potential_field'         // Potential field algorithm
  | 'rvo'                      // RVO (Reciprocal Velocity Obstacles) algorithm
  | 'astar'                    // A* pathfinding algorithm
  | 'cbs'                      // CBS (Conflict-Based Search) algorithm
  | 'boids'                    // Boids (flocking/swarming) algorithm
  | 'jps'                      // JPS (Jump Point Search) algorithm
  | 'hybrid';                  // Hybrid algorithm (Cubic Bezier + heuristic timing)

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
  'hybrid',
  'potential_field',
  'rvo',
  'astar',
  'cbs',
  'boids',
  'jps',
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
 * Sort assignments by strategy (center_priority only)
 * Other strategies are handled by pathfinder's sortStrategy
 */
function sortAssignmentsForCenterPriority(
  assignments: Assignment[],
  stageWidth: number,
  stageHeight: number
): Assignment[] {
  const sorted = [...assignments];
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;

  // Prioritize dancers closer to center
  sorted.sort((a, b) => {
    const distA = distance(a.startPosition, { x: centerX, y: centerY });
    const distB = distance(b.startPosition, { x: centerX, y: centerY });
    return distA - distB;
  });

  return sorted;
}

/**
 * Pathfinder config by strategy
 */
function getPathfinderConfig(strategy: CandidateStrategy, totalCounts: number) {
  const baseConfig = {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
    maxCurveOffset: 3.0,  // Allow larger curves for extreme collision scenarios
  };

  switch (strategy) {
    case 'distance_longest_first':
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'proportional' as TimingMode,
      };

    case 'distance_shortest_first':
      return {
        ...baseConfig,
        sortStrategy: 'distance_shortest_first' as SortStrategy,
        timingMode: 'proportional' as TimingMode,
      };

    case 'center_priority':
      // center_priority sorts assignments directly, so use 'none'
      return {
        ...baseConfig,
        sortStrategy: 'none' as SortStrategy,
        timingMode: 'proportional' as TimingMode,
      };

    case 'synchronized_arrival':
      // All dancers arrive at the same time
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'synchronized' as TimingMode,
      };

    case 'staggered_wave':
      // Sequential start times with wave effect
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'staggered' as TimingMode,
        staggerDelay: 0.5,
      };

    case 'curved_smooth':
      // Force curved paths for smooth aesthetic
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'proportional' as TimingMode,
        maxCurveOffset: 2.0,  // Force curves
        forceCurve: true,
      };

    case 'quick_burst':
      // Fast movement, everyone arrives quickly
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'synchronized' as TimingMode,
        speedMultiplier: 1.5,  // Faster
      };

    case 'slow_dramatic':
      // Slow dramatic entrance with staggered delays
      return {
        ...baseConfig,
        sortStrategy: 'distance_longest_first' as SortStrategy,
        timingMode: 'staggered' as TimingMode,
        staggerDelay: 1.0,  // Longer delay between dancers
        speedMultiplier: 0.7,  // Slower
      };

    case 'potential_field':
      // Potential field algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'rvo':
      // RVO algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'astar':
      // A* algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'cbs':
      // CBS algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'boids':
      // Boids algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'jps':
      // JPS algorithm (handled separately in generateCandidate)
      return baseConfig;

    case 'hybrid':
      // Hybrid algorithm (handled separately in generateCandidate)
      return baseConfig;

    default:
      return baseConfig;
  }
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

  // 2. Sort assignment only for center_priority strategy, others handled by pathfinder
  const processedAssignments = strategy === 'center_priority'
    ? sortAssignmentsForCenterPriority(assignments, config.stageWidth, config.stageHeight)
    : assignments;

  // 3. Generate paths (with strategy-specific algorithm)
  let paths: DancerPath[];
  if (strategy === 'potential_field') {
    // Use potential field algorithm
    paths = computeAllPathsWithPotentialField(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 20,
      attractiveGain: 1.0,
      repulsiveGain: 2.0,
      repulsiveRange: config.collisionRadius * 2.0,
      stepSize: 0.1,
      maxIterations: 100,
    });
  } else if (strategy === 'rvo') {
    // Use RVO algorithm with enhanced head-on collision avoidance
    paths = computeAllPathsWithRVO(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 20,
      timeHorizon: 3.0,  // Increased for early head-on collision detection
      neighborDist: 8.0,  // Increased to detect head-on collisions earlier
      maxSpeed: 2.0,
      timeStep: 0.1,
    });
  } else if (strategy === 'astar') {
    // Use A* algorithm
    const astarAssignments = processedAssignments.map(a => ({
      dancerId: a.dancerId,
      startPosition: a.startPosition,
      endPosition: a.endPosition,
    }));
    
    const astarResults = computeAllPaths(astarAssignments, {
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      totalCounts: config.totalCounts,
      gridResolution: 0.5,
      timeResolution: 0.5,
      collisionRadius: config.collisionRadius,
      diagonalCost: 1.414,
    });

    // Convert PathResult[] to DancerPath[]
    paths = astarResults.map(result => {
      // Calculate startTime and speed from path
      const startTime = result.path.length > 0 ? result.path[0].t : 0;
      const endTime = result.path.length > 0 ? result.path[result.path.length - 1].t : config.totalCounts;
      const duration = endTime - startTime;
      const speed = duration > 0 ? result.totalDistance / duration : 1.0;

      return {
        dancerId: result.dancerId,
        path: result.path,
        startTime,
        speed: Math.max(0.3, Math.min(2.0, speed)),
        totalDistance: result.totalDistance,
      };
    });
  } else if (strategy === 'cbs') {
    // Use CBS (Conflict-Based Search) algorithm
    // CBS is more efficient than A* for multi-agent scenarios with conflicts
    paths = computeAllPathsWithCBS(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      gridResolution: 0.5,
      timeResolution: 0.5,
      maxIterations: 100,
    });
  } else if (strategy === 'boids') {
    // Use Boids (flocking/swarming) algorithm
    paths = computeAllPathsWithBoids(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 20,
      separationWeight: 1.5,
      alignmentWeight: 1.0,
      cohesionWeight: 1.0,
      goalWeight: 2.0,
      separationRadius: config.collisionRadius * 1.5,
      neighborRadius: 3.0,
      maxSpeed: 2.0,
      maxForce: 0.5,
      timeStep: 0.2,
    });
  } else if (strategy === 'jps') {
    // Use JPS (Jump Point Search) algorithm
    paths = computeAllPathsWithJPS(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      gridResolution: 0.5,
      timeResolution: 0.5,
      maxIterations: 10000,
    });
  } else if (strategy === 'hybrid') {
    // Use Hybrid algorithm (Cubic Bezier + heuristic timing)
    // Best for: natural curved paths, human speed limits, back stage positioning
    paths = computeAllPathsWithHybrid(processedAssignments, {
      totalCounts: config.totalCounts,
      collisionRadius: config.collisionRadius,
      stageWidth: config.stageWidth,
      stageHeight: config.stageHeight,
      numPoints: 30,
      maxHumanSpeed: 1.5,  // meters per count
      preferSimultaneousArrival: true,
    });
  } else {
    // Use standard pathfinder
    const pathfinderConfig = getPathfinderConfig(strategy, config.totalCounts);
    paths = computeAllPathsSimple(processedAssignments, pathfinderConfig);
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

// ============================================
// Gemini Pre-Constraint based candidate generation
// ============================================

import type { GeminiPreConstraint } from '../gemini/preConstraint';

/**
 * Map constraint to strategy
 */
function constraintToStrategy(constraint: GeminiPreConstraint): CandidateStrategy {
  switch (constraint.movementOrder) {
    case 'longest_first':
      return 'distance_longest_first';
    case 'shortest_first':
      return 'distance_shortest_first';
    case 'center_first':
      return 'center_priority';
    case 'wave_outward':
    case 'outer_first':
      return 'distance_longest_first';  // Outer first = similar to longest first
    case 'wave_inward':
      return 'center_priority';
    default:
      return 'distance_longest_first';
  }
}

/**
 * Sort assignments by constraint
 */
function sortAssignmentsByConstraint(
  assignments: Assignment[],
  constraint: GeminiPreConstraint
): Assignment[] {
  const sorted = [...assignments];

  // Sort by priority in dancerHints
  sorted.sort((a, b) => {
    const hintA = constraint.dancerHints.find(h => h.dancerId === a.dancerId + 1);
    const hintB = constraint.dancerHints.find(h => h.dancerId === b.dancerId + 1);

    const priorityA = hintA?.priority ?? 999;
    const priorityB = hintB?.priority ?? 999;

    return priorityA - priorityB;
  });

  return sorted;
}

/**
 * Pathfinder config from constraint
 */
function getPathfinderConfigFromConstraint(constraint: GeminiPreConstraint, totalCounts: number) {
  return {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
    sortStrategy: 'none' as SortStrategy,  // Already sorted
    maxCurveOffset: constraint.suggestedCurveAmount,
    preferTiming: constraint.preferSmoothPaths,
  };
}

/**
 * Generate single candidate based on constraint
 */
export function generateCandidateWithConstraint(
  constraint: GeminiPreConstraint,
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
  // 1. Assignment (fixed by default)
  const assignmentMode = config.assignmentMode || 'fixed';
  const assignments = computeAssignment(startPositions, endPositions, assignmentMode, config.lockedDancers);

  // 2. Sort assignments by constraint
  const sortedAssignments = sortAssignmentsByConstraint(assignments, constraint);

  // 3. Apply delay (reflect delayRatio from dancerHints)
  const adjustedAssignments = sortedAssignments.map(a => {
    const hint = constraint.dancerHints.find(h => h.dancerId === a.dancerId + 1);
    const delayRatio = hint?.delayRatio ?? 0;

    return {
      ...a,
      delayStart: delayRatio * config.totalCounts * 0.3,  // Max 30% delay
    };
  });

  // 4. Generate paths
  const pathfinderConfig = getPathfinderConfigFromConstraint(constraint, config.totalCounts);
  const paths = computeAllPathsSimple(adjustedAssignments, pathfinderConfig);

  // 5. Calculate metrics
  const metrics = calculateMetrics(
    paths,
    config.totalCounts,
    config.collisionRadius,
    config.stageWidth
  );

  const strategy = constraintToStrategy(constraint);

  return {
    id: `candidate_constrained_${constraint.movementOrder}`,
    strategy,
    paths,
    metrics,
    assignments: adjustedAssignments,
  };
}

/**
 * Generate multiple candidates with constraint + variations
 */
export function generateCandidatesWithConstraint(
  constraint: GeminiPreConstraint,
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
    assignmentMode: config.assignmentMode || 'fixed',
    lockedDancers: config.lockedDancers,
  };

  const candidates: CandidateResult[] = [];

  // 1. Main candidate based on constraint
  const mainCandidate = generateCandidateWithConstraint(
    constraint,
    startPositions,
    endPositions,
    {
      totalCounts: fullConfig.totalCounts,
      collisionRadius: fullConfig.collisionRadius,
      stageWidth: fullConfig.stageWidth,
      stageHeight: fullConfig.stageHeight,
      assignmentMode: fullConfig.assignmentMode,
      lockedDancers: fullConfig.lockedDancers,
    }
  );
  mainCandidate.id = 'candidate_gemini_constrained';
  candidates.push(mainCandidate);

  // 2. Constraint variations (curve amount adjustment)
  const curveVariants = [0.2, 0.5, 0.8];
  for (const curveAmount of curveVariants) {
    if (Math.abs(curveAmount - constraint.suggestedCurveAmount) < 0.1) continue;

    const variantConstraint = {
      ...constraint,
      suggestedCurveAmount: curveAmount,
    };

    const variant = generateCandidateWithConstraint(
      variantConstraint,
      startPositions,
      endPositions,
      {
        totalCounts: fullConfig.totalCounts,
        collisionRadius: fullConfig.collisionRadius,
        stageWidth: fullConfig.stageWidth,
        stageHeight: fullConfig.stageHeight,
        assignmentMode: fullConfig.assignmentMode,
        lockedDancers: fullConfig.lockedDancers,
      }
    );
    variant.id = `candidate_constrained_curve_${curveAmount}`;
    candidates.push(variant);
  }

  // 3. Add some existing strategies (for comparison)
  const additionalStrategies: CandidateStrategy[] = ['distance_longest_first', 'synchronized_arrival'];
  for (const strategy of additionalStrategies) {
    const candidate = generateCandidate(strategy, startPositions, endPositions, {
      totalCounts: fullConfig.totalCounts,
      collisionRadius: fullConfig.collisionRadius,
      stageWidth: fullConfig.stageWidth,
      stageHeight: fullConfig.stageHeight,
      assignmentMode: fullConfig.assignmentMode,
      lockedDancers: fullConfig.lockedDancers,
    });
    candidate.id = `candidate_baseline_${strategy}`;
    candidates.push(candidate);
  }

  // Remove duplicates
  const uniqueCandidates: CandidateResult[] = [];
  for (const candidate of candidates) {
    const isDuplicate = uniqueCandidates.some(existing =>
      arePathsEqual(existing.paths, candidate.paths)
    );
    if (!isDuplicate) {
      uniqueCandidates.push(candidate);
    }
  }

  // Sort
  uniqueCandidates.sort((a, b) => {
    if (a.metrics.collisionCount !== b.metrics.collisionCount) {
      return a.metrics.collisionCount - b.metrics.collisionCount;
    }
    return a.metrics.crossingCount - b.metrics.crossingCount;
  });

  return uniqueCandidates;
}
