/**
 * Formation Types
 * Types for dance formations and presets
 */

import type { Position } from './geometry';

/**
 * Available formation types
 */
export type FormationType =
  | 'line'
  | 'circle'
  | 'v_shape'
  | 'diagonal'
  | 'scatter'
  | 'heart'
  | 'diamond'
  | 'triangle'
  | 'two_lines'
  | 'custom';

/**
 * Formation generation parameters
 */
export interface FormationParams {
  centerX?: number;
  centerY?: number;
  radius?: number;
  width?: number;
  height?: number;
  spread?: number;
  angle?: number;
  direction?: 'horizontal' | 'vertical';
  stageWidth?: number;
  stageHeight?: number;
}

/**
 * Saved formation structure (for storage/export)
 */
export interface SavedFormation {
  name: string;
  dancerCount: number;
  positions: Position[];
  stageWidth: number;
  stageHeight: number;
  createdAt: string;
  description?: string;
}

/**
 * Collection of formations (for file export/import)
 */
export interface FormationCollection {
  formations: SavedFormation[];
  version: string;
}

/**
 * Collision test case
 */
export interface TestCase {
  label: string;
  description: string;
  dancerCount: number;
  stageWidth: number;
  stageHeight: number;
  getPositions: () => { start: Position[]; end: Position[] };
}

// Re-export for convenience
export type { Position } from './geometry';
