/**
 * Gemini 모듈 통합 내보내기
 */

// Config
export {
  GEMINI_API_KEY,
  GEMINI_API_URL,
  GEMINI_CONFIG,
  isApiKeyConfigured,
  callGeminiAPI,
} from './config';

// Parser
export {
  parseChoreographyRequest,
  parseChoreographyRequestMock,
  type ChoreographyRequest,
  type FormationSpec,
  type DancerConstraint,
  type StyleSpec,
  type KeyframeSpec,
} from './parser';

// Evaluator
export {
  evaluateChoreography,
  evaluateChoreographyLocal,
  type AestheticScore,
  type ImprovementSuggestion,
} from './evaluator';

// Ranker (후보 랭킹)
export {
  rankCandidatesWithGemini,
  rankCandidatesLocal,
  generateComparisonSummary,
  type UserPreference,
  type RankingResult,
} from './ranker';

// Pre-Constraint (사전 제약)
export {
  generatePreConstraint,
  generateDefaultConstraint,
  type GeminiPreConstraint,
  type DancerHint,
  type MovementOrder,
} from './preConstraint';
