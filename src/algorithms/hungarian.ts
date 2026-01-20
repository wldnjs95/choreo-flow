/**
 * Hungarian Algorithm (Kuhn-Munkres Algorithm)
 * 최적 할당 문제 해결 - 총 이동 거리 최소화
 *
 * Input: N개의 시작 위치, N개의 끝 위치
 * Output: 각 dancer가 어떤 끝 위치로 갈지 최적 매칭
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
 * 두 점 사이의 유클리드 거리 계산
 */
function euclideanDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 비용 행렬 생성 (시작 위치 → 끝 위치 거리)
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
 * Hungarian Algorithm 구현
 * O(n³) 시간 복잡도
 */
export function hungarianAlgorithm(costMatrix: number[][]): number[] {
  const n = costMatrix.length;

  // 복사본 생성 (원본 수정 방지)
  const cost: number[][] = costMatrix.map(row => [...row]);

  // Step 1: 각 행에서 최소값 빼기
  for (let i = 0; i < n; i++) {
    const minVal = Math.min(...cost[i]);
    for (let j = 0; j < n; j++) {
      cost[i][j] -= minVal;
    }
  }

  // Step 2: 각 열에서 최소값 빼기
  for (let j = 0; j < n; j++) {
    let minVal = Infinity;
    for (let i = 0; i < n; i++) {
      minVal = Math.min(minVal, cost[i][j]);
    }
    for (let i = 0; i < n; i++) {
      cost[i][j] -= minVal;
    }
  }

  // 할당 배열 초기화
  const rowAssign: number[] = new Array(n).fill(-1);
  const colAssign: number[] = new Array(n).fill(-1);

  // Step 3: 0을 이용한 초기 할당
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (cost[i][j] === 0 && rowAssign[i] === -1 && colAssign[j] === -1) {
        rowAssign[i] = j;
        colAssign[j] = i;
      }
    }
  }

  // Step 4: 증가 경로를 찾아 할당 개선
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

    // 증가 경로 따라가며 할당 갱신
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
 * 더 간단한 Hungarian Algorithm 구현 (Brute force + optimization)
 * N <= 20까지는 DP로 정확한 해 보장
 */
export function hungarianSimple(costMatrix: number[][]): number[] {
  const n = costMatrix.length;

  if (n <= 20) {
    // N <= 20: 비트마스킹 DP로 정확한 해 (2^20 = 약 100만, 충분히 빠름)
    return findOptimalAssignmentDP(costMatrix);
  }

  // N > 20: 근사 알고리즘 (greedy)
  return greedyAssignment(costMatrix);
}

/**
 * Greedy 할당 (큰 N에서 근사해)
 */
function greedyAssignment(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const assignment: number[] = new Array(n).fill(-1);
  const usedCols: Set<number> = new Set();

  // 각 행에서 가장 가까운 미사용 열 선택
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
 * DP를 이용한 최적 할당 (비트마스킹)
 * 작은 N에서 정확한 해를 보장
 */
function findOptimalAssignmentDP(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const INF = 1e9;

  // dp[mask] = 최소 비용 (mask는 사용된 열들의 비트마스크)
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

  // 역추적하여 할당 복원
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
 * 메인 함수: 최적 할당 계산
 */
export function computeOptimalAssignment(
  startPositions: Position[],
  endPositions: Position[]
): Assignment[] {
  if (startPositions.length !== endPositions.length) {
    throw new Error('시작 위치와 끝 위치의 개수가 같아야 합니다.');
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
 * 총 이동 거리 계산
 */
export function calculateTotalDistance(assignments: Assignment[]): number {
  return assignments.reduce((sum, a) => sum + a.distance, 0);
}

/**
 * 할당 결과 요약 출력
 */
export function summarizeAssignment(assignments: Assignment[]): string {
  const lines = assignments.map(a =>
    `Dancer ${a.dancerId}: (${a.startPosition.x}, ${a.startPosition.y}) → (${a.endPosition.x}, ${a.endPosition.y}) [${a.distance.toFixed(2)}m]`
  );

  const total = calculateTotalDistance(assignments);
  lines.push(`\nTotal distance: ${total.toFixed(2)}m`);

  return lines.join('\n');
}
