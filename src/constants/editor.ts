/**
 * Editor Constants and Types
 * Shared constants and types for the TimelineEditor
 */

import preFormationData from '../../formation_data/pre-formation.json';

// Path algorithm options
export type PathAlgorithm =
  | 'clean_flow'
  | 'natural_curves'
  | 'wave_sync'
  | 'perfect_sync'
  | 'balanced_direct'
  | 'harmonized_flow';

export const PATH_ALGORITHM_LABELS: Record<PathAlgorithm, string> = {
  'clean_flow': 'Clean Flow',
  'natural_curves': 'Natural Curves',
  'wave_sync': 'Wave Sync',
  'perfect_sync': 'Perfect Sync',
  'balanced_direct': 'Balanced Direct',
  'harmonized_flow': 'Harmonized Flow',
};

// Algorithm priority for identical path selection (higher = preferred)
export const ALGORITHM_PRIORITY: PathAlgorithm[] = [
  'natural_curves',    // Most sophisticated curves
  'clean_flow',        // Good balance
  'harmonized_flow',   // Radial harmony (moved up)
  'wave_sync',         // Staggered timing
  'perfect_sync',      // Strict sync
  'balanced_direct',   // Load balanced
];

// All algorithms list
export const ALL_ALGORITHMS: PathAlgorithm[] = [
  'natural_curves',
  'clean_flow',
  'wave_sync',
  'perfect_sync',
  'balanced_direct',
  'harmonized_flow',
];

// Generated path structure
export interface GeneratedPath {
  dancerId: number;
  path: { x: number; y: number; t: number }[];
}

// Formation preset interface
export interface FormationPreset {
  name: string;
  label: string;
  dancerCount: number;
  positions: { x: number; y: number }[];
  stageWidth: number;
  stageHeight: number;
}

// Organize presets by dancer count
export const FORMATION_PRESETS: Map<number, FormationPreset[]> = (() => {
  const map = new Map<number, FormationPreset[]>();

  preFormationData.formations.forEach((f: { name: string; dancerCount: number; positions: { x: number; y: number }[]; stageWidth: number; stageHeight: number }) => {
    const existing = map.get(f.dancerCount) || [];
    existing.push({
      name: f.name,
      label: f.name.replace(/_/g, ' ').replace(/(\d+) /, '$1 dancers '),
      dancerCount: f.dancerCount,
      positions: f.positions,
      stageWidth: f.stageWidth || 15,
      stageHeight: f.stageHeight || 12,
    });
    map.set(f.dancerCount, existing);
  });

  return map;
})();

// Get all presets flattened for the left panel
export const ALL_PRESETS: FormationPreset[] = (() => {
  const presets: FormationPreset[] = [];
  for (let count = 4; count <= 12; count++) {
    const countPresets = FORMATION_PRESETS.get(count) || [];
    presets.push(...countPresets);
  }
  return presets;
})();

// Playback constants
export const COUNTS_PER_SECOND = 2; // 2 counts per second (120 BPM = 8 counts per 4 beats)

// Grid snap
export const SNAP_SIZE = 0.5; // 0.5m grid
export const snapToGrid = (value: number): number => Math.round(value / SNAP_SIZE) * SNAP_SIZE;

// Exit zone size
export const EXIT_ZONE_WIDTH = 1.5; // 1.5m on each side

// Slot spacing for dancer entry/exit
export const SLOT_SPACING = 1.5;

// Undo history limit
export const MAX_UNDO_HISTORY = 50;

// Score breakdown interface for path evaluation
export interface ScoreBreakdown {
  efficiency: number;
  safety: number;
  directness: number;
  synchronization: number;
}

// Path evaluation result (from Gemini or deterministic)
export interface PathEvaluationResult {
  pick: PathAlgorithm;
  scores: Map<PathAlgorithm, number>;
  breakdowns: Map<PathAlgorithm, ScoreBreakdown>;
  insights: Map<PathAlgorithm, string>;
  pickReason: string;
}
