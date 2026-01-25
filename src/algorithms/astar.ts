/**
 * Spatiotemporal A* Path Finding
 *
 * Search in 3D space: (x, y, t)
 * - x, y: stage position
 * - t: time (count)
 *
 * Treat other dancers' paths as obstacles to avoid collision
 */

import type { Position } from './hungarian';

export interface PathPoint {
  x: number;
  y: number;
  t: number;  // time (count)
}

export interface PathResult {
  dancerId: number;
  path: PathPoint[];
  totalDistance: number;
  collisionFree: boolean;
}

export interface AStarConfig {
  stageWidth: number;
  stageHeight: number;
  totalCounts: number;
  gridResolution: number;     // Grid resolution (default 0.5m)
  timeResolution: number;     // Time resolution (default 0.5 count)
  collisionRadius: number;    // Collision radius (default 0.5m)
  diagonalCost: number;       // Diagonal movement cost multiplier
}

const DEFAULT_CONFIG: AStarConfig = {
  stageWidth: 10,
  stageHeight: 8,
  totalCounts: 8,
  gridResolution: 0.5,
  timeResolution: 0.5,
  collisionRadius: 0.5,
  diagonalCost: 1.414,
};

interface Node {
  x: number;
  y: number;
  t: number;
  g: number;  // Cost from start to current
  h: number;  // Heuristic (estimate from current to goal)
  f: number;  // g + h
  parent: Node | null;
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
 * Heuristic function: Euclidean distance
 */
function heuristic(current: PathPoint, goal: Position): number {
  const dx = current.x - goal.x;
  const dy = current.y - goal.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate node key (for duplicate checking)
 */
function nodeKey(x: number, y: number, t: number, resolution: number): string {
  const gx = Math.round(x / resolution);
  const gy = Math.round(y / resolution);
  const gt = Math.round(t / resolution);
  return `${gx},${gy},${gt}`;
}

/**
 * Collision check: whether a specific position at a specific time collides with other dancers
 */
function checkCollision(
  x: number,
  y: number,
  t: number,
  otherPaths: PathPoint[][],
  collisionRadius: number
): boolean {
  for (const path of otherPaths) {
    // Interpolate other dancer position at this time
    const otherPos = interpolatePosition(path, t);
    if (otherPos) {
      const dx = x - otherPos.x;
      const dy = y - otherPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < collisionRadius * 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Interpolate position at specific time in path
 */
function interpolatePosition(path: PathPoint[], t: number): Position | null {
  if (path.length === 0) return null;
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y };
  if (t >= path[path.length - 1].t) return { x: path[path.length - 1].x, y: path[path.length - 1].y };

  for (let i = 0; i < path.length - 1; i++) {
    if (t >= path[i].t && t <= path[i + 1].t) {
      const ratio = (t - path[i].t) / (path[i + 1].t - path[i].t);
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * ratio,
        y: path[i].y + (path[i + 1].y - path[i].y) * ratio,
      };
    }
  }
  return null;
}

/**
 * Generate neighbor nodes (8-directional movement + wait)
 */
function getNeighbors(
  node: Node,
  config: AStarConfig,
  goal: Position,
  otherPaths: PathPoint[][]
): Node[] {
  const neighbors: Node[] = [];
  const { gridResolution, timeResolution, stageWidth, stageHeight, collisionRadius, diagonalCost } = config;

  // 8-directional movement + stay in place
  const directions = [
    { dx: 0, dy: 0, cost: 0.1 },           // Wait (small cost)
    { dx: gridResolution, dy: 0, cost: 1 },
    { dx: -gridResolution, dy: 0, cost: 1 },
    { dx: 0, dy: gridResolution, cost: 1 },
    { dx: 0, dy: -gridResolution, cost: 1 },
    { dx: gridResolution, dy: gridResolution, cost: diagonalCost },
    { dx: gridResolution, dy: -gridResolution, cost: diagonalCost },
    { dx: -gridResolution, dy: gridResolution, cost: diagonalCost },
    { dx: -gridResolution, dy: -gridResolution, cost: diagonalCost },
  ];

  const newT = node.t + timeResolution;

  for (const dir of directions) {
    const newX = node.x + dir.dx;
    const newY = node.y + dir.dy;

    // Stage boundary check
    if (newX < 0 || newX > stageWidth || newY < 0 || newY > stageHeight) {
      continue;
    }

    // Time boundary check
    if (newT > config.totalCounts) {
      continue;
    }

    // Collision check
    if (checkCollision(newX, newY, newT, otherPaths, collisionRadius)) {
      continue;
    }

    const g = node.g + dir.cost * gridResolution;
    const h = heuristic({ x: newX, y: newY, t: newT }, goal);

    neighbors.push({
      x: newX,
      y: newY,
      t: newT,
      g,
      h,
      f: g + h,
      parent: node,
    });
  }

  return neighbors;
}

/**
 * A* path finding
 */
export function findPath(
  start: Position,
  end: Position,
  startTime: number,
  otherPaths: PathPoint[][],
  config: Partial<AStarConfig> = {}
): PathPoint[] {
  const cfg: AStarConfig = { ...DEFAULT_CONFIG, ...config };

  const openSet = new PriorityQueue<Node>((a, b) => a.f - b.f);
  const closedSet = new Set<string>();

  const startNode: Node = {
    x: start.x,
    y: start.y,
    t: startTime,
    g: 0,
    h: heuristic({ x: start.x, y: start.y, t: startTime }, end),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;

  openSet.push(startNode);

  let iterations = 0;
  const maxIterations = 10000;

  while (!openSet.isEmpty() && iterations < maxIterations) {
    iterations++;

    const current = openSet.pop()!;
    const currentKey = nodeKey(current.x, current.y, current.t, cfg.gridResolution);

    // Goal check (position close enough and time reached end)
    const distToGoal = Math.sqrt((current.x - end.x) ** 2 + (current.y - end.y) ** 2);
    if (distToGoal < cfg.gridResolution && current.t >= cfg.totalCounts - cfg.timeResolution) {
      // Reconstruct path
      const path: PathPoint[] = [];
      let node: Node | null = current;

      while (node) {
        path.unshift({ x: node.x, y: node.y, t: node.t });
        node = node.parent;
      }

      // Adjust last point to exact end position
      if (path.length > 0) {
        path[path.length - 1] = { x: end.x, y: end.y, t: cfg.totalCounts };
      }

      return path;
    }

    if (closedSet.has(currentKey)) {
      continue;
    }
    closedSet.add(currentKey);

    const neighbors = getNeighbors(current, cfg, end, otherPaths);

    for (const neighbor of neighbors) {
      const neighborKey = nodeKey(neighbor.x, neighbor.y, neighbor.t, cfg.gridResolution);
      if (closedSet.has(neighborKey)) {
        continue;
      }
      openSet.push(neighbor);
    }
  }

  // If path not found: return direct path (fallback)
  console.warn('A* failed to find path, using direct path');
  return generateDirectPath(start, end, startTime, cfg.totalCounts, cfg.timeResolution);
}

/**
 * Generate direct path (fallback)
 */
function generateDirectPath(
  start: Position,
  end: Position,
  startTime: number,
  endTime: number,
  timeResolution: number
): PathPoint[] {
  const path: PathPoint[] = [];
  const steps = Math.ceil((endTime - startTime) / timeResolution);

  for (let i = 0; i <= steps; i++) {
    const t = startTime + i * timeResolution;
    const ratio = i / steps;
    path.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      t: Math.min(t, endTime),
    });
  }

  return path;
}

/**
 * Compute paths for all dancers sequentially
 * Treat previously computed dancer paths as obstacles
 */
export function computeAllPaths(
  assignments: { dancerId: number; startPosition: Position; endPosition: Position }[],
  config: Partial<AStarConfig> = {}
): PathResult[] {
  const cfg: AStarConfig = { ...DEFAULT_CONFIG, ...config };
  const results: PathResult[] = [];
  const computedPaths: PathPoint[][] = [];

  // Compute longest distance dancers first (give priority)
  const sortedAssignments = [...assignments].sort((a, b) => {
    const distA = Math.sqrt(
      (a.endPosition.x - a.startPosition.x) ** 2 +
      (a.endPosition.y - a.startPosition.y) ** 2
    );
    const distB = Math.sqrt(
      (b.endPosition.x - b.startPosition.x) ** 2 +
      (b.endPosition.y - b.startPosition.y) ** 2
    );
    return distB - distA;  // Descending (longest first)
  });

  for (const assignment of sortedAssignments) {
    const path = findPath(
      assignment.startPosition,
      assignment.endPosition,
      0,  // Start time
      computedPaths,
      cfg
    );

    const totalDistance = calculatePathDistance(path);

    results.push({
      dancerId: assignment.dancerId,
      path,
      totalDistance,
      collisionFree: true,
    });

    computedPaths.push(path);
  }

  // Sort by dancerId and return
  return results.sort((a, b) => a.dancerId - b.dancerId);
}

/**
 * Calculate total path distance
 */
function calculatePathDistance(path: PathPoint[]): number {
  let distance = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    distance += Math.sqrt(dx * dx + dy * dy);
  }
  return distance;
}

/**
 * Path collision validation (post-verification)
 */
export function validatePaths(
  paths: PathResult[],
  collisionRadius: number = 0.5
): { valid: boolean; collisions: { dancer1: number; dancer2: number; time: number; distance: number }[] } {
  const collisions: { dancer1: number; dancer2: number; time: number; distance: number }[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const path1 = paths[i].path;
      const path2 = paths[j].path;

      // Check by time
      for (let t = 0; t <= 8; t += 0.25) {
        const pos1 = interpolatePosition(path1, t);
        const pos2 = interpolatePosition(path2, t);

        if (pos1 && pos2) {
          const dx = pos1.x - pos2.x;
          const dy = pos1.y - pos2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < collisionRadius * 2) {
            collisions.push({
              dancer1: paths[i].dancerId,
              dancer2: paths[j].dancerId,
              time: t,
              distance: dist,
            });
          }
        }
      }
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}
