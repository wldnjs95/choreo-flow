/**
 * Algorithm module exports
 */

// Hungarian Algorithm
export {
  computeOptimalAssignment,
  calculateTotalDistance,
  summarizeAssignment,
  type Position,
  type Assignment,
} from './hungarian';

// Simple Pathfinder (linear path + collision avoidance)
export {
  computeAllPathsSimple,
  validatePathsSimple,
  type PathPoint,
  type DancerPath,
  type PathfinderConfig,
  type SortStrategy,
  type TimingMode,
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

// Candidate Generator (multi-candidate generation)
export {
  generateCandidate,
  generateAllCandidates,
  generateCandidateWithConstraint,
  generateCandidatesWithConstraint,
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
  type GeminiPipelineMode,
} from './pipeline';
