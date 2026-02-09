/**
 * Timeline Types
 * Types for timeline-based choreography management
 */

import type { Position } from './geometry';
import type { CandidateStrategy } from './choreography';
import type { PathAlgorithm, GeneratedPath, ScoreBreakdown } from '../constants/editor';
import type { CueSheetResult } from '../gemini/cueSheetGenerator';

/**
 * Transition type between formations
 */
export type TransitionType = 'linear' | 'curved' | 'hybrid';

/**
 * Individual dancer position with metadata
 */
export interface DancerPosition {
  dancerId: number;
  position: Position;
  color: string;
  name?: string; // Optional dancer name (e.g., "Alice", "Bob")
}

/**
 * Formation keyframe - a single formation at a specific time
 */
export interface FormationKeyframe {
  id: string;
  startCount: number;      // Start count (0, 8, 16...)
  duration: number;        // Duration in counts (default 8)
  positions: DancerPosition[];
  label?: string;          // "Intro", "Chorus", etc.
  transitionType: TransitionType;
  pathStrategy?: CandidateStrategy;  // Algorithm used for path generation
}

/**
 * Choreography project - contains all formations
 */
export interface ChoreographyProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  dancerCount: number;
  stageWidth: number;
  stageHeight: number;
  formations: FormationKeyframe[];
  dancerNames?: Record<number, string>; // Global dancer names: { 1: "Alice", 2: "Bob", ... }
  bpm?: number;            // Optional BPM for audio sync
  audioFile?: string;      // Optional audio file reference
}

/**
 * Timeline view state
 */
export interface TimelineViewState {
  currentCount: number;
  selectedFormationId: string | null;
  zoom: number;            // pixels per count
  scrollOffset: number;
  isPlaying: boolean;
}

/**
 * Playback state for sequential playback
 */
export interface PlaybackState {
  isPlaying: boolean;
  currentCount: number;
  playbackSpeed: number;   // 1.0 = normal speed
  loopEnabled: boolean;
}

/**
 * Serializable version of Gemini evaluation result (Maps converted to Records)
 */
export interface SerializedPathEvaluationResult {
  pick: PathAlgorithm;
  scores: Record<string, number>;
  breakdowns: Record<string, ScoreBreakdown>;
  insights: Record<string, string>;
  pickReason: string;
}

/**
 * Serializable format for algorithm paths
 * Key: "fromId->toId", Value: { algorithmName: GeneratedPath[] }
 */
export type SerializedAlgorithmPaths = Record<string, Record<string, GeneratedPath[]>>;

/**
 * Serializable format for user-selected algorithms
 */
export type SerializedUserSelectedAlgorithms = Record<string, PathAlgorithm>;

/**
 * Serializable format for Gemini results
 */
export type SerializedGeminiResults = Record<string, SerializedPathEvaluationResult>;

/**
 * Export format for JSON save/load
 * Version 1.0: Basic project data
 * Version 2.0: Extended with paths, algorithms, Gemini results, cue sheet
 */
export interface ChoreographyExport {
  version: string;
  project: ChoreographyProject;
  exportedAt: string;
  // Version 2.0+ fields (optional for backwards compatibility)
  allAlgorithmPaths?: SerializedAlgorithmPaths;
  userSelectedAlgorithms?: SerializedUserSelectedAlgorithms;
  geminiResults?: SerializedGeminiResults;
  cueSheet?: CueSheetResult | null;
}

/**
 * Generate unique ID for formations
 */
export function generateFormationId(): string {
  return `formation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique ID for projects
 */
export function generateProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default empty formation with dancers in exit zones
 */
export function createEmptyFormation(
  startCount: number,
  dancerCount: number,
  stageWidth: number,
  stageHeight: number
): FormationKeyframe {
  const positions: DancerPosition[] = [];
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
    '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
  ];

  // Place dancers in exit zones (left side first, top to bottom, then right side)
  const EXIT_ZONE_CENTER = 0.75; // Center of 1.5m exit zone
  const SLOT_SPACING = 1.0; // 1m spacing between slots
  const slotsPerSide = Math.floor(stageHeight / SLOT_SPACING);

  for (let i = 0; i < dancerCount; i++) {
    let x: number;
    let y: number;

    if (i < slotsPerSide) {
      // Left side (top to bottom)
      x = EXIT_ZONE_CENTER;
      y = stageHeight - SLOT_SPACING * (i + 0.5);
    } else {
      // Right side (top to bottom)
      x = stageWidth - EXIT_ZONE_CENTER;
      y = stageHeight - SLOT_SPACING * ((i - slotsPerSide) + 0.5);
    }

    positions.push({
      dancerId: i + 1,
      position: { x, y: Math.max(0.5, Math.min(stageHeight - 0.5, y)) },
      color: colors[i % colors.length],
    });
  }

  return {
    id: generateFormationId(),
    startCount,
    duration: 8,
    positions,
    transitionType: 'linear',
  };
}

/**
 * Create new choreography project
 */
export function createNewProject(
  name: string,
  dancerCount: number,
  stageWidth: number = 800,
  stageHeight: number = 600
): ChoreographyProject {
  const now = new Date().toISOString();
  return {
    id: generateProjectId(),
    name,
    createdAt: now,
    updatedAt: now,
    dancerCount,
    stageWidth,
    stageHeight,
    formations: [createEmptyFormation(0, dancerCount, stageWidth, stageHeight)],
  };
}
