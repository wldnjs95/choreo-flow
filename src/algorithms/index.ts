/**
 * 알고리즘 모듈 통합 내보내기
 */

// Hungarian Algorithm
export {
  computeOptimalAssignment,
  calculateTotalDistance,
  summarizeAssignment,
  type Position,
  type Assignment,
} from './hungarian';

// Simple Pathfinder (직선 경로 + 충돌 회피)
export {
  computeAllPathsSimple,
  validatePathsSimple,
  type PathPoint,
  type DancerPath,
  type PathfinderConfig,
  type SortStrategy,
} from './pathfinder';

// Formation Generator
export {
  generateFormation,
  applySpread,
  translateFormation,
  rotateFormation,
  type FormationType,
  type FormationParams,
} from './formations';

// Candidate Generator (다중 후보 생성)
export {
  generateCandidate,
  generateAllCandidates,
  calculateMetrics,
  summarizeCandidatesForGemini,
  type CandidateStrategy,
  type CandidateMetrics,
  type CandidateResult,
  type CandidateGeneratorConfig,
} from './candidateGenerator';

// Pipeline
export {
  generateChoreographyFromText,
  generateChoreographyDirect,
  generateChoreographyWithCandidates,
  generateChoreographyFromTextWithCandidates,
  toVisualizationData,
  exportToJSON,
  type ChoreographyResult,
  type SmoothPath,
  type MultiCandidateResult,
} from './pipeline';
