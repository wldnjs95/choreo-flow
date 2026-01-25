/**
 * Formation Generator
 *
 * Generate coordinates for various formation types
 */

import type { Position } from './hungarian';

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

// Default stage size
const DEFAULT_STAGE_WIDTH = 12;
const DEFAULT_STAGE_HEIGHT = 10;

/**
 * Generate formation coordinates
 */
export function generateFormation(
  type: FormationType,
  dancerCount: number = 8,
  params: FormationParams = {}
): Position[] {
  const spread = params.spread ?? 1.0;
  const stageWidth = params.stageWidth ?? DEFAULT_STAGE_WIDTH;
  const stageHeight = params.stageHeight ?? DEFAULT_STAGE_HEIGHT;

  // Parameters including dynamic stage size
  const fullParams = { ...params, stageWidth, stageHeight };

  switch (type) {
    case 'line':
      return generateLine(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'circle':
      return generateCircle(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'v_shape':
      return generateVShape(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'diagonal':
      return generateDiagonal(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'scatter':
      return generateScatter(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'heart':
      return generateHeart(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'diamond':
      return generateDiamond(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'triangle':
      return generateTriangle(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'two_lines':
      return generateTwoLines(dancerCount, fullParams, spread, stageWidth, stageHeight);
    default:
      return generateLine(dancerCount, fullParams, spread, stageWidth, stageHeight);
  }
}

/**
 * Line formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateLine(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const direction = params.direction ?? 'horizontal';
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? 1;  // Default y = 1 (bottom of stage)
  const minSpacing = 0.8; // Minimum spacing between dancers

  // Calculate usage ratio relative to stage size (spread 1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
  const usageRatio = Math.min(spread * 0.6, 1.0); // Max 100%
  const maxAvailable = direction === 'horizontal' ? stageWidth - 1 : stageHeight - 1;
  const targetWidth = maxAvailable * usageRatio;

  // Ensure minimum spacing
  const minWidth = (count - 1) * minSpacing;
  const width = Math.max(targetWidth, minWidth);

  const positions: Position[] = [];
  const step = count > 1 ? width / (count - 1) : 0;
  const startX = centerX - width / 2;
  const startY = centerY;

  for (let i = 0; i < count; i++) {
    if (direction === 'horizontal') {
      positions.push({
        x: clamp(startX + i * step, 0.5, stageWidth - 0.5),
        y: clamp(startY, 0.5, stageHeight - 0.5),
      });
    } else {
      positions.push({
        x: clamp(centerX, 0.5, stageWidth - 0.5),
        y: clamp(startY + i * step, 0.5, stageHeight - 0.5),
      });
    }
  }

  return positions;
}

/**
 * Circle formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateCircle(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;
  const minSpacing = 0.9; // Minimum spacing between dancers

  // Minimum radius needed on circumference: circumference = 2πr >= count * minSpacing
  const minRadius = (count * minSpacing) / (2 * Math.PI);
  // Maximum radius within stage bounds
  const maxAvailableRadius = Math.min(
    centerX - 0.5,
    stageWidth - centerX - 0.5,
    centerY - 0.5,
    stageHeight - centerY - 0.5
  );

  // Calculate usage ratio relative to stage size
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const targetRadius = maxAvailableRadius * usageRatio;
  const radius = Math.max(targetRadius, minRadius);

  const positions: Position[] = [];
  const angleStep = (2 * Math.PI) / count;

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + i * angleStep;  // Start from 12 o'clock
    positions.push({
      x: clamp(centerX + radius * Math.cos(angle), 0.5, stageWidth - 0.5),
      y: clamp(centerY + radius * Math.sin(angle), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * V-shape formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateVShape(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const minSpacing = 1.0; // Minimum spacing between dancers (collision prevention)

  // Number of dancers on each line
  const half = Math.floor(count / 2);
  const hasApex = count % 2 === 1;

  // Minimum required size
  const minLineLength = half > 0 ? (half) * minSpacing * 1.2 : minSpacing;

  // Calculate usage ratio relative to stage size
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxAvailableWidth = stageWidth - 1;
  const maxAvailableHeight = stageHeight - 2;

  const targetWidth = maxAvailableWidth * usageRatio;
  const targetHeight = maxAvailableHeight * usageRatio;

  const width = Math.max(targetWidth, minLineLength);
  const height = Math.max(targetHeight * 0.8, minLineLength * 0.8);

  // V apex position (toward top of stage)
  const apexY = Math.min(stageHeight - 1, 1 + height);
  const centerY = params.centerY ?? apexY;

  const positions: Position[] = [];

  // Apex dancer (when odd count)
  if (hasApex) {
    positions.push({
      x: centerX,
      y: centerY,
    });
  }

  // Generate left and right lines simultaneously
  for (let i = 0; i < half; i++) {
    // Spread outward from apex
    const ratio = (i + 1) / (half + (hasApex ? 0 : 1));

    const leftX = centerX - (width / 2) * ratio;
    const rightX = centerX + (width / 2) * ratio;
    const y = centerY - height * ratio;

    // Left
    positions.push({
      x: clamp(leftX, 0.5, stageWidth - 0.5),
      y: clamp(y, 0.5, stageHeight - 0.5),
    });

    // Right
    positions.push({
      x: clamp(rightX, 0.5, stageWidth - 0.5),
      y: clamp(y, 0.5, stageHeight - 0.5),
    });
  }

  // Sort by X coordinate (visual consistency)
  return sortByX(positions);
}

/**
 * Diagonal formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateDiagonal(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const width = (stageWidth - 2) * usageRatio;
  const height = (stageHeight - 2) * usageRatio;
  const angle = params.angle ?? 45;

  const positions: Position[] = [];
  const radians = (angle * Math.PI) / 180;

  for (let i = 0; i < count; i++) {
    const ratio = count > 1 ? i / (count - 1) : 0;
    positions.push({
      x: clamp(1 + width * ratio * Math.cos(radians), 0.5, stageWidth - 0.5),
      y: clamp(1 + height * ratio * Math.sin(radians), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * Scatter formation (random but evenly distributed)
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateScatter(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxRadius = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const radius = maxRadius * usageRatio;

  // Even distribution using golden angle
  const positions: Position[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const theta = i * goldenAngle;
    positions.push({
      x: clamp(centerX + r * Math.cos(theta), 0.5, stageWidth - 0.5),
      y: clamp(centerY + r * Math.sin(theta), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * Heart formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateHeart(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxSize = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const size = maxSize * usageRatio;

  const positions: Position[] = [];

  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI;
    // Heart equation
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);

    positions.push({
      x: clamp(centerX + (x / 16) * size, 0.5, stageWidth - 0.5),
      y: clamp(centerY + (y / 16) * size, 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * Diamond formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateDiamond(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const width = (stageWidth - 1) * usageRatio;
  const height = (stageHeight - 1) * usageRatio;

  const positions: Position[] = [];

  // Place dancers at 4 vertices
  const vertices = [
    { x: centerX, y: centerY + height / 2 },        // Top
    { x: centerX + width / 2, y: centerY },          // Right
    { x: centerX, y: centerY - height / 2 },         // Bottom
    { x: centerX - width / 2, y: centerY },          // Left
  ];

  if (count <= 4) {
    return vertices.slice(0, count).map(v => ({
      x: clamp(v.x, 0.5, stageWidth - 0.5),
      y: clamp(v.y, 0.5, stageHeight - 0.5),
    }));
  }

  // Place dancers at vertices + on edges
  const perSide = Math.floor((count - 4) / 4);
  const remainder = (count - 4) % 4;

  for (let side = 0; side < 4; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0.5, stageWidth - 0.5),
      y: clamp(vertices[side].y, 0.5, stageHeight - 0.5),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 4;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0.5, stageWidth - 0.5
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0.5, stageHeight - 0.5
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * Triangle formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateTriangle(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxSize = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const size = maxSize * usageRatio;

  const positions: Position[] = [];

  // Triangle vertices
  const vertices = [
    { x: centerX, y: centerY + size },                                    // Top
    { x: centerX - size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // Bottom left
    { x: centerX + size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // Bottom right
  ];

  if (count <= 3) {
    return vertices.slice(0, count).map(v => ({
      x: clamp(v.x, 0.5, stageWidth - 0.5),
      y: clamp(v.y, 0.5, stageHeight - 0.5),
    }));
  }

  // Distribute dancers on edges
  const perSide = Math.floor((count - 3) / 3);
  const remainder = (count - 3) % 3;

  for (let side = 0; side < 3; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0.5, stageWidth - 0.5),
      y: clamp(vertices[side].y, 0.5, stageHeight - 0.5),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 3;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0.5, stageWidth - 0.5
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0.5, stageHeight - 0.5
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * Two lines formation
 * spread: stage usage ratio (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateTwoLines(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;
  const minSpacing = 0.8; // Minimum spacing between dancers

  const perLine = Math.ceil(count / 2);
  const backCount = count - perLine;

  // Calculate usage ratio relative to stage size
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxAvailableWidth = stageWidth - 1;
  const maxAvailableHeight = stageHeight - 2;

  const minWidth = (Math.max(perLine, backCount) - 1) * minSpacing;
  const targetWidth = maxAvailableWidth * usageRatio;
  const width = Math.max(targetWidth, minWidth);
  const gap = Math.max(maxAvailableHeight * usageRatio * 0.5, 1.5);

  const positions: Position[] = [];

  // Front row
  for (let i = 0; i < perLine && positions.length < count; i++) {
    const step = perLine > 1 ? width / (perLine - 1) : 0;
    const x = perLine > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, stageWidth - 0.5),
      y: clamp(centerY + gap / 2, 0.5, stageHeight - 0.5),
    });
  }

  // Back row
  for (let i = 0; i < backCount; i++) {
    const step = backCount > 1 ? width / (backCount - 1) : 0;
    const x = backCount > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, stageWidth - 0.5),
      y: clamp(centerY - gap / 2, 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * Clamp value to range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sort by X coordinate
 */
function sortByX(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => a.x - b.x);
}

/**
 * Apply spread to formation
 */
export function applySpread(positions: Position[], spread: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

  return positions.map(p => ({
    x: clamp(centerX + (p.x - centerX) * spread, 0.5, stageWidth - 0.5),
    y: clamp(centerY + (p.y - centerY) * spread, 0.5, stageHeight - 0.5),
  }));
}

/**
 * Translate formation
 */
export function translateFormation(positions: Position[], dx: number, dy: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  return positions.map(p => ({
    x: clamp(p.x + dx, 0.5, stageWidth - 0.5),
    y: clamp(p.y + dy, 0.5, stageHeight - 0.5),
  }));
}

/**
 * Rotate formation around center
 */
export function rotateFormation(positions: Position[], angleDegrees: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const radians = (angleDegrees * Math.PI) / 180;

  return positions.map(p => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return {
      x: clamp(centerX + dx * Math.cos(radians) - dy * Math.sin(radians), 0.5, stageWidth - 0.5),
      y: clamp(centerY + dx * Math.sin(radians) + dy * Math.cos(radians), 0.5, stageHeight - 0.5),
    };
  });
}
