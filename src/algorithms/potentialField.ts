/**
 * Potential Field Algorithm for Path Planning
 *
 * Strategy:
 * 1. Attractive potential: Pulls dancer toward goal position
 * 2. Repulsive potential: Pushes dancer away from other dancers (obstacles)
 * 3. Gradient descent: Follow the negative gradient to find path
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';

export interface PotentialFieldConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  attractiveGain: number;      // Gain for attractive potential (default: 1.0)
  repulsiveGain: number;          // Gain for repulsive potential (default: 2.0)
  repulsiveRange: number;         // Range of repulsive force (default: 2.0 * collisionRadius)
  stepSize: number;               // Step size for gradient descent (default: 0.1)
  maxIterations: number;           // Max iterations per path point (default: 100)
}

const DEFAULT_CONFIG: PotentialFieldConfig = {
  totalCounts: 8,              // Total music beats (total movement time)
  collisionRadius: 0.5,         // Minimum distance between dancers (meters, collision if closer)
  stageWidth: 12,               // Stage width (meters)
  stageHeight: 10,              // Stage height (meters)
  numPoints: 30,                // Points per path (more points = smoother path)
  attractiveGain: 1.0,          // Attractive force strength (higher = faster toward goal)
  repulsiveGain: 2.0,           // Repulsive force strength (higher = stronger collision avoidance)
  repulsiveRange: 1.0,          // Maximum repulsive range (meters, only considers obstacles within this)
  stepSize: 0.1,                // Step size per iteration (meters, higher = faster but less accurate)
  maxIterations: 100,           // Maximum iterations for path generation (currently unused)
};

/**
 * Calculate attractive potential (pulls toward goal)
 */
function attractivePotential(
  current: Position,
  goal: Position,
  gain: number
): { fx: number; fy: number; potential: number } {
  const dx = goal.x - current.x;
  const dy = goal.y - current.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.01) {
    return { fx: 0, fy: 0, potential: 0 };
  }

  // Attractive force is proportional to distance (linear potential)
  const fx = gain * dx;
  const fy = gain * dy;
  const potential = 0.5 * gain * dist * dist;

  return { fx, fy, potential };
}

/**
 * Calculate repulsive potential from a single obstacle
 */
function repulsivePotentialFromObstacle(
  current: Position,
  obstacle: Position,
  gain: number,
  range: number
): { fx: number; fy: number; potential: number } {
  const dx = current.x - obstacle.x;
  const dy = current.y - obstacle.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > range || dist < 0.01) {
    return { fx: 0, fy: 0, potential: 0 };
  }

  // Repulsive force: stronger when closer
  // Potential: U_rep = 0.5 * gain * (1/dist - 1/range)^2
  const invDist = 1.0 / dist;
  const invRange = 1.0 / range;
  const diff = invDist - invRange;

  if (diff <= 0) {
    return { fx: 0, fy: 0, potential: 0 };
  }

  const potential = 0.5 * gain * diff * diff;
  
  // Force is negative gradient: F = -dU/dx
  const forceMagnitude = gain * diff * invDist * invDist;
  const fx = forceMagnitude * dx;
  const fy = forceMagnitude * dy;

  return { fx, fy, potential };
}

/**
 * Calculate total potential and force at a position
 */
function calculateTotalPotential(
  current: Position,
  goal: Position,
  obstacles: Position[],
  config: PotentialFieldConfig
): { fx: number; fy: number; potential: number } {
  // Attractive potential
  const attractive = attractivePotential(
    current,
    goal,
    config.attractiveGain
  );

  // Repulsive potential from all obstacles
  let repulsiveFx = 0;
  let repulsiveFy = 0;
  let repulsivePotential = 0;

  for (const obstacle of obstacles) {
    const repulsive = repulsivePotentialFromObstacle(
      current,
      obstacle,
      config.repulsiveGain,
      config.repulsiveRange
    );
    repulsiveFx += repulsive.fx;
    repulsiveFy += repulsive.fy;
    repulsivePotential += repulsive.potential;
  }

  const totalFx = attractive.fx + repulsiveFx;
  const totalFy = attractive.fy + repulsiveFy;
  const totalPotential = attractive.potential + repulsivePotential;

  return { fx: totalFx, fy: totalFy, potential: totalPotential };
}

/**
 * Get obstacle positions at a specific time from existing paths
 */
function getObstaclePositionsAtTime(
  otherPaths: DancerPath[],
  time: number
): Position[] {
  const obstacles: Position[] = [];

  for (const path of otherPaths) {
    if (time < path.startTime) {
      // Dancer hasn't started yet, use start position
      obstacles.push(path.path[0]);
    } else if (time >= path.path[path.path.length - 1].t) {
      // Dancer has finished, use end position
      obstacles.push(path.path[path.path.length - 1]);
    } else {
      // Interpolate position
      for (let i = 0; i < path.path.length - 1; i++) {
        const p1 = path.path[i];
        const p2 = path.path[i + 1];
        if (time >= p1.t && time <= p2.t) {
          const localT = (time - p1.t) / (p2.t - p1.t);
          obstacles.push({
            x: p1.x + (p2.x - p1.x) * localT,
            y: p1.y + (p2.y - p1.y) * localT,
          });
          break;
        }
      }
    }
  }

  return obstacles;
}

/**
 * Generate path using potential field algorithm
 */
function generatePathWithPotentialField(
  start: Position,
  goal: Position,
  startTime: number,
  endTime: number,
  otherPaths: DancerPath[],
  config: PotentialFieldConfig
): PathPoint[] {
  const path: PathPoint[] = [];
  const numSteps = config.numPoints;
  const timeStep = (endTime - startTime) / numSteps;

  let currentPos = { ...start };
  let currentTime = startTime;

  // Add start point
  path.push({ x: currentPos.x, y: currentPos.y, t: currentTime });

  for (let step = 0; step < numSteps; step++) {
    currentTime = startTime + (step + 1) * timeStep;

    // Get obstacle positions at current time
    const obstacles = getObstaclePositionsAtTime(otherPaths, currentTime);

    // Calculate total force
    const { fx, fy } = calculateTotalPotential(
      currentPos,
      goal,
      obstacles,
      config
    );

    // Normalize force and apply step
    const forceMagnitude = Math.sqrt(fx * fx + fy * fy);
    if (forceMagnitude > 0.01) {
      const normalizedFx = fx / forceMagnitude;
      const normalizedFy = fy / forceMagnitude;

      // Move in direction of force (gradient descent)
      const stepX = normalizedFx * config.stepSize;
      const stepY = normalizedFy * config.stepSize;

      currentPos.x += stepX;
      currentPos.y += stepY;

      // Clamp to stage bounds
      currentPos.x = Math.max(0, Math.min(config.stageWidth, currentPos.x));
      currentPos.y = Math.max(0, Math.min(config.stageHeight, currentPos.y));
    }

    // If close to goal, snap to goal
    const distToGoal = Math.sqrt(
      (goal.x - currentPos.x) ** 2 + (goal.y - currentPos.y) ** 2
    );
    if (distToGoal < 0.1 && step === numSteps - 1) {
      currentPos = { ...goal };
    }

    path.push({ x: currentPos.x, y: currentPos.y, t: currentTime });
  }

  // Ensure last point is exactly at goal
  if (path.length > 0) {
    path[path.length - 1] = { x: goal.x, y: goal.y, t: endTime };
  }

  return path;
}

/**
 * Calculate total distance of a path
 */
function calculatePathDistance(path: PathPoint[]): number {
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    dist += Math.sqrt(dx * dx + dy * dy);
  }
  return dist;
}

/**
 * Compute paths for all dancers using potential field algorithm
 */
export function computeAllPathsWithPotentialField(
  assignments: Assignment[],
  config: Partial<PotentialFieldConfig> = {}
): DancerPath[] {
  const cfg: PotentialFieldConfig = { ...DEFAULT_CONFIG, ...config };
  const results: DancerPath[] = [];
  const computedPaths: DancerPath[] = [];

  // Sort by distance (longest first) to give priority to longer paths
  const sorted = [...assignments].sort((a, b) => b.distance - a.distance);

  // Calculate max distance for timing
  const maxDist = Math.max(...assignments.map(a => a.distance));

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    // Calculate timing (proportional to distance)
    const startTime = 0;
    const baseSpeed = maxDist / cfg.totalCounts;
    let endTime = baseSpeed > 0 ? Math.max(2, dist / baseSpeed) : cfg.totalCounts;
    if (endTime > cfg.totalCounts) {
      endTime = cfg.totalCounts;
    }

    // Generate path using potential field
    const path = generatePathWithPotentialField(
      startPosition,
      endPosition,
      startTime,
      endTime,
      computedPaths,
      cfg
    );

    const totalDistance = calculatePathDistance(path);
    const speed = Math.max(0.3, Math.min(2.0, dist / (endTime - startTime) || 1.0));

    const dancerPath: DancerPath = {
      dancerId,
      path,
      startTime,
      speed,
      totalDistance,
    };

    computedPaths.push(dancerPath);
    results.push(dancerPath);
  }

  // Sort by dancerId
  return results.sort((a, b) => a.dancerId - b.dancerId);
}
