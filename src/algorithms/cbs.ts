/**
 * CBS (Conflict-Based Search) Algorithm for Multi-Agent Path Planning
 *
 * Strategy:
 * 1. High-level: Find conflicts and resolve them by adding constraints
 * 2. Low-level: Use A* for each agent with constraints
 * 3. More efficient than individual A* for multiple agents
 *
 * CBS is particularly effective when:
 * - Multiple agents need to coordinate
 * - Conflicts are sparse (not too many simultaneous conflicts)
 * - Optimal or near-optimal solutions are needed
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';
import { findPath } from './astar';
import type { AStarConfig } from './astar';

export interface CBSConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  gridResolution: number;
  timeResolution: number;
  maxIterations: number;  // Maximum high-level iterations
}

const DEFAULT_CONFIG: CBSConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  gridResolution: 0.5,
  timeResolution: 0.5,
  maxIterations: 100,
};

/**
 * Constraint for a specific agent
 */
interface Constraint {
  agentId: number;
  x: number;
  y: number;
  t: number;  // Time when agent cannot be at (x, y)
}

/**
 * Conflict between two agents
 */
interface Conflict {
  agent1: number;
  agent2: number;
  x: number;
  y: number;
  t: number;
}

/**
 * Node in CBS search tree
 */
interface CBSNode {
  constraints: Constraint[];
  paths: Map<number, PathPoint[]>;  // agentId -> path
  cost: number;  // Sum of path costs
  conflicts: Conflict[];
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
 * Check if a position violates constraints
 * (Currently unused but exported for future constraint checking)
 */
export function violatesConstraint(
  x: number,
  y: number,
  t: number,
  agentId: number,
  constraints: Constraint[]
): boolean {
  for (const constraint of constraints) {
    if (constraint.agentId === agentId) {
      // Check if position matches constraint (with tolerance)
      const dx = Math.abs(x - constraint.x);
      const dy = Math.abs(y - constraint.y);
      const dt = Math.abs(t - constraint.t);
      
      if (dx < 0.3 && dy < 0.3 && dt < 0.3) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find conflicts between paths
 */
function findConflicts(
  paths: Map<number, PathPoint[]>,
  collisionRadius: number,
  totalCounts: number
): Conflict[] {
  const conflicts: Conflict[] = [];
  const agentIds = Array.from(paths.keys());

  for (let i = 0; i < agentIds.length; i++) {
    for (let j = i + 1; j < agentIds.length; j++) {
      const id1 = agentIds[i];
      const id2 = agentIds[j];
      const path1 = paths.get(id1)!;
      const path2 = paths.get(id2)!;

      // Check collisions at discrete time steps
      for (let t = 0; t <= totalCounts; t += 0.5) {
        const pos1 = interpolatePosition(path1, t);
        const pos2 = interpolatePosition(path2, t);

        if (pos1 && pos2) {
          const dist = distance(pos1, pos2);
          if (dist < collisionRadius * 2) {
            conflicts.push({
              agent1: id1,
              agent2: id2,
              x: (pos1.x + pos2.x) / 2,
              y: (pos1.y + pos2.y) / 2,
              t,
            });
            break; // One conflict per pair is enough
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Interpolate position at specific time
 */
function interpolatePosition(path: PathPoint[], time: number): Position | null {
  if (path.length === 0) return null;
  if (time < path[0].t) return { x: path[0].x, y: path[0].y };
  if (time > path[path.length - 1].t) {
    const last = path[path.length - 1];
    return { x: last.x, y: last.y };
  }

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    if (time >= p1.t && time <= p2.t) {
      const localT = (time - p1.t) / (p2.t - p1.t);
      return {
        x: p1.x + (p2.x - p1.x) * localT,
        y: p1.y + (p2.y - p1.y) * localT,
      };
    }
  }

  return null;
}

/**
 * Calculate path cost (total distance)
 */
function calculatePathCost(path: PathPoint[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    cost += Math.sqrt(dx * dx + dy * dy);
  }
  return cost;
}

/**
 * Find path for single agent with constraints using A*
 */
function findPathWithConstraints(
  agentId: number,
  start: Position,
  goal: Position,
  constraints: Constraint[],
  otherPaths: PathPoint[][],
  config: CBSConfig
): PathPoint[] {
  // Create A* config
  const astarConfig: Partial<AStarConfig> = {
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    totalCounts: config.totalCounts,
    gridResolution: config.gridResolution,
    timeResolution: config.timeResolution,
    collisionRadius: config.collisionRadius,
  };

  // Get other paths as obstacles
  const otherPathsForAStar = otherPaths.map(p => p);

  // Find constraints for this agent
  const agentConstraints = constraints.filter(c => c.agentId === agentId);
  
  if (agentConstraints.length === 0) {
    // No constraints, use normal A*
    return findPath(start, goal, 0, otherPathsForAStar, astarConfig);
  }

  // Find maximum constraint time
  const maxConstraintTime = Math.max(...agentConstraints.map(c => c.t));
  
  // Try starting after constraint time
  const startTime = maxConstraintTime + config.timeResolution;
  
  // Use A* with delayed start
  const path = findPath(start, goal, startTime, otherPathsForAStar, astarConfig);
  
  return path;
}

/**
 * Compute paths for all dancers using CBS algorithm
 */
export function computeAllPathsWithCBS(
  assignments: Assignment[],
  config: Partial<CBSConfig> = {}
): DancerPath[] {
  try {
    const cfg: CBSConfig = { ...DEFAULT_CONFIG, ...config };
    
    console.log('[CBS] Starting CBS algorithm with', assignments.length, 'agents');
    
    // Priority queue for CBS nodes (lowest cost first)
    const openSet: CBSNode[] = [];
    
    // Initial node: no constraints
    const initialNode: CBSNode = {
      constraints: [],
      paths: new Map(),
      cost: 0,
      conflicts: [],
    };

    // Find initial paths for all agents (without constraints)
    const otherPaths: PathPoint[][] = [];
    for (const assignment of assignments) {
      try {
        const astarConfig: Partial<AStarConfig> = {
          stageWidth: cfg.stageWidth,
          stageHeight: cfg.stageHeight,
          totalCounts: cfg.totalCounts,
          gridResolution: cfg.gridResolution,
          timeResolution: cfg.timeResolution,
          collisionRadius: cfg.collisionRadius,
        };

        const path = findPath(
          assignment.startPosition,
          assignment.endPosition,
          0,
          otherPaths,
          astarConfig
        );
        
        if (!path || path.length === 0) {
          console.warn(`[CBS] Failed to find initial path for agent ${assignment.dancerId}, using fallback`);
          // Create fallback path
          const fallbackPath: PathPoint[] = [
            { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
            { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
          ];
          initialNode.paths.set(assignment.dancerId, fallbackPath);
          initialNode.cost += assignment.distance;
          otherPaths.push(fallbackPath);
        } else {
          // Validate path
          if (path.length < 2) {
            console.warn(`[CBS] Invalid path length for agent ${assignment.dancerId}, using fallback`);
            const fallbackPath: PathPoint[] = [
              { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
              { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
            ];
            initialNode.paths.set(assignment.dancerId, fallbackPath);
            initialNode.cost += assignment.distance;
            otherPaths.push(fallbackPath);
          } else {
            initialNode.paths.set(assignment.dancerId, path);
            initialNode.cost += calculatePathCost(path);
            otherPaths.push(path);
          }
        }
      } catch (error) {
        console.error(`[CBS] Error finding path for agent ${assignment.dancerId}:`, error);
        // Always create fallback path
        const fallbackPath: PathPoint[] = [
          { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
          { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
        ];
        initialNode.paths.set(assignment.dancerId, fallbackPath);
        initialNode.cost += assignment.distance;
        otherPaths.push(fallbackPath);
      }
    }

    // Ensure all agents have paths
    if (initialNode.paths.size !== assignments.length) {
      console.warn(`[CBS] Missing paths for some agents. Expected ${assignments.length}, got ${initialNode.paths.size}`);
      for (const assignment of assignments) {
        if (!initialNode.paths.has(assignment.dancerId)) {
          const fallbackPath: PathPoint[] = [
            { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
            { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
          ];
          initialNode.paths.set(assignment.dancerId, fallbackPath);
          initialNode.cost += assignment.distance;
        }
      }
    }

    // Find conflicts in initial solution
    initialNode.conflicts = findConflicts(initialNode.paths, cfg.collisionRadius, cfg.totalCounts);
    console.log(`[CBS] Initial solution has ${initialNode.conflicts.length} conflicts`);

    // If no conflicts, return immediately
    if (initialNode.conflicts.length === 0) {
      console.log('[CBS] No conflicts found, returning initial solution');
      return convertToDancerPaths(initialNode.paths, assignments, cfg.totalCounts);
    }

    openSet.push(initialNode);

    let iterations = 0;
    while (openSet.length > 0 && iterations < cfg.maxIterations) {
      iterations++;

      // Get node with lowest cost
      openSet.sort((a, b) => a.cost - b.cost);
      const currentNode = openSet.shift()!;

      // If no conflicts, we found a solution
      if (currentNode.conflicts.length === 0) {
        console.log(`[CBS] Solution found after ${iterations} iterations`);
        return convertToDancerPaths(currentNode.paths, assignments, cfg.totalCounts);
      }

      // Pick first conflict to resolve
      const conflict = currentNode.conflicts[0];

      // Create two child nodes: one constraining agent1, one constraining agent2
      for (const agentId of [conflict.agent1, conflict.agent2]) {
        const newConstraints = [...currentNode.constraints, {
          agentId,
          x: conflict.x,
          y: conflict.y,
          t: conflict.t,
        }];

        // Recompute path for constrained agent
        const assignment = assignments.find(a => a.dancerId === agentId);
        if (!assignment) {
          console.warn(`[CBS] Assignment not found for agent ${agentId}`);
          continue;
        }

        const otherPathsForAgent: PathPoint[][] = [];
        
        for (const [id, path] of currentNode.paths.entries()) {
          if (id !== agentId) {
            otherPathsForAgent.push(path);
          }
        }

        let newPath: PathPoint[];
        try {
          newPath = findPathWithConstraints(
            agentId,
            assignment.startPosition,
            assignment.endPosition,
            newConstraints,
            otherPathsForAgent,
            cfg
          );

          if (!newPath || newPath.length === 0) {
            console.warn(`[CBS] Failed to find path for agent ${agentId} with constraints, using current path`);
            // Use current path instead of skipping
            newPath = currentNode.paths.get(agentId) || [
              { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
              { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
            ];
          }
        } catch (error) {
          console.error(`[CBS] Error finding constrained path for agent ${agentId}:`, error);
          // Use current path as fallback
          newPath = currentNode.paths.get(agentId) || [
            { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
            { x: assignment.endPosition.x, y: assignment.endPosition.y, t: cfg.totalCounts },
          ];
        }

        // Create new node
        const newPaths = new Map(currentNode.paths);
        newPaths.set(agentId, newPath);

        const newCost = Array.from(newPaths.values())
          .reduce((sum, path) => sum + calculatePathCost(path), 0);

        const newConflicts = findConflicts(newPaths, cfg.collisionRadius, cfg.totalCounts);

        const newNode: CBSNode = {
          constraints: newConstraints,
          paths: newPaths,
          cost: newCost,
          conflicts: newConflicts,
        };

        openSet.push(newNode);
      }
    }

    console.log(`[CBS] Reached max iterations (${iterations}), returning best solution`);

    // If no solution found, return best attempt
    if (openSet.length > 0) {
      openSet.sort((a, b) => a.cost - b.cost);
      return convertToDancerPaths(openSet[0].paths, assignments, cfg.totalCounts);
    }

    // Fallback: return initial solution
    console.log('[CBS] Returning initial solution as fallback');
    return convertToDancerPaths(initialNode.paths, assignments, cfg.totalCounts);
  } catch (error) {
    console.error('[CBS] Error in CBS algorithm:', error);
    // Fallback: return simple paths
    return assignments.map(assignment => ({
      dancerId: assignment.dancerId,
      path: [
        { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
        { x: assignment.endPosition.x, y: assignment.endPosition.y, t: config.totalCounts || 8 },
      ],
      startTime: 0,
      speed: 1.0,
      totalDistance: assignment.distance,
    }));
  }
}

/**
 * Convert paths map to DancerPath array
 * Always returns a valid path for each assignment
 */
function convertToDancerPaths(
  paths: Map<number, PathPoint[]>,
  assignments: Assignment[],
  totalCounts: number
): DancerPath[] {
  const result: DancerPath[] = [];

  for (const assignment of assignments) {
    let path = paths.get(assignment.dancerId);
    
    // Always ensure we have a valid path
    if (!path || path.length === 0) {
      console.warn(`[CBS] No path found for agent ${assignment.dancerId}, creating fallback`);
      // Fallback: create direct path
      path = [
        { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
        { x: assignment.endPosition.x, y: assignment.endPosition.y, t: totalCounts },
      ];
    }

    // Validate path has at least 2 points
    if (path.length < 2) {
      console.warn(`[CBS] Invalid path length for agent ${assignment.dancerId}, creating fallback`);
      path = [
        { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
        { x: assignment.endPosition.x, y: assignment.endPosition.y, t: totalCounts },
      ];
    }

    // Ensure first point is at start and last point is at end
    const firstPoint = path[0];
    const lastPoint = path[path.length - 1];
    
    if (distance(firstPoint, assignment.startPosition) > 0.5) {
      path[0] = { x: assignment.startPosition.x, y: assignment.startPosition.y, t: firstPoint.t };
    }
    if (distance(lastPoint, assignment.endPosition) > 0.5) {
      path[path.length - 1] = { x: assignment.endPosition.x, y: assignment.endPosition.y, t: lastPoint.t };
    }

    const startTime = path[0].t;
    const endTime = path[path.length - 1].t;
    const duration = Math.max(0.1, endTime - startTime);
    
    let totalDistance = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    // If totalDistance is 0, use assignment distance
    if (totalDistance < 0.01) {
      totalDistance = assignment.distance;
    }

    const speed = duration > 0 ? totalDistance / duration : 1.0;

    result.push({
      dancerId: assignment.dancerId,
      path,
      startTime,
      speed: Math.max(0.3, Math.min(2.0, speed)),
      totalDistance,
    });
  }

  // Ensure we have paths for all assignments
  if (result.length !== assignments.length) {
    console.error(`[CBS] Path count mismatch: expected ${assignments.length}, got ${result.length}`);
    // Add missing paths
    for (const assignment of assignments) {
      if (!result.find(r => r.dancerId === assignment.dancerId)) {
        result.push({
          dancerId: assignment.dancerId,
          path: [
            { x: assignment.startPosition.x, y: assignment.startPosition.y, t: 0 },
            { x: assignment.endPosition.x, y: assignment.endPosition.y, t: totalCounts },
          ],
          startTime: 0,
          speed: 1.0,
          totalDistance: assignment.distance,
        });
      }
    }
  }

  return result.sort((a, b) => a.dancerId - b.dancerId);
}
