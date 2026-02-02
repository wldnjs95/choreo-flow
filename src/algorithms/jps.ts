/**
 * JPS (Jump Point Search) Algorithm for Path Planning
 *
 * Strategy:
 * 1. Optimized A* that prunes symmetric paths
 * 2. Jump points: Only expand nodes that are "forced" (have forced neighbors)
 * 3. More efficient than A* for grid-based pathfinding
 * 4. Reduces search space by skipping symmetric paths
 *
 * JPS is particularly effective when:
 * - Grid-based movement
 * - Many symmetric paths exist
 * - Optimal path is needed
 */

import type { Position, Assignment } from './hungarian';
import type { PathPoint, DancerPath } from './pathfinder';

export interface JPSConfig {
  totalCounts: number;
  collisionRadius: number;
  stageWidth: number;
  stageHeight: number;
  gridResolution: number;
  timeResolution: number;
  maxIterations: number;
}

const DEFAULT_CONFIG: JPSConfig = {
  totalCounts: 8,
  collisionRadius: 0.5,
  stageWidth: 12,
  stageHeight: 10,
  gridResolution: 0.5,
  timeResolution: 0.5,
  maxIterations: 10000,
};

/**
 * Node for JPS search
 */
interface JPSNode {
  x: number;
  y: number;
  t: number;
  g: number;  // Cost from start
  h: number;  // Heuristic to goal
  f: number;  // g + h
  parent: JPSNode | null;
  dx: number;  // Direction x (-1, 0, 1)
  dy: number;  // Direction y (-1, 0, 1)
}

/**
 * Priority Queue (Min Heap)
 */
class PriorityQueue<T> {
  private heap: T[] = [];
  private comparator: (a: T, b: T) => number;

  constructor(comparator: (a: T, b: T) => number) {
    this.comparator = comparator;
  }

  push(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.comparator(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild;
      }
      if (rightChild < length && this.comparator(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild;
      }
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

/**
 * Check if position is walkable (within bounds and not colliding)
 */
function isWalkable(
  x: number,
  y: number,
  t: number,
  otherPaths: PathPoint[][],
  config: JPSConfig
): boolean {
  // Check bounds
  if (x < 0 || x > config.stageWidth || y < 0 || y > config.stageHeight) {
    return false;
  }

  // Check time bounds
  if (t < 0 || t > config.totalCounts) {
    return false;
  }

  // Check collision with other paths
  for (const path of otherPaths) {
    const pos = interpolatePosition(path, t);
    if (pos) {
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < config.collisionRadius * 2) {
        return false;
      }
    }
  }

  return true;
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
 * Heuristic function (Euclidean distance)
 */
function heuristic(node: { x: number; y: number; t: number }, goal: Position): number {
  const dx = goal.x - node.x;
  const dy = goal.y - node.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if node has forced neighbors (JPS pruning rule)
 */
function hasForcedNeighbors(
  x: number,
  y: number,
  dx: number,
  dy: number,
  t: number,
  otherPaths: PathPoint[][],
  config: JPSConfig
): boolean {
  // For diagonal movement
  if (dx !== 0 && dy !== 0) {
    // Check if we can't move in one direction (forced neighbor)
    const canMoveX = isWalkable(x + dx, y, t, otherPaths, config);
    const canMoveY = isWalkable(x, y + dy, t, otherPaths, config);
    
    if (!canMoveX || !canMoveY) {
      return true; // Forced neighbor exists
    }
  } else {
    // For horizontal/vertical movement
    if (dx !== 0) {
      // Check perpendicular directions
      const canMoveUp = isWalkable(x, y - 1, t, otherPaths, config);
      const canMoveDown = isWalkable(x, y + 1, t, otherPaths, config);
      const blockedUp = !isWalkable(x, y - 1, t, otherPaths, config);
      const blockedDown = !isWalkable(x, y + 1, t, otherPaths, config);
      
      if ((blockedUp && canMoveDown) || (blockedDown && canMoveUp)) {
        return true;
      }
    } else if (dy !== 0) {
      const canMoveLeft = isWalkable(x - 1, y, t, otherPaths, config);
      const canMoveRight = isWalkable(x + 1, y, t, otherPaths, config);
      const blockedLeft = !isWalkable(x - 1, y, t, otherPaths, config);
      const blockedRight = !isWalkable(x + 1, y, t, otherPaths, config);
      
      if ((blockedLeft && canMoveRight) || (blockedRight && canMoveLeft)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Jump in a direction until we hit an obstacle or find a jump point
 */
function jump(
  x: number,
  y: number,
  t: number,
  dx: number,
  dy: number,
  goal: Position,
  otherPaths: PathPoint[][],
  config: JPSConfig
): { x: number; y: number; t: number } | null {
  const newX = x + dx * config.gridResolution;
  const newY = y + dy * config.gridResolution;
  const newT = t + config.timeResolution;

  // Check bounds
  if (!isWalkable(newX, newY, newT, otherPaths, config)) {
    return null;
  }

  // If we reached the goal
  const distToGoal = Math.sqrt((goal.x - newX) ** 2 + (goal.y - newY) ** 2);
  if (distToGoal < config.gridResolution) {
    return { x: newX, y: newY, t: newT };
  }

  // Check for forced neighbors (jump point)
  if (hasForcedNeighbors(newX, newY, dx, dy, newT, otherPaths, config)) {
    return { x: newX, y: newY, t: newT };
  }

  // Recursively jump
  if (dx !== 0 && dy !== 0) {
    // Diagonal: try horizontal and vertical jumps
    const horizontalJump = jump(newX, newY, newT, dx, 0, goal, otherPaths, config);
    if (horizontalJump) return horizontalJump;
    
    const verticalJump = jump(newX, newY, newT, 0, dy, goal, otherPaths, config);
    if (verticalJump) return verticalJump;
  }

  // Continue jumping in same direction
  return jump(newX, newY, newT, dx, dy, goal, otherPaths, config);
}

/**
 * Get jump point successors
 */
function getSuccessors(
  node: JPSNode,
  goal: Position,
  otherPaths: PathPoint[][],
  config: JPSConfig
): JPSNode[] {
  const successors: JPSNode[] = [];

  // If no parent, explore all 8 directions
  if (!node.parent) {
    const directions = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
    ];

    for (const dir of directions) {
      const jumpPoint = jump(node.x, node.y, node.t, dir.dx, dir.dy, goal, otherPaths, config);
      if (jumpPoint) {
        const g = node.g + Math.sqrt((jumpPoint.x - node.x) ** 2 + (jumpPoint.y - node.y) ** 2);
        const h = heuristic(jumpPoint, goal);
        successors.push({
          x: jumpPoint.x,
          y: jumpPoint.y,
          t: jumpPoint.t,
          g,
          h,
          f: g + h,
          parent: node,
          dx: dir.dx,
          dy: dir.dy,
        });
      }
    }
  } else {
    // Use parent direction to determine jump directions
    const dx = node.dx;
    const dy = node.dy;

    // Natural successors (continue in same direction)
    const naturalJump = jump(node.x, node.y, node.t, dx, dy, goal, otherPaths, config);
    if (naturalJump) {
      const g = node.g + Math.sqrt((naturalJump.x - node.x) ** 2 + (naturalJump.y - node.y) ** 2);
      const h = heuristic(naturalJump, goal);
      successors.push({
        x: naturalJump.x,
        y: naturalJump.y,
        t: naturalJump.t,
        g,
        h,
        f: g + h,
        parent: node,
        dx,
        dy,
      });
    }

    // Forced neighbors (perpendicular directions)
    if (dx !== 0 && dy !== 0) {
      // Diagonal: try horizontal and vertical
      const horizontalJump = jump(node.x, node.y, node.t, dx, 0, goal, otherPaths, config);
      if (horizontalJump) {
        const g = node.g + Math.sqrt((horizontalJump.x - node.x) ** 2 + (horizontalJump.y - node.y) ** 2);
        const h = heuristic(horizontalJump, goal);
        successors.push({
          x: horizontalJump.x,
          y: horizontalJump.y,
          t: horizontalJump.t,
          g,
          h,
          f: g + h,
          parent: node,
          dx: dx,
          dy: 0,
        });
      }

      const verticalJump = jump(node.x, node.y, node.t, 0, dy, goal, otherPaths, config);
      if (verticalJump) {
        const g = node.g + Math.sqrt((verticalJump.x - node.x) ** 2 + (verticalJump.y - node.y) ** 2);
        const h = heuristic(verticalJump, goal);
        successors.push({
          x: verticalJump.x,
          y: verticalJump.y,
          t: verticalJump.t,
          g,
          h,
          f: g + h,
          parent: node,
          dx: 0,
          dy: dy,
        });
      }
    }
  }

  return successors;
}

/**
 * Find path using JPS algorithm
 */
function findPathJPS(
  start: Position,
  goal: Position,
  startTime: number,
  otherPaths: PathPoint[][],
  config: JPSConfig
): PathPoint[] {
  const openSet = new PriorityQueue<JPSNode>((a, b) => a.f - b.f);
  const closedSet = new Set<string>();

  const startNode: JPSNode = {
    x: start.x,
    y: start.y,
    t: startTime,
    g: 0,
    h: heuristic({ x: start.x, y: start.y, t: startTime }, goal),
    f: 0,
    parent: null,
    dx: 0,
    dy: 0,
  };
  startNode.f = startNode.g + startNode.h;

  openSet.push(startNode);

  let iterations = 0;

  while (!openSet.isEmpty() && iterations < config.maxIterations) {
    iterations++;

    const current = openSet.pop()!;
    const currentKey = `${Math.round(current.x * 10)}_${Math.round(current.y * 10)}_${Math.round(current.t * 10)}`;

    // Goal check
    const distToGoal = Math.sqrt((current.x - goal.x) ** 2 + (current.y - goal.y) ** 2);
    if (distToGoal < config.gridResolution && current.t >= config.totalCounts - config.timeResolution) {
      // Reconstruct path
      const path: PathPoint[] = [];
      let node: JPSNode | null = current;

      while (node) {
        path.unshift({ x: node.x, y: node.y, t: node.t });
        node = node.parent;
      }

      // Adjust last point to exact end position
      if (path.length > 0) {
        path[path.length - 1] = { x: goal.x, y: goal.y, t: config.totalCounts };
      }

      return path;
    }

    if (closedSet.has(currentKey)) {
      continue;
    }
    closedSet.add(currentKey);

    const successors = getSuccessors(current, goal, otherPaths, config);

    for (const successor of successors) {
      const successorKey = `${Math.round(successor.x * 10)}_${Math.round(successor.y * 10)}_${Math.round(successor.t * 10)}`;
      if (closedSet.has(successorKey)) {
        continue;
      }

      openSet.push(successor);
    }
  }

  // If path not found: return direct path (fallback)
  console.warn('[JPS] Failed to find path, using direct path');
  return [
    { x: start.x, y: start.y, t: startTime },
    { x: goal.x, y: goal.y, t: config.totalCounts },
  ];
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
 * Compute paths for all dancers using JPS algorithm
 */
export function computeAllPathsWithJPS(
  assignments: Assignment[],
  config: Partial<JPSConfig> = {}
): DancerPath[] {
  const cfg: JPSConfig = { ...DEFAULT_CONFIG, ...config };
  const results: DancerPath[] = [];
  const computedPaths: PathPoint[][] = [];

  // Sort by distance (longest first) to give priority to longer paths
  const sorted = [...assignments].sort((a, b) => b.distance - a.distance);

  for (const assignment of sorted) {
    const { dancerId, startPosition, endPosition, distance: dist } = assignment;

    // Calculate timing (proportional to distance)
    const startTime = 0;
    const baseSpeed = Math.max(...sorted.map(a => a.distance)) / cfg.totalCounts;
    let endTime = baseSpeed > 0 ? Math.max(2, dist / baseSpeed) : cfg.totalCounts;
    if (endTime > cfg.totalCounts) {
      endTime = cfg.totalCounts;
    }

    // Generate path using JPS
    const path = findPathJPS(
      startPosition,
      endPosition,
      startTime,
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

    computedPaths.push(path);
    results.push(dancerPath);
  }

  // Sort by dancerId
  return results.sort((a, b) => a.dancerId - b.dancerId);
}
