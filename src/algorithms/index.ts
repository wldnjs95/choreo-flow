/**
 * Algorithm module exports
 */

// Hungarian Algorithm
export {
  computeAssignment,
  computeFixedAssignment,
  computeOptimalAssignment,
  computePartialAssignment,
  calculateTotalDistance,
  summarizeAssignment,
  type Position,
  type Assignment,
  type AssignmentMode,
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
  generateWithProgressiveEnhancement,
  toVisualizationData,
  exportToJSON,
  type ChoreographyResult,
  type SmoothPath,
  type MultiCandidateResult,
  type GeminiPipelineMode,
} from './pipeline';

// Hybrid Pathfinding Algorithms
export { computeAllPathsWithHybrid } from './choreographyHybrid';
export { computeAllPathsWithHybridByCodex } from './hybridByCodex';
export { computeAllPathsWithHybridByClaude, type SyncMode, type HybridByClaudeConfig } from './hybridByClaude';
export { computeAllPathsWithHybridByClaudeCubic, type HybridByClaudeCubicConfig } from './hybridByClaudeCubic';
export { computeAllPathsWithHybridByGemini } from './choreographyHybridByGemini';
export { computeAllPathsWithHybridByCursor } from './hybridByCursor';
