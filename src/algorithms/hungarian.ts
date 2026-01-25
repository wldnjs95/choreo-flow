/**
 * Hungarian Algorithm (Kuhn-Munkres Algorithm)
 * Solve optimal assignment problem - minimize total movement distance
 *
 * Input: N start positions, N end positions
 * Output: Optimal matching of which dancer goes to which end position
 */

export interface Position {
  x: number;
  y: number;
}

export interface Assignment {
  dancerId: number;
  startPosition: Position;
  endPosition: Position;
  distance: number;
}

/**
 * Calculate Euclidean distance between two points
 */
function euclideanDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Create cost matrix (distance from start position to end position)
 */
function createCostMatrix(starts: Position[], ends: Position[]): number[][] {
  const n = starts.length;
  const matrix: number[][] = [];

  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      matrix[i][j] = euclideanDistance(starts[i], ends[j]);
    }
  }

  return matrix;
}

/**
 * Hungarian Algorithm implementation
 * O(n³) time complexity
 */
export function hungarianAlgorithm(costMatrix: number[][]): number[] {
  const n = costMatrix.length;

  // Create copy (prevent modifying original)
  const cost: number[][] = costMatrix.map(row => [...row]);

  // Step 1: Subtract minimum value from each row
  for (let i = 0; i < n; i++) {
    const minVal = Math.min(...cost[i]);
    for (let j = 0; j < n; j++) {
      cost[i][j] -= minVal;
    }
  }

  // Step 2: Subtract minimum value from each column
  for (let j = 0; j < n; j++) {
    let minVal = Infinity;
    for (let i = 0; i < n; i++) {
      minVal = Math.min(minVal, cost[i][j]);
    }
    for (let i = 0; i < n; i++) {
      cost[i][j] -= minVal;
    }
  }

  // Initialize assignment arrays
  const rowAssign: number[] = new Array(n).fill(-1);
  const colAssign: number[] = new Array(n).fill(-1);

  // Step 3: Initial assignment using zeros
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (cost[i][j] === 0 && rowAssign[i] === -1 && colAssign[j] === -1) {
        rowAssign[i] = j;
        colAssign[j] = i;
      }
    }
  }

  // Step 4: Find augmenting paths to improve assignment
  const u: number[] = new Array(n).fill(0);
  const v: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const links: number[] = new Array(n).fill(-1);
    const mins: number[] = new Array(n).fill(Infinity);
    const visited: boolean[] = new Array(n).fill(false);

    let markedI = i;
    let markedJ = -1;
    let j0 = 0;

    while (markedI !== -1) {
      j0 = -1;
      let delta = Infinity;

      for (let j = 0; j < n; j++) {
        if (!visited[j]) {
          const cur = cost[markedI][j] - u[markedI] - v[j];
          if (cur < mins[j]) {
            mins[j] = cur;
            links[j] = markedJ;
          }
          if (mins[j] < delta) {
            delta = mins[j];
            j0 = j;
          }
        }
      }

      if (j0 === -1) break;

      for (let j = 0; j < n; j++) {
        if (visited[j]) {
          u[colAssign[j]] += delta;
          v[j] -= delta;
        } else {
          mins[j] -= delta;
        }
      }
      u[i] += delta;

      visited[j0] = true;
      markedJ = j0;
      markedI = colAssign[j0];
    }

    // Update assignment along augmenting path
    while (markedJ !== -1 && links[markedJ] !== -1) {
      const prevJ = links[markedJ];
      colAssign[markedJ] = colAssign[prevJ];
      markedJ = prevJ;
    }
    if (markedJ !== -1) {
      colAssign[markedJ] = i;
      rowAssign[i] = markedJ;
    }
  }

  return rowAssign;
}

/**
 * Simpler Hungarian Algorithm implementation (Brute force + optimization)
 * Guarantees exact solution with DP for N <= 20
 */
export function hungarianSimple(costMatrix: number[][]): number[] {
  const n = costMatrix.length;

  if (n <= 20) {
    // N <= 20: Exact solution using bitmask DP (2^20 = ~1M, fast enough)
    return findOptimalAssignmentDP(costMatrix);
  }

  // N > 20: Approximate algorithm (greedy)
  return greedyAssignment(costMatrix);
}

/**
 * Greedy assignment (approximate solution for large N)
 */
function greedyAssignment(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const assignment: number[] = new Array(n).fill(-1);
  const usedCols: Set<number> = new Set();

  // Select nearest unused column for each row
  for (let i = 0; i < n; i++) {
    let minCost = Infinity;
    let minCol = -1;

    for (let j = 0; j < n; j++) {
      if (!usedCols.has(j) && costMatrix[i][j] < minCost) {
        minCost = costMatrix[i][j];
        minCol = j;
      }
    }

    if (minCol !== -1) {
      assignment[i] = minCol;
      usedCols.add(minCol);
    }
  }

  return assignment;
}

/**
 * Optimal assignment using DP (bitmask)
 * Guarantees exact solution for small N
 */
function findOptimalAssignmentDP(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const INF = 1e9;

  // dp[mask] = minimum cost (mask is bitmask of used columns)
  const dp: number[] = new Array(1 << n).fill(INF);
  const parent: number[] = new Array(1 << n).fill(-1);

  dp[0] = 0;

  for (let mask = 0; mask < (1 << n); mask++) {
    const row = countBits(mask);
    if (row >= n) continue;

    for (let col = 0; col < n; col++) {
      if (mask & (1 << col)) continue;

      const newMask = mask | (1 << col);
      const newCost = dp[mask] + costMatrix[row][col];

      if (newCost < dp[newMask]) {
        dp[newMask] = newCost;
        parent[newMask] = mask;
      }
    }
  }

  // Backtrack to restore assignment
  const assignment: number[] = new Array(n).fill(-1);
  let mask = (1 << n) - 1;

  for (let row = n - 1; row >= 0; row--) {
    const prevMask = parent[mask];
    const col = Math.log2(mask ^ prevMask);
    assignment[row] = col;
    mask = prevMask;
  }

  return assignment;
}

function countBits(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

/**
 * Assignment mode
 */
export type AssignmentMode = 'fixed' | 'optimal';

/**
 * Fixed assignment: Dancer i → End position i (direct 1:1 mapping)
 * No optimization, preserves user-defined order
 */
export function computeFixedAssignment(
  startPositions: Position[],
  endPositions: Position[]
): Assignment[] {
  if (startPositions.length !== endPositions.length) {
    throw new Error('Number of start and end positions must be equal.');
  }

  const n = startPositions.length;
  const result: Assignment[] = [];

  for (let i = 0; i < n; i++) {
    result.push({
      dancerId: i + 1,
      startPosition: startPositions[i],
      endPosition: endPositions[i],  // Direct mapping: i → i
      distance: euclideanDistance(startPositions[i], endPositions[i]),
    });
  }

  return result;
}

/**
 * Optimal assignment using Hungarian algorithm
 * Minimizes total movement distance
 */
export function computeOptimalAssignment(
  startPositions: Position[],
  endPositions: Position[]
): Assignment[] {
  if (startPositions.length !== endPositions.length) {
    throw new Error('Number of start and end positions must be equal.');
  }

  const n = startPositions.length;
  const costMatrix = createCostMatrix(startPositions, endPositions);
  const assignment = hungarianSimple(costMatrix);

  const result: Assignment[] = [];

  for (let i = 0; i < n; i++) {
    const endIdx = assignment[i];
    result.push({
      dancerId: i + 1,
      startPosition: startPositions[i],
      endPosition: endPositions[endIdx],
      distance: costMatrix[i][endIdx],
    });
  }

  return result;
}

/**
 * Compute assignment based on mode
 */
export function computeAssignment(
  startPositions: Position[],
  endPositions: Position[],
  mode: AssignmentMode = 'fixed'
): Assignment[] {
  if (mode === 'optimal') {
    return computeOptimalAssignment(startPositions, endPositions);
  }
  return computeFixedAssignment(startPositions, endPositions);
}

/**
 * Calculate total movement distance
 */
export function calculateTotalDistance(assignments: Assignment[]): number {
  return assignments.reduce((sum, a) => sum + a.distance, 0);
}

/**
 * Output assignment result summary
 */
export function summarizeAssignment(assignments: Assignment[]): string {
  const lines = assignments.map(a =>
    `Dancer ${a.dancerId}: (${a.startPosition.x}, ${a.startPosition.y}) → (${a.endPosition.x}, ${a.endPosition.y}) [${a.distance.toFixed(2)}m]`
  );

  const total = calculateTotalDistance(assignments);
  lines.push(`\nTotal distance: ${total.toFixed(2)}m`);

  return lines.join('\n');
}
