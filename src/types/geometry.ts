/**
 * Geometry Types
 * Basic geometric types used throughout the application
 */

export interface Position {
  x: number;
  y: number;
}

export interface PathPoint extends Position {
  t: number; // time
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
