/**
 * Types Index
 * Central export for all type definitions
 */

// Geometry types
export type { Position, PathPoint, BoundingBox } from './geometry';

// Pathfinding types
export type {
  DancerPath,
  Assignment,
  AssignmentMode,
  SortStrategy,
  TimingMode,
  PathfinderConfig,
} from './pathfinding';

// Choreography types
export type {
  GeminiPipelineMode,
  CandidateStrategy,
  CandidateMetrics,
  CandidateResult,
  SmoothPath,
  CollisionInfo,
  ValidationResult,
  ChoreographyMetadata,
  ChoreographyRequest,
  AestheticScore,
  MultiCandidateResult,
} from './choreography';

// Formation types
export type {
  FormationType,
  FormationParams,
  SavedFormation,
  FormationCollection,
  TestCase,
} from './formation';

// Timeline types
export type {
  TransitionType,
  DancerPosition,
  FormationKeyframe,
  ChoreographyProject,
  TimelineViewState,
  PlaybackState,
  ChoreographyExport,
} from './timeline';

export {
  generateFormationId,
  generateProjectId,
  createEmptyFormation,
  createNewProject,
} from './timeline';
