/**
 * Gemini module exports
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

// Ranker (candidate ranking)
export {
  rankCandidatesWithGemini,
  rankCandidatesLocal,
  generateComparisonSummary,
  type UserPreference,
  type RankingResult,
} from './ranker';

// Pre-Constraint (pre-constraint)
export {
  generatePreConstraint,
  generateDefaultConstraint,
  type GeminiPreConstraint,
  type DancerHint,
  type MovementOrder,
} from './preConstraint';

// Choreographer (Gemini Only mode)
export {
  generateChoreographyWithGemini,
  type GeminiChoreographyRequest,
  type GeminiChoreographyResponse,
} from './choreographer';
