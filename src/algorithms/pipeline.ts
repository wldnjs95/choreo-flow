/**
 * Choreography Pipeline
 *
 * Overall flow:
 * 1. Gemini: Natural language → Parameter parsing
 * 2. Formation Generator: Generate formation coordinates
 * 3. Hungarian Algorithm: Optimal assignment
 * 4. Simple Pathfinder: Linear path + collision avoidance
 * 5. Gemini: Aesthetic evaluation and feedback
 */

import { computeAssignment } from './hungarian';
import type { Position, Assignment, AssignmentMode } from './hungarian';
import { computeAllPathsSimple, validatePathsSimple } from './pathfinder';
import type { DancerPath } from './pathfinder';
import { generateFormation, applySpread } from './formations';
import type { FormationType } from './formations';
import {
  generateAllCandidates,
  generateCandidatesWithConstraint,
  summarizeCandidatesForGemini,
} from './candidateGenerator';
import type { CandidateResult } from './candidateGenerator';
import {
  parseChoreographyRequest,
  parseChoreographyRequestMock,
} from '../gemini/parser';
import type { ChoreographyRequest } from '../gemini/parser';
import {
  evaluateChoreographyLocal,
} from '../gemini/evaluator';
import type { AestheticScore } from '../gemini/evaluator';
import {
  rankCandidatesWithGemini,
  rankCandidatesLocal,
} from '../gemini/ranker';
import type { UserPreference, RankingResult } from '../gemini/ranker';
import {
  generatePreConstraint,
  generateDefaultConstraint,
} from '../gemini/preConstraint';
import type { GeminiPreConstraint } from '../gemini/preConstraint';
import { isApiKeyConfigured } from '../gemini/config';

/**
 * Pipeline mode for Gemini integration
 */
export type GeminiPipelineMode =
  | 'without_gemini'    // Without Gemini: Algorithm only, local ranking
  | 'ranking_only'      // Gemini Ranking Only: Algorithm → Gemini ranking
  | 'pre_and_ranking';  // Gemini Pre + Ranking: Gemini constraints → Algorithm → Gemini ranking

/**
 * Pipeline result
 */
export interface ChoreographyResult {
  // Input information
  request: ChoreographyRequest;

  // Formation coordinates
  startPositions: Position[];
  endPositions: Position[];

  // Assignment result
  assignments: Assignment[];

  // Path result
  paths: DancerPath[];

  // Smooth paths (for visualization)
  smoothPaths: SmoothPath[];

  // Collision validation
  validation: {
    valid: boolean;
    collisions: { dancer1: number; dancer2: number; time: number }[];
  };

  // Aesthetic evaluation (optional)
  aestheticScore?: AestheticScore;

  // Metadata
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

// Dancer colors
const DANCER_COLORS = [
  '#FF6B6B',  // Coral Red
  '#4ECDC4',  // Teal
  '#45B7D1',  // Sky Blue
  '#96CEB4',  // Sage Green
  '#FFD93D',  // Golden Yellow
  '#6C5CE7',  // Purple
  '#A8E6CF',  // Mint
  '#FF8C42',  // Orange
];

/**
 * Generate choreography from natural language input
 */
export async function generateChoreographyFromText(
  userInput: string,
  options: {
    useGeminiParser?: boolean;
    useGeminiEvaluator?: boolean;
    dancerCount?: number;
    stageWidth?: number;
    stageHeight?: number;
  } = {}
): Promise<ChoreographyResult> {
  // isApiKeyConfigured is async, so resolve default values
  const apiConfigured = options.useGeminiParser !== undefined ? options.useGeminiParser : await isApiKeyConfigured();
  const {
    useGeminiParser = apiConfigured,
    dancerCount = 8,
    stageWidth = 12,
    stageHeight = 10,
  } = options;

  const startTime = performance.now();

  // 1. Natural language parsing
  let request: ChoreographyRequest;
  if (useGeminiParser) {
    request = await parseChoreographyRequest(userInput);
  } else {
    request = parseChoreographyRequestMock(userInput);
  }

  // 2. Generate formation coordinates
  const startPositions = generateFormation(
    request.startFormation.type as FormationType,
    dancerCount,
    { ...request.startFormation.params, spread: request.style.spread, stageWidth, stageHeight }
  );

  let endPositions = generateFormation(
    request.endFormation.type as FormationType,
    dancerCount,
    { ...request.endFormation.params, spread: request.style.spread, stageWidth, stageHeight }
  );

  // Apply spread
  if (request.style.spread !== 1.0) {
    endPositions = applySpread(endPositions, request.style.spread, stageWidth, stageHeight);
  }

  // 3. Assignment (fixed by default)
  const assignments = computeAssignment(startPositions, endPositions, 'fixed');

  // 4. Path calculation (Simple Pathfinder - linear + collision avoidance)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts: request.totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // 5. Convert paths for visualization
  const smoothPaths = pathsToSmoothPaths(paths);

  // 6. Collision validation
  const validation = validatePathsSimple(paths, 0.5, request.totalCounts);

  // 7. Calculate metadata
  const distances = paths.map(p => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // 8. Local aesthetic evaluation
  const pathResults = paths.map(p => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(pathResults, request.mainDancer);

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
 * Generate choreography with direct parameters
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
  } = {}
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

  // Generate formation (use custom positions if available)
  const startPositions = customStartPositions || generateFormation(startFormation, dancerCount, { spread, stageWidth, stageHeight });
  const endPositions = customEndPositions || generateFormation(endFormation, dancerCount, { spread, stageWidth, stageHeight });

  // Assignment (fixed by default)
  const assignments = computeAssignment(startPositions, endPositions, 'fixed');

  // Path calculation (Simple Pathfinder)
  const paths = computeAllPathsSimple(assignments, {
    totalCounts,
    collisionRadius: 0.5,
    numPoints: 20,
  });

  // Convert paths for visualization
  const smoothPaths = pathsToSmoothPaths(paths);

  // Create Request object
  const request: ChoreographyRequest = {
    startFormation: { type: startFormation },
    endFormation: { type: endFormation },
    constraints: [],
    style: { spread, symmetry: false, smoothness: 0.7, speed: 'normal', dramatic: false },
    mainDancer,
    keyframes: [],
    totalCounts,
    originalInput: '',
  };

  // Validation
  const validation = validatePathsSimple(paths, 0.5, totalCounts);

  // Metadata
  const distances = paths.map(p => p.totalDistance);
  const metadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  // Local evaluation
  const pathResults = paths.map(p => ({
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
 * Convert DancerPath to SmoothPath
 */
function pathsToSmoothPaths(paths: DancerPath[]): SmoothPath[] {
  return paths.map(p => ({
    dancerId: p.dancerId,
    color: DANCER_COLORS[(p.dancerId - 1) % DANCER_COLORS.length],
    points: p.path,
    startTime: p.startTime,
    speed: p.speed,
    distance: p.totalDistance,
  }));
}

/**
 * Convert result to visualization data
 */
export function toVisualizationData(result: ChoreographyResult) {
  return {
    stageWidth: 10,
    stageHeight: 8,
    totalCounts: result.request.totalCounts,
    dancers: result.smoothPaths.map(sp => ({
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
 * Export result to JSON
 */
export function exportToJSON(result: ChoreographyResult): string {
  return JSON.stringify(toVisualizationData(result), null, 2);
}

/**
 * Multi-candidate pipeline result
 */
export interface MultiCandidateResult {
  // Selected final result
  selectedResult: ChoreographyResult;

  // All candidates
  candidates: CandidateResult[];

  // Ranking result (null in without_gemini mode)
  ranking: RankingResult | null;

  // Candidates summary (for Gemini)
  candidatesSummary: object;

  // Gemini pre-constraint (only in pre_and_ranking mode)
  preConstraint?: GeminiPreConstraint;

  // Metadata
  metadata: {
    totalCandidates: number;
    selectedStrategy: string;
    computeTimeMs: number;
    usedGeminiRanking: boolean;
    pipelineMode: GeminiPipelineMode;
    usedGeminiPreConstraint: boolean;
  };
}

/**
 * Multi-candidate generation + Gemini ranking pipeline
 *
 * Modes:
 * - ranking_only: Algorithm → Gemini ranking only
 * - pre_and_ranking: Gemini pre-constraint → Algorithm → Gemini ranking
 */
export async function generateChoreographyWithCandidates(
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
    userPreference?: UserPreference;
    useGeminiRanking?: boolean;
    pipelineMode?: GeminiPipelineMode;
    assignmentMode?: AssignmentMode;
  } = {}
): Promise<MultiCandidateResult> {
  const {
    dancerCount = 8,
    spread = 1.0,
    totalCounts = 8,
    mainDancer = null,
    customStartPositions,
    customEndPositions,
    stageWidth = 12,
    stageHeight = 10,
    userPreference = {},
    useGeminiRanking = false,
    pipelineMode = 'ranking_only',
    assignmentMode = 'fixed',
  } = options;

  const startTime = performance.now();

  // 1. Generate formation
  const startPositions = customStartPositions || generateFormation(startFormation, dancerCount, { spread, stageWidth, stageHeight });
  const endPositions = customEndPositions || generateFormation(endFormation, dancerCount, { spread, stageWidth, stageHeight });

  // 2. Generate candidates (depends on mode)
  let candidates: CandidateResult[];
  let preConstraint: GeminiPreConstraint | undefined;
  let usedGeminiPreConstraint = false;

  if (pipelineMode === 'pre_and_ranking') {
    // Pre + Ranking mode: Gemini pre-constraint → constraint-based generation
    try {
      preConstraint = await generatePreConstraint(startPositions, endPositions, stageWidth, stageHeight);
      usedGeminiPreConstraint = true;
      console.log('Gemini Pre-constraint generated:', preConstraint.overallStrategy);
    } catch (error) {
      console.warn('Gemini Pre-constraint failed, using default:', error);
      preConstraint = generateDefaultConstraint(startPositions, endPositions, stageWidth, stageHeight);
    }

    candidates = generateCandidatesWithConstraint(preConstraint, startPositions, endPositions, {
      totalCounts,
      collisionRadius: 0.5,
      stageWidth,
      stageHeight,
      assignmentMode,
    });
  } else {
    // Without Gemini or Ranking Only mode: standard 5 strategies
    candidates = generateAllCandidates(startPositions, endPositions, {
      totalCounts,
      collisionRadius: 0.5,
      stageWidth,
      stageHeight,
      assignmentMode,
    });
  }

  // 3. Ranking (Gemini or Local)
  let ranking: RankingResult | null = null;
  let usedGeminiRanking = false;

  // Debug logging
  console.log('=== Pipeline Debug ===');
  console.log('Pipeline Mode:', pipelineMode);
  console.log('Candidates count:', candidates.length);
  console.log('Candidate IDs:', candidates.map(c => c.id));

  if (pipelineMode === 'without_gemini') {
    // Without Gemini: No ranking, just use first candidate (already sorted by best metrics)
    console.log('Without Gemini mode: using first candidate (best metrics)');
    console.log('Selected:', candidates[0]?.id);
  } else if (useGeminiRanking) {
    // Gemini ranking
    try {
      console.log('Calling Gemini ranking...');
      ranking = await rankCandidatesWithGemini(candidates, userPreference);
      usedGeminiRanking = true;
      console.log('Gemini ranking success, selected:', ranking.selectedId);
    } catch (error) {
      console.warn('Gemini ranking failed, using local:', error);
      ranking = rankCandidatesLocal(candidates, userPreference);
      console.log('Local ranking fallback, selected:', ranking.selectedId);
    }
  } else {
    // Local ranking (for ranking_only mode without API key)
    console.log('Using local ranking...');
    ranking = rankCandidatesLocal(candidates, userPreference);
    console.log('Local ranking selected:', ranking.selectedId);
  }
  console.log('=== End Pipeline Debug ===')

  // 4. Find selected candidate
  const selectedCandidate = ranking
    ? candidates.find(c => c.id === ranking.selectedId) || candidates[0]
    : candidates[0];  // Without ranking, use first (best metrics)

  // 5. Convert to ChoreographyResult format
  const smoothPaths = pathsToSmoothPaths(selectedCandidate.paths);
  const validation = validatePathsSimple(selectedCandidate.paths, 0.5, totalCounts);

  const request: ChoreographyRequest = {
    startFormation: { type: startFormation },
    endFormation: { type: endFormation },
    constraints: [],
    style: { spread, symmetry: false, smoothness: 0.7, speed: 'normal', dramatic: false },
    mainDancer,
    keyframes: [],
    totalCounts,
    originalInput: '',
  };

  const distances = selectedCandidate.paths.map(p => p.totalDistance);
  const resultMetadata = {
    totalDistance: distances.reduce((sum, d) => sum + d, 0),
    averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
    maxDistance: Math.max(...distances),
    minDistance: Math.min(...distances),
    computeTimeMs: performance.now() - startTime,
  };

  const pathResults = selectedCandidate.paths.map(p => ({
    dancerId: p.dancerId,
    path: p.path,
    totalDistance: p.totalDistance,
    collisionFree: true,
  }));
  const aestheticScore = evaluateChoreographyLocal(pathResults, mainDancer);

  const selectedResult: ChoreographyResult = {
    request,
    startPositions,
    endPositions,
    assignments: selectedCandidate.assignments,
    paths: selectedCandidate.paths,
    smoothPaths,
    validation,
    aestheticScore,
    metadata: resultMetadata,
  };

  return {
    selectedResult,
    candidates,
    ranking,
    candidatesSummary: summarizeCandidatesForGemini(candidates),
    preConstraint,
    metadata: {
      totalCandidates: candidates.length,
      selectedStrategy: selectedCandidate.strategy,
      computeTimeMs: performance.now() - startTime,
      usedGeminiRanking,
      pipelineMode,
      usedGeminiPreConstraint,
    },
  };
}

/**
 * Natural language input + Multi-candidate pipeline
 */
export async function generateChoreographyFromTextWithCandidates(
  userInput: string,
  options: {
    dancerCount?: number;
    stageWidth?: number;
    stageHeight?: number;
    useGeminiParser?: boolean;
    useGeminiRanking?: boolean;
  } = {}
): Promise<MultiCandidateResult> {
  // isApiKeyConfigured is async, so resolve default values
  const apiConfigured = await isApiKeyConfigured();
  const {
    dancerCount = 8,
    stageWidth = 12,
    stageHeight = 10,
    useGeminiParser = apiConfigured,
    useGeminiRanking = apiConfigured,
  } = options;

  // 1. Natural language parsing
  let request: ChoreographyRequest;
  if (useGeminiParser) {
    request = await parseChoreographyRequest(userInput);
  } else {
    request = parseChoreographyRequestMock(userInput);
  }

  // 2. Extract user preference
  const userPreference: UserPreference = {
    description: userInput,
  };

  if (request.style.symmetry) {
    userPreference.priority = 'symmetry';
  }
  if (request.style.smoothness > 0.8) {
    userPreference.style = 'smooth';
  }
  if (request.style.dramatic) {
    userPreference.style = 'dynamic';
  }

  // 3. Run multi-candidate pipeline
  return generateChoreographyWithCandidates(
    request.startFormation.type as FormationType,
    request.endFormation.type as FormationType,
    {
      dancerCount,
      spread: request.style.spread,
      totalCounts: request.totalCounts,
      mainDancer: request.mainDancer ?? undefined,
      stageWidth,
      stageHeight,
      userPreference,
      useGeminiRanking,
    }
  );
}
