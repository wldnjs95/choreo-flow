/**
 * Visualization Constants
 * Shared constants for stage rendering and dancer visualization
 */

// Stage dimensions
export const DEFAULT_STAGE_WIDTH = 15;  // Large: 49ft ≈ 15m
export const DEFAULT_STAGE_HEIGHT = 12; // Large: 39ft ≈ 12m

// Visualization scale
export const BASE_SCALE = 50;
export const PADDING = 40;
export const BASE_DANCER_RADIUS = 0.4; // Dancer radius in meters

// Colors
export const GRID_COLOR = '#2a2a3e';
export const BACKGROUND_COLOR = '#1a1a2e';

// Dancer colors palette
export const DANCER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFD93D', '#6C5CE7', '#A8E6CF', '#FF8C42',
  '#E056FD', '#686DE0', '#BADC58', '#F9CA24',
  '#30336B', '#22A6B3', '#BE2EDD', '#F79F1F',
] as const;

// Stage presets
export const STAGE_PRESETS = {
  'small': { width: 8, height: 6, label: 'Small (26×20ft)' },
  'medium': { width: 10, height: 8, label: 'Medium (33×26ft)' },
  'large': { width: 15, height: 12, label: 'Large (49×39ft)' },
  'custom': { width: 15, height: 12, label: 'Custom' },
} as const;

export type StagePresetKey = keyof typeof STAGE_PRESETS;

// Helper function to get dancer color by index
export function getDancerColor(index: number): string {
  return DANCER_COLORS[index % DANCER_COLORS.length];
}

// Calculate scale based on stage size
export function calculateScale(
  stageWidth: number,
  stageHeight: number,
  maxWidth: number = 800,
  maxHeight: number = 600
): number {
  const scaleX = (maxWidth - PADDING * 2) / stageWidth;
  const scaleY = (maxHeight - PADDING * 2) / stageHeight;
  return Math.min(scaleX, scaleY, BASE_SCALE);
}
