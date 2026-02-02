/**
 * RVO (Reciprocal Velocity Obstacles) Algorithm for Path Planning
 *
 * Strategy:
 * 1. Each agent considers other agents' positions and velocities
 * 2. Calculate velocity obstacles to avoid collisions
 * 3. Select optimal velocity that avoids all obstacles
 * 4. Update position based on selected velocity
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';

export interface RVOConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  numPoints: number;
  timeHorizon: number;        // Time horizon for collision prediction (default: 2.0)
  neighborDist: number;        // Maximum distance to consider neighbors (default: 5.0)
  maxSpeed: number;            // Maximum speed (default: 2.0)
  timeStep: number;            // Simulation time step (default: 0.1)
}

const DEFAULT_CONFIG: RVOConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  numPoints: 20,
  timeHorizon: 3.0,            // 충돌 예측 시간 범위 (초) - 증가하여 정면 충돌 미리 감지
  neighborDist: 8.0,           // 이웃으로 고려할 최대 거리 (미터) - 증가하여 정면 충돌 감지
  maxSpeed: 2.0,               // 최대 속도 (미터/초)
  timeStep: 0.1,               // 시뮬레이션 시간 간격 (초)
};

/**
 * Agent state for RVO
 */
interface Agent {
  id: number;
  position: Position;
  velocity: { vx: number; vy: number };
  goal: Position;
  radius: number;
  path?: PathPoint[];  // Path for interpolation
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
 * Calculate preferred velocity (toward goal)
 */
function calculatePreferredVelocity(
  current: Position,
  goal: Position,
  maxSpeed: number
): { vx: number; vy: number } {
  const dx = goal.x - current.x;
  const dy = goal.y - current.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.01) {
    return { vx: 0, vy: 0 };
  }

  // Normalize and scale by max speed
  const vx = (dx / dist) * maxSpeed;
  const vy = (dy / dist) * maxSpeed;

  return { vx, vy };
}

/**
 * Calculate velocity obstacle
 * Returns the set of velocities that would cause collision
 */
function calculateVelocityObstacle(
  agent: Agent,
  neighbor: Agent,
  timeHorizon: number
): { centerX: number; centerY: number; radius: number; isHeadOn: boolean } {
  // Relative position
  const dx = neighbor.position.x - agent.position.x;
  const dy = neighbor.position.y - agent.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Combined radius with safety margin for head-on collisions
  const combinedRadius = agent.radius + neighbor.radius;
  const safetyMargin = 0.3; // 추가 안전 마진

  if (dist < 0.01) {
    // Too close, return large obstacle
    return { centerX: 0, centerY: 0, radius: 1000, isHeadOn: true };
  }

  // Relative velocity
  const dvx = neighbor.velocity.vx - agent.velocity.vx;
  const dvy = neighbor.velocity.vy - agent.velocity.vy;

  // Check if this is a head-on collision (moving toward each other)
  const relativeVelMag = Math.sqrt(dvx * dvx + dvy * dvy);
  const toNeighborX = dx / dist;
  const toNeighborY = dy / dist;
  const relativeVelDirX = relativeVelMag > 0.01 ? dvx / relativeVelMag : 0;
  const relativeVelDirY = relativeVelMag > 0.01 ? dvy / relativeVelMag : 0;
  
  // Head-on collision: moving toward each other (dot product < 0)
  const isHeadOn = (toNeighborX * relativeVelDirX + toNeighborY * relativeVelDirY) < -0.3;

  // Velocity obstacle center (in velocity space)
  // Simplified: center at relative position divided by time horizon
  const centerX = dx / timeHorizon;
  const centerY = dy / timeHorizon;

  // Velocity obstacle radius with safety margin (larger for head-on collisions)
  const baseRadius = (combinedRadius + safetyMargin) / timeHorizon;
  const radius = isHeadOn ? baseRadius * 1.5 : baseRadius; // 정면 충돌 시 더 큰 장애물

  return { centerX, centerY, radius, isHeadOn };
}

/**
 * Check if velocity is in velocity obstacle
 */
function isVelocityInObstacle(
  vx: number,
  vy: number,
  obstacle: { centerX: number; centerY: number; radius: number; isHeadOn?: boolean }
): boolean {
  if (obstacle.radius === 0) return false;

  const dx = vx - obstacle.centerX;
  const dy = vy - obstacle.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Add extra safety margin for head-on collisions
  const safetyMargin = obstacle.isHeadOn ? 0.2 : 0;
  return dist < (obstacle.radius + safetyMargin);
}

/**
 * Find optimal velocity that avoids all obstacles
 */
function findOptimalVelocity(
  agent: Agent,
  neighbors: Agent[],
  preferredVel: { vx: number; vy: number },
  config: RVOConfig
): { vx: number; vy: number } {
  const { maxSpeed, timeHorizon, neighborDist } = config;

  // Calculate velocity obstacles from all neighbors
  const obstacles: { centerX: number; centerY: number; radius: number; isHeadOn: boolean }[] = [];
  let hasHeadOnCollision = false;

  for (const neighbor of neighbors) {
    const dist = distance(agent.position, neighbor.position);
    if (dist < neighborDist && dist > 0.01) {
      const vo = calculateVelocityObstacle(agent, neighbor, timeHorizon);
      if (vo.radius > 0) {
        obstacles.push(vo);
        if (vo.isHeadOn) {
          hasHeadOnCollision = true;
        }
      }
    }
  }

  // If no obstacles, use preferred velocity
  if (obstacles.length === 0) {
    return preferredVel;
  }

  // For head-on collisions, reduce preferred speed to allow more time for avoidance
  let adjustedPreferredVel = { ...preferredVel };
  if (hasHeadOnCollision) {
    // Reduce speed by 30% for head-on collisions to allow more time for avoidance
    adjustedPreferredVel.vx *= 0.7;
    adjustedPreferredVel.vy *= 0.7;
  }

  // Try adjusted preferred velocity first
  if (!obstacles.some(obs => isVelocityInObstacle(adjustedPreferredVel.vx, adjustedPreferredVel.vy, obs))) {
    return adjustedPreferredVel;
  }

  // Find closest safe velocity to preferred velocity
  let bestVel = { vx: 0, vy: 0 };
  let minDist = Infinity;

  // Sample velocities in a circle around preferred velocity
  // For head-on collisions, sample more directions and lower speeds
  const numSamples = hasHeadOnCollision ? 72 : 36; // 더 많은 샘플링
  const speedMultiplier = hasHeadOnCollision ? 0.6 : 1.0; // 정면 충돌 시 더 낮은 속도 시도

  for (let i = 0; i < numSamples; i++) {
    const angle = (i / numSamples) * 2 * Math.PI;
    const speed = maxSpeed * speedMultiplier * (0.3 + (i % 4) * 0.2); // 더 다양한 속도 시도

    const vx = adjustedPreferredVel.vx + Math.cos(angle) * speed * 0.6;
    const vy = adjustedPreferredVel.vy + Math.sin(angle) * speed * 0.6;

    // Clamp to max speed
    const velMag = Math.sqrt(vx * vx + vy * vy);
    if (velMag > maxSpeed) {
      const scale = maxSpeed / velMag;
      const clampedVx = vx * scale;
      const clampedVy = vy * scale;

      // Check if this velocity avoids all obstacles
      const isSafe = !obstacles.some(obs => isVelocityInObstacle(clampedVx, clampedVy, obs));

      if (isSafe) {
        const dist = Math.sqrt(
          (clampedVx - preferredVel.vx) ** 2 + (clampedVy - preferredVel.vy) ** 2
        );
        if (dist < minDist) {
          minDist = dist;
          bestVel = { vx: clampedVx, vy: clampedVy };
        }
      }
    } else {
      // Check if this velocity avoids all obstacles
      const isSafe = !obstacles.some(obs => isVelocityInObstacle(vx, vy, obs));

      if (isSafe) {
        const dist = Math.sqrt((vx - preferredVel.vx) ** 2 + (vy - preferredVel.vy) ** 2);
        if (dist < minDist) {
          minDist = dist;
          bestVel = { vx, vy };
        }
      }
    }
  }

  // If no safe velocity found, try zero velocity
  if (minDist === Infinity) {
    return { vx: 0, vy: 0 };
  }

  return bestVel;
}

/**
 * Generate path using RVO algorithm
 */
function generatePathWithRVO(
  start: Position,
  goal: Position,
  startTime: number,
  endTime: number,
  otherAgents: Agent[],
  config: RVOConfig
): PathPoint[] {
  const path: PathPoint[] = [];
  const duration = endTime - startTime;
  const numSteps = config.numPoints;
  const timeStep = duration / numSteps;

  let currentPos = { ...start };
  let currentTime = startTime;

  // Add start point
  path.push({ x: currentPos.x, y: currentPos.y, t: currentTime });

  // Initialize velocity
  let velocity = { vx: 0, vy: 0 };

  for (let step = 0; step < numSteps; step++) {
    currentTime = startTime + (step + 1) * timeStep;

    // Create agent for current dancer
    const agent: Agent = {
      id: -1, // Current agent
      position: currentPos,
      velocity: velocity,
      goal: goal,
      radius: config.collisionRadius,
    };

    // Get neighbor agents at current time
    const neighbors: Agent[] = otherAgents
      .filter(a => {
        // Interpolate neighbor position at current time
        const neighborPath = a.path;
        if (!neighborPath || neighborPath.length === 0) return false;

        // Find position at current time
        for (let i = 0; i < neighborPath.length - 1; i++) {
          const p1 = neighborPath[i];
          const p2 = neighborPath[i + 1];
          if (currentTime >= p1.t && currentTime <= p2.t) {
            return true;
          }
        }
        return false;
      })
      .map(a => {
        // Interpolate position and velocity
        const neighborPath = a.path;
        let pos: Position = { x: 0, y: 0 };
        let vel = { vx: 0, vy: 0 };

        if (neighborPath && neighborPath.length > 0) {
          for (let i = 0; i < neighborPath.length - 1; i++) {
            const p1 = neighborPath[i];
            const p2 = neighborPath[i + 1];
            if (currentTime >= p1.t && currentTime <= p2.t) {
              const localT = (currentTime - p1.t) / (p2.t - p1.t);
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
        }

        return {
          id: a.id,
          position: pos,
          velocity: vel,
          goal: a.goal,
          radius: config.collisionRadius,
        };
      });

    // Calculate preferred velocity
    const preferredVel = calculatePreferredVelocity(currentPos, goal, config.maxSpeed);

    // Find optimal velocity using RVO
    velocity = findOptimalVelocity(agent, neighbors, preferredVel, config);

    // Update position
    currentPos.x += velocity.vx * config.timeStep;
    currentPos.y += velocity.vy * config.timeStep;

    // Clamp to stage bounds
    currentPos.x = Math.max(0, Math.min(config.stageWidth, currentPos.x));
    currentPos.y = Math.max(0, Math.min(config.stageHeight, currentPos.y));

    // If close to goal, slow down
    const distToGoal = distance(currentPos, goal);
    if (distToGoal < 0.2) {
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
 * Compute paths for all dancers using RVO algorithm
 */
export function computeAllPathsWithRVO(
  assignments: Assignment[],
  config: Partial<RVOConfig> = {}
): DancerPath[] {
  const cfg: RVOConfig = { ...DEFAULT_CONFIG, ...config };
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

    // Create agents from already computed paths
    const otherAgents: Agent[] = computedPaths.map(cp => ({
      id: cp.id,
      position: cp.path[0] || { x: 0, y: 0 },
      velocity: { vx: 0, vy: 0 },
      goal: cp.goal,
      radius: cfg.collisionRadius,
      path: cp.path,
    }));

    // Generate path using RVO
    const path = generatePathWithRVO(
      startPosition,
      endPosition,
      startTime,
      endTime,
      otherAgents,
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
