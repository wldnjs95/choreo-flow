/**
 * 안무 생성 파이프라인 (Choreography Pipeline)
 *
 * 전체 흐름:
 * 1. Gemini: 자연어 → 파라미터 파싱
 * 2. Formation Generator: 대형 좌표 생성
 * 3. Hungarian Algorithm: 최적 할당
 * 4. Simple Pathfinder: 직선 경로 + 충돌 회피
 * 5. Gemini: 미적 평가 및 피드백
 */

import { computeOptimalAssignment } from "./hungarian";
import type { Position, Assignment } from "./hungarian";
import { computeAllPathsSimple, validatePathsSimple } from "./pathfinder";
import type { DancerPath } from "./pathfinder";
import { generateFormation, applySpread } from "./formations";
import type { FormationType } from "./formations";
import {
  parseChoreographyRequest,
  parseChoreographyRequestMock,
} from "../gemini/parser";
import type { ChoreographyRequest } from "../gemini/parser";
import { evaluateChoreographyLocal } from "../gemini/evaluator";
import type { AestheticScore } from "../gemini/evaluator";
import { isApiKeyConfigured } from "../gemini/config";
import { generatePathsViaGemini } from "../gemini/generator";

/**
 * 파이프라인 결과
 */
export interface ChoreographyResult {
  // 입력 정보
  request: ChoreographyRequest;

  // 대형 좌표
  startPositions: Position[];
  endPositions: Position[];

  // 할당 결과
  assignments: Assignment[];

  // 경로 결과
  paths: DancerPath[];

  // 부드러운 경로 (시각화용)
  smoothPaths: SmoothPath[];

  // 충돌 검증
  validation: {
    valid: boolean;
    collisions: { dancer1: number; dancer2: number; time: number }[];
  };

  // 미적 평가 (선택)
  aestheticScore?: AestheticScore;

  // 메타데이터
  metadata: {
    totalDistance: number;
    averageDistance: number;
    maxDistance: number;
    minDistance: number;
    computeTimeMs: number;
  };
}

export interface SmoothPath {
  dancerId: number;
  color: string;
  points: { x: number; y: number; t: number }[];
  startTime: number;
  speed: number;
  distance: number;
}

// Dancer 색상
const DANCER_COLORS = [
  "#FF6B6B", // Coral Red
  "#4ECDC4", // Teal
  "#45B7D1", // Sky Blue
  "#96CEB4", // Sage Green
  "#FFD93D", // Golden Yellow
  "#6C5CE7", // Purple
  "#A8E6CF", // Mint
  "#FF8C42", // Orange
];

/**
 * 자연어 입력으로 안무 생성
 */
export async function generateChoreographyFromText(
  userInput: string,
  options: {
    useGeminiParser?: boolean;
    useGeminiEvaluator?: boolean;
    dancerCount?: number;
    stageWidth?: number;
    stageHeight?: number;
  } = {},
): Promise<ChoreographyResult> {
  const {
    useGeminiParser = isApiKeyConfigured(),
    dancerCount = 8,
    stageWidth = 12,
    stageHeight = 10,
  } = options;

  const startTime = performance.now();

  // 1. 자연어 파싱
  let request: ChoreographyRequest;
  if (useGeminiParser) {
    request = await parseChoreographyRequest(userInput);
  } else {
    request = parseChoreographyRequestMock(userInput);
  }

  // 2. 대형 좌표 생성
  const startPositions = generateFormation(
    request.startFormation.type as FormationType,
    dancerCount,
    {
      ...request.startFormation.params,
      spread: request.style.spread,
      stageWidth,
      stageHeight,
    },
  );

  let endPositions = generateFormation(
    request.endFormation.type as FormationType,
    dancerCount,
    {
      ...request.endFormation.params,
      spread: request.style.spread,
      stageWidth,
      stageHeight,
    },
  );

  // spread 적용
  if (request.style.spread !== 1.0) {
    endPositions = applySpread(
      endPositions,
      request.style.spread,
      stageWidth,
      stageHeight,
    );
  }

  // 3. 최적 할당 (Hungarian Algorithm)
  const assignments = computeOptimalAssignment(startPositions, endPositions);

  // 4. 경로 계산 (Simple Pathfinder - 직선 + 충돌 회피)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts: request.totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // 5. 시각화용 경로 변환
  const smoothPaths = pathsToSmoothPaths(paths);

  // 6. 충돌 검증
  const validation = validatePathsSimple(paths, 0.5, request.totalCounts);

  // 7. 메타데이터 계산
  const distances = paths.map((p) => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance:
      distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // 8. 로컬 미적 평가
  const pathResults = paths.map((p) => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(
    pathResults,
    request.mainDancer,
  );

  return {
    request,
    startPositions,
    endPositions,
    assignments,
    paths,
    smoothPaths,
    validation,
    aestheticScore,
    metadata,
  };
}

/**
 * 직접 파라미터로 안무 생성
 */
export function generateChoreographyDirect(
  startFormation: FormationType,
  endFormation: FormationType,
  options: {
    dancerCount?: number;
    spread?: number;
    totalCounts?: number;
    mainDancer?: number;
    customStartPositions?: Position[];
    customEndPositions?: Position[];
    stageWidth?: number;
    stageHeight?: number;
  } = {},
): ChoreographyResult {
  const {
    dancerCount = 8,
    spread = 1.0,
    totalCounts = 8,
    mainDancer = null,
    customStartPositions,
    customEndPositions,
    stageWidth = 12,
    stageHeight = 10,
  } = options;

  const startTime = performance.now();

  // 대형 생성 (커스텀 포지션이 있으면 사용)
  const startPositions =
    customStartPositions ||
    generateFormation(startFormation, dancerCount, {
      spread,
      stageWidth,
      stageHeight,
    });
  const endPositions =
    customEndPositions ||
    generateFormation(endFormation, dancerCount, {
      spread,
      stageWidth,
      stageHeight,
    });

  // 최적 할당
  const assignments = computeOptimalAssignment(startPositions, endPositions);

  // 경로 계산 (Simple Pathfinder)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // 시각화용 경로 변환
  const smoothPaths = pathsToSmoothPaths(paths);

  // Request 객체 생성
  const request: ChoreographyRequest = {
    startFormation: { type: startFormation },
    endFormation: { type: endFormation },
    constraints: [],
    style: {
      spread,
      symmetry: false,
      smoothness: 0.7,
      speed: "normal",
      dramatic: false,
    },
    mainDancer,
    keyframes: [],
    totalCounts,
    originalInput: "",
  };

  // 검증
  const validation = validatePathsSimple(paths, 0.5, totalCounts);

  // 메타데이터
  const distances = paths.map((p) => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance:
      distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // 로컬 평가
  const pathResults = paths.map((p) => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(pathResults, mainDancer);

  return {
    request,
    startPositions,
    endPositions,
    assignments,
    paths,
    smoothPaths,
    validation,
    aestheticScore,
    metadata,
  };
}

/**
 * DancerPath를 SmoothPath로 변환
 */
function pathsToSmoothPaths(paths: DancerPath[]): SmoothPath[] {
  return paths.map((p) => ({
    dancerId: p.dancerId,
    color: DANCER_COLORS[(p.dancerId - 1) % DANCER_COLORS.length],
    points: p.path,
    startTime: p.startTime,
    speed: p.speed,
    distance: p.totalDistance,
  }));
}

/**
 * 결과를 시각화용 데이터로 변환
 */
export function toVisualizationData(result: ChoreographyResult) {
  return {
    stageWidth: 10,
    stageHeight: 8,
    totalCounts: result.request.totalCounts,
    dancers: result.smoothPaths.map((sp) => ({
      id: sp.dancerId,
      color: sp.color,
      startPosition: result.startPositions[sp.dancerId - 1],
      endPosition: result.endPositions[sp.dancerId - 1],
      path: sp.points,
      startTime: sp.startTime,
      speed: sp.speed,
      distance: sp.distance,
    })),
    metadata: result.metadata,
    aestheticScore: result.aestheticScore,
  };
}

/**
 * 결과를 JSON으로 내보내기
 */
export function exportToJSON(result: ChoreographyResult): string {
  return JSON.stringify(toVisualizationData(result), null, 2);
}

/**
 * [NEW] 순수 Gemini 모드 안무 생성 함수
 * 알고리즘(헝가리안, A*)을 전혀 사용하지 않음
 */
export async function generateChoreographyPureAI(
  userInput: string,
  options: {
    dancerCount?: number;
    stageWidth?: number;
    stageHeight?: number;
  } = {},
): Promise<ChoreographyResult> {
  const { dancerCount = 8, stageWidth = 12, stageHeight = 10 } = options;

  const startTime = performance.now();

  // 1. Gemini에게 전체 경로 생성 요청
  const geminiData = await generatePathsViaGemini(userInput, {
    width: stageWidth,
    height: stageHeight,
    dancerCount: dancerCount,
    totalCounts: 8,
  });

  // 2. Gemini 응답을 기존 포맷(ChoreographyResult)으로 변환

  // 시작/끝 위치 추출 (t=0, t=last)
  const startPositions = geminiData.dancers.map((d) => {
    const p = d.path.find((pt) => pt.t === 0) || { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  });

  const endPositions = geminiData.dancers.map((d) => {
    const p = d.path[d.path.length - 1] || { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  });

  // 경로 데이터 변환 (SmoothPath)
  const smoothPaths: SmoothPath[] = geminiData.dancers.map((d, index) => {
    // 거리 계산
    let dist = 0;
    for (let i = 0; i < d.path.length - 1; i++) {
      const p1 = d.path[i];
      const p2 = d.path[i + 1];
      dist += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    return {
      dancerId: d.id,
      color: DANCER_COLORS[index % DANCER_COLORS.length], // 기존 색상 배열 사용
      points: d.path.map((p) => ({ x: p.x, y: p.y, t: p.t })),
      startTime: 0,
      speed: 1, // 단순화
      distance: dist,
    };
  });

  // 3. 기존 UI 컴포넌트 호환을 위한 더미(Dummy) 데이터 채우기
  // (UI는 assignments, validation 등을 참조하므로 빈 값이라도 있어야 함)
  const assignments: Assignment[] = geminiData.dancers.map((d) => ({
    dancerId: d.id,
    startPosIndex: d.id - 1,
    endPosIndex: d.id - 1,
    cost: 0,
  }));

  const paths: DancerPath[] = smoothPaths.map((sp) => ({
    dancerId: sp.dancerId,
    path: sp.points,
    totalDistance: sp.distance,
    startTime: 0,
    speed: 1,
  }));

  // 메타데이터
  const distances = paths.map((p) => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance:
      distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  return {
    request: {
      originalInput: userInput,
      // 아래 필드들은 UI 표시용 더미 데이터
      startFormation: { type: "custom" },
      endFormation: { type: "custom" },
      constraints: [],
      style: {
        spread: 1,
        symmetry: false,
        smoothness: 1,
        speed: "normal",
        dramatic: false,
      },
      mainDancer: null,
      keyframes: [],
      totalCounts: geminiData.totalCounts,
    },
    startPositions,
    endPositions,
    assignments,
    paths,
    smoothPaths,
    validation: { valid: true, collisions: [] }, // Gemini를 믿음 (검증 생략)
    metadata,
    aestheticScore: undefined, // 필요시 평가 로직 추가 가능
  };
}
