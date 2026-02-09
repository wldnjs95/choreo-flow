/**
 * Boids Algorithm for Path Planning
 *
 * Strategy:
 * 1. Separation: Avoid crowding neighbors (short range repulsion)
 * 2. Alignment: Steer towards average heading of neighbors
 * 3. Cohesion: Steer towards average position of neighbors
 * 4. Goal seeking: Move towards target position
 *
 * Creates natural flocking/swarming behavior
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';

export interface BoidsConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  separationWeight: number;      // Weight for separation rule (default: 1.5)
  alignmentWeight: number;      // Weight for alignment rule (default: 1.0)
  cohesionWeight: number;        // Weight for cohesion rule (default: 1.0)
  goalWeight: number;            // Weight for goal seeking (default: 2.0)
  separationRadius: number;      // Radius for separation (default: 1.5 * collisionRadius)
  neighborRadius: number;        // Radius for alignment/cohesion (default: 3.0)
  maxSpeed: number;              // Maximum speed (default: 2.0)
  maxForce: number;              // Maximum steering force (default: 0.5)
  timeStep: number;              // Simulation time step (default: 0.2)
}

const DEFAULT_CONFIG: BoidsConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 20,
  separationWeight: 1.5,         // Separation weight (move away from nearby neighbors)
  alignmentWeight: 1.0,           // Alignment weight (align with average neighbor direction)
  cohesionWeight: 1.0,           // Cohesion weight (move toward neighbor center)
  goalWeight: 2.0,                // Goal weight (move toward target position)
  separationRadius: 0.75,         // Separation radius (1.5 * collisionRadius)
  neighborRadius: 3.0,            // Neighbor radius (distance for alignment/cohesion)
  maxSpeed: 2.0,                  // Maximum speed (meters/second)
  maxForce: 0.5,                  // Maximum steering force
  timeStep: 0.2,                  // Simulation time step (seconds)
};

/**
 * Boid agent state
 */
interface Boid {
  id: number;
  position: Position;
  velocity: { vx: number; vy: number };
  goal: Position;
  radius: number;
}

/**
 * Calculate distance between two points
 */
function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Limit vector magnitude
 */
function limit(vector: { vx: number; vy: number }, max: number): { vx: number; vy: number } {
  const mag = Math.sqrt(vector.vx * vector.vx + vector.vy * vector.vy);
  if (mag > max && mag > 0) {
    return {
      vx: (vector.vx / mag) * max,
      vy: (vector.vy / mag) * max,
    };
  }
  return vector;
}

/**
 * Normalize vector
 */
function normalize(vector: { vx: number; vy: number }): { vx: number; vy: number } {
  const mag = Math.sqrt(vector.vx * vector.vx + vector.vy * vector.vy);
  if (mag > 0.001) {
    return { vx: vector.vx / mag, vy: vector.vy / mag };
  }
  return { vx: 0, vy: 0 };
}

/**
 * Separation: Steer to avoid crowding neighbors
 */
function separation(
  boid: Boid,
  neighbors: Boid[],
  separationRadius: number
): { vx: number; vy: number } {
  let steer = { vx: 0, vy: 0 };
  let count = 0;

  for (const neighbor of neighbors) {
    const dist = distance(boid.position, neighbor.position);
    if (dist > 0 && dist < separationRadius) {
      // Calculate vector pointing away from neighbor
      const diff = {
        vx: boid.position.x - neighbor.position.x,
        vy: boid.position.y - neighbor.position.y,
      };
      // Weight by distance (closer = stronger)
      const weight = 1.0 / dist;
      steer.vx += diff.vx * weight;
      steer.vy += diff.vy * weight;
      count++;
    }
  }

  if (count > 0) {
    steer.vx /= count;
    steer.vy /= count;
    steer = normalize(steer);
  }

  return steer;
}

/**
 * Alignment: Steer towards average heading of neighbors
 */
function alignment(
  boid: Boid,
  neighbors: Boid[],
  neighborRadius: number
): { vx: number; vy: number } {
  let avgVelocity = { vx: 0, vy: 0 };
  let count = 0;

  for (const neighbor of neighbors) {
    const dist = distance(boid.position, neighbor.position);
    if (dist > 0 && dist < neighborRadius) {
      avgVelocity.vx += neighbor.velocity.vx;
      avgVelocity.vy += neighbor.velocity.vy;
      count++;
    }
  }

  if (count > 0) {
    avgVelocity.vx /= count;
    avgVelocity.vy /= count;
    return normalize(avgVelocity);
  }

  return { vx: 0, vy: 0 };
}

/**
 * Cohesion: Steer towards average position of neighbors
 */
function cohesion(
  boid: Boid,
  neighbors: Boid[],
  neighborRadius: number
): { vx: number; vy: number } {
  let center = { x: 0, y: 0 };
  let count = 0;

  for (const neighbor of neighbors) {
    const dist = distance(boid.position, neighbor.position);
    if (dist > 0 && dist < neighborRadius) {
      center.x += neighbor.position.x;
      center.y += neighbor.position.y;
      count++;
    }
  }

  if (count > 0) {
    center.x /= count;
    center.y /= count;
    // Steer towards center
    const desired = {
      vx: center.x - boid.position.x,
      vy: center.y - boid.position.y,
    };
    return normalize(desired);
  }

  return { vx: 0, vy: 0 };
}

/**
 * Goal seeking: Steer towards goal position
 */
function seekGoal(
  boid: Boid,
  goal: Position,
  maxSpeed: number
): { vx: number; vy: number } {
  const desired = {
    vx: goal.x - boid.position.x,
    vy: goal.y - boid.position.y,
  };
  const dist = Math.sqrt(desired.vx * desired.vx + desired.vy * desired.vy);
  
  if (dist < 0.1) {
    return { vx: 0, vy: 0 };
  }

  // Normalize and scale by max speed
  const normalized = normalize(desired);
  return {
    vx: normalized.vx * maxSpeed,
    vy: normalized.vy * maxSpeed,
  };
}

/**
 * Apply boids rules and update velocity
 */
function updateBoid(
  boid: Boid,
  neighbors: Boid[],
  config: BoidsConfig
): { vx: number; vy: number } {
  // Calculate forces from each rule
  const sep = separation(boid, neighbors, config.separationRadius);
  const align = alignment(boid, neighbors, config.neighborRadius);
  const coh = cohesion(boid, neighbors, config.neighborRadius);
  const goal = seekGoal(boid, boid.goal, config.maxSpeed);

  // Apply weights and combine
  let desiredVelocity = {
    vx: sep.vx * config.separationWeight +
        align.vx * config.alignmentWeight +
        coh.vx * config.cohesionWeight +
        goal.vx * config.goalWeight,
    vy: sep.vy * config.separationWeight +
        align.vy * config.alignmentWeight +
        coh.vy * config.cohesionWeight +
        goal.vy * config.goalWeight,
  };

  // Normalize and scale
  desiredVelocity = normalize(desiredVelocity);
  desiredVelocity.vx *= config.maxSpeed;
  desiredVelocity.vy *= config.maxSpeed;

  // Calculate steering force
  let steer = {
    vx: desiredVelocity.vx - boid.velocity.vx,
    vy: desiredVelocity.vy - boid.velocity.vy,
  };

  // Limit steering force
  steer = limit(steer, config.maxForce);

  // Update velocity
  let newVelocity = {
    vx: boid.velocity.vx + steer.vx,
    vy: boid.velocity.vy + steer.vy,
  };

  // Limit speed
  newVelocity = limit(newVelocity, config.maxSpeed);

  return newVelocity;
}

/**
 * Get neighbor boids at specific time from existing paths
 */
function getNeighborBoidsAtTime(
  otherBoids: { id: number; path: PathPoint[]; goal: Position }[],
  time: number,
  collisionRadius: number
): Boid[] {
  const neighbors: Boid[] = [];

  for (const boidData of otherBoids) {
    const path = boidData.path;
    if (!path || path.length === 0) continue;

    // Interpolate position and velocity
    let pos: Position = { x: 0, y: 0 };
    let vel = { vx: 0, vy: 0 };

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      if (time >= p1.t && time <= p2.t) {
        const localT = (time - p1.t) / (p2.t - p1.t);
        pos = {
          x: p1.x + (p2.x - p1.x) * localT,
          y: p1.y + (p2.y - p1.y) * localT,
        };
        // Estimate velocity from path
        const dt = p2.t - p1.t;
        if (dt > 0.001) {
          vel = {
            vx: (p2.x - p1.x) / dt,
            vy: (p2.y - p1.y) / dt,
          };
        }
        break;
      }
    }

    neighbors.push({
      id: boidData.id,
      position: pos,
      velocity: vel,
      goal: boidData.goal,
      radius: collisionRadius,
    });
  }

  return neighbors;
}

/**
 * Generate path using boids algorithm
 */
function generatePathWithBoids(
  start: Position,
  goal: Position,
  startTime: number,
  endTime: number,
  otherBoids: { id: number; path: PathPoint[]; goal: Position }[],
  config: BoidsConfig
): PathPoint[] {
  const path: PathPoint[] = [];
  const duration = endTime - startTime;
  const numSteps = config.numPoints;
  const timeStep = duration / numSteps;

  let currentPos = { ...start };
  let currentTime = startTime;
  let velocity = { vx: 0, vy: 0 };

  // Add start point
  path.push({ x: currentPos.x, y: currentPos.y, t: currentTime });

  for (let step = 0; step < numSteps; step++) {
    currentTime = startTime + (step + 1) * timeStep;

    // Create boid for current dancer
    const boid: Boid = {
      id: -1, // Current boid
      position: currentPos,
      velocity: velocity,
      goal: goal,
      radius: config.collisionRadius,
    };

    // Get neighbor boids at current time
    const neighbors = getNeighborBoidsAtTime(otherBoids, currentTime, config.collisionRadius);

    // Update velocity using boids rules
    velocity = updateBoid(boid, neighbors, config);

    // Update position
    currentPos.x += velocity.vx * config.timeStep;
    currentPos.y += velocity.vy * config.timeStep;

    // Clamp to stage bounds
    currentPos.x = Math.max(0, Math.min(config.stageWidth, currentPos.x));
    currentPos.y = Math.max(0, Math.min(config.stageHeight, currentPos.y));

    // If close to goal, slow down
    const distToGoal = distance(currentPos, goal);
    if (distToGoal < 0.3) {
      velocity.vx *= 0.5;
      velocity.vy *= 0.5;
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
 * Compute paths for all dancers using boids algorithm
 */
export function computeAllPathsWithBoids(
  assignments: Assignment[],
  config: Partial<BoidsConfig> = {}
): DancerPath[] {
  const cfg: BoidsConfig = { ...DEFAULT_CONFIG, ...config };
  const results: DancerPath[] = [];
  const computedPaths: { id: number; path: PathPoint[]; goal: Position }[] = [];

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

    // Generate path using boids
    const path = generatePathWithBoids(
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

    computedPaths.push({ id: dancerId, path, goal: endPosition });
    results.push(dancerPath);
  }

  // Sort by dancerId
  return results.sort((a, b) => a.dancerId - b.dancerId);
}
