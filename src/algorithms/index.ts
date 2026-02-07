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

// Pathfinding Algorithms (feature-based naming)
export { computeAllPathsWithHybrid as computePathsHarmonizedFlow } from './choreographyHybrid';
export { computeAllPathsWithHybridByCodex as computePathsBalancedDirect } from './hybridByCodex';
export { computeAllPathsWithHybridByClaude as computePathsCleanFlow, type SyncMode, type HybridByClaudeConfig as CleanFlowConfig } from './hybridByClaude';
export { computeAllPathsWithHybridByClaudeCubic as computePathsNaturalCurves, type HybridByClaudeCubicConfig as NaturalCurvesConfig } from './hybridByClaudeCubic';
export { computeAllPathsWithHybridByGemini as computePathsPerfectSync } from './choreographyHybridByGemini';
export { computeAllPathsWithHybridByCursor as computePathsWaveSync } from './hybridByCursor';
