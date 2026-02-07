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

// Dancer colors palette - 35 unique colors
// Ordered for maximum distinction: first 8 colors span the full spectrum
export const DANCER_COLORS = [
  // Primary (1-8): maximally distinct across spectrum
  '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
  // Secondary (9-16): filling gaps between primaries
  '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
  // Tertiary (17-24): more variety
  '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
  // Extended (25-35): complete palette
  '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1', '#7B68EE', '#00CED1', '#D63384',
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
