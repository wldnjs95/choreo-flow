/**
 * Pathfinding Types
 * Types for path generation and collision avoidance
 */

import type { Position, PathPoint } from './geometry';

export interface DancerPath {
  dancerId: number;
  path: PathPoint[];
  startTime: number;
  speed: number;
  totalDistance: number;
}

export interface Assignment {
  dancerId: number;
  startPosition: Position;
  endPosition: Position;
  distance: number;
}

export type AssignmentMode = 'fixed' | 'partial' | 'optimal';

export type SortStrategy =
  | 'distance_longest_first'   // Longest distance first (default)
  | 'distance_shortest_first'  // Shortest distance first
  | 'none';                    // No sorting (maintain input order)

export type TimingMode =
  | 'proportional'      // Arrival time proportional to distance (default)
  | 'synchronized'      // All dancers arrive at exactly totalCounts
  | 'staggered';        // Sequential start times (wave effect)

export interface PathfinderConfig {
  totalCounts: number;
  collisionRadius: number;
  numPoints: number;
  sortStrategy?: SortStrategy;
  maxCurveOffset?: number;
  preferTiming?: boolean;
  timingMode?: TimingMode;
  staggerDelay?: number;
  forceCurve?: boolean;
  speedMultiplier?: number;
}

// Re-export from geometry for convenience
export type { Position, PathPoint } from './geometry';
