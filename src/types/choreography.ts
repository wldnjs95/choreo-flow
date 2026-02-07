/**
 * Choreography Types
 * Types for choreography generation pipeline and results
 */

import type { Position, PathPoint } from './geometry';
import type { DancerPath, Assignment } from './pathfinding';

/**
 * Pipeline mode for choreography generation
 */
export type GeminiPipelineMode =
  | 'testing_algorithm';  // Testing Algorithm: All strategies, select best by metrics

/**
 * Candidate generation strategy
 */
export type CandidateStrategy =
  | 'harmonized_flow'
  | 'balanced_direct'
  | 'clean_flow'
  | 'natural_curves'
  | 'wave_sync'
  | 'perfect_sync';

/**
 * Candidate metrics for comparison
 */
export interface CandidateMetrics {
  collisionCount: number;
  symmetryScore: number;
  pathSmoothness: number;
  crossingCount: number;
  maxDelay: number;
  avgDelay: number;
  simultaneousArrival: number;
  totalDistance: number;
}

/**
 * Candidate result
 */
export interface CandidateResult {
  id: string;
  strategy: CandidateStrategy;
  paths: DancerPath[];
  metrics: CandidateMetrics;
  assignments: Assignment[];
}

/**
 * Smooth path for visualization
 */
export interface SmoothPath {
  dancerId: number;
  color: string;
  points: PathPoint[];
  startTime: number;
  speed: number;
  distance: number;
}

/**
 * Collision info
 */
export interface CollisionInfo {
  dancer1: number;
  dancer2: number;
  time: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  collisions: CollisionInfo[];
}

/**
 * Choreography metadata
 */
export interface ChoreographyMetadata {
  totalDistance: number;
  averageDistance: number;
  maxDistance: number;
  minDistance: number;
  computeTimeMs: number;
}

/**
 * Choreography request
 */
export interface ChoreographyRequest {
  startFormation: {
    type: string;
    positions?: Position[];
  };
  endFormation: {
    type: string;
    positions?: Position[];
  };
  dancerCount: number;
  totalCounts: number;
  stageWidth?: number;
  stageHeight?: number;
}

/**
 * Aesthetic score for evaluation
 */
export interface AestheticScore {
  overall: number;
  symmetry: number;
  smoothness: number;
  spacing: number;
  creativity: number;
  feedback?: string;
}

/**
 * Multi-candidate result
 */
export interface MultiCandidateResult {
  candidates: CandidateResult[];
  selectedIndex: number;
  selectedCandidate: CandidateResult;
  rankingReason?: string;
}

// Re-export for convenience
export type { Position, PathPoint } from './geometry';
export type { DancerPath, Assignment, AssignmentMode } from './pathfinding';
