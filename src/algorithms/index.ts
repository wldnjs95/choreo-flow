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

// Pipeline
export {
  generateChoreographyFromText,
  generateChoreographyDirect,
  toVisualizationData,
  exportToJSON,
  type ChoreographyResult,
  type SmoothPath,
} from './pipeline';
