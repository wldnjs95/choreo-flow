/**
 * Stage Component
 * Reusable SVG stage for visualizing formations and choreography
 */

import React, { useMemo } from 'react';
import {
  PADDING,
  GRID_COLOR,
  BACKGROUND_COLOR,
} from '../constants/visualization';

export interface StageProps {
  children: React.ReactNode;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  showGrid?: boolean;
  showLabels?: boolean;
  showCenterLine?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

/**
 * Reusable Stage component for choreography visualization
 */
export function Stage({
  children,
  stageWidth,
  stageHeight,
  scale,
  showGrid = true,
  showLabels = true,
  showCenterLine = true,
  style,
  className,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  svgRef,
}: StageProps) {
  const width = stageWidth * scale + PADDING * 2;
  const height = stageHeight * scale + PADDING * 2;

  // Grid lines
  const gridLines = useMemo(() => {
    if (!showGrid) return null;

    const lines = [];
    for (let x = 0; x <= stageWidth; x++) {
      lines.push(
        <line
          key={`v-${x}`}
          x1={PADDING + x * scale}
          y1={PADDING}
          x2={PADDING + x * scale}
          y2={PADDING + stageHeight * scale}
          stroke={GRID_COLOR}
          strokeWidth={x % 5 === 0 ? 2 : 1}
        />
      );
    }
    for (let y = 0; y <= stageHeight; y++) {
      lines.push(
        <line
          key={`h-${y}`}
          x1={PADDING}
          y1={PADDING + y * scale}
          x2={PADDING + stageWidth * scale}
          y2={PADDING + y * scale}
          stroke={GRID_COLOR}
          strokeWidth={y % 5 === 0 ? 2 : 1}
        />
      );
    }
    return lines;
  }, [stageWidth, stageHeight, scale, showGrid]);

  // Axis labels
  const labels = useMemo(() => {
    if (!showLabels) return null;

    const result = [];
    // X-axis labels (2m intervals)
    for (let x = 0; x <= stageWidth; x += 2) {
      result.push(
        <text
          key={`lx-${x}`}
          x={PADDING + x * scale}
          y={height - 10}
          textAnchor="middle"
          fill="#666"
          fontSize="11"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {x}m
        </text>
      );
    }
    // Y-axis labels (2m intervals)
    for (let y = 0; y <= stageHeight; y += 2) {
      result.push(
        <text
          key={`ly-${y}`}
          x={10}
          y={PADDING + (stageHeight - y) * scale + 4}
          textAnchor="start"
          fill="#666"
          fontSize="11"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {y}m
        </text>
      );
    }
    return result;
  }, [stageWidth, stageHeight, scale, height, showLabels]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        background: BACKGROUND_COLOR,
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        ...style,
      }}
      className={className}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {/* Stage background */}
      <rect
        x={PADDING}
        y={PADDING}
        width={stageWidth * scale}
        height={stageHeight * scale}
        fill="rgba(40, 40, 60, 0.5)"
        stroke="#444"
        strokeWidth={2}
        rx={4}
      />

      {/* Grid */}
      {gridLines}
      {labels}

      {/* Center line */}
      {showCenterLine && (
        <line
          x1={PADDING + (stageWidth / 2) * scale}
          y1={PADDING}
          x2={PADDING + (stageWidth / 2) * scale}
          y2={PADDING + stageHeight * scale}
          stroke="#444"
          strokeWidth={2}
          strokeDasharray="10,5"
        />
      )}

      {children}
    </svg>
  );
}

/**
 * Convert stage coordinates to screen coordinates
 */
export function stageToScreen(
  position: { x: number; y: number },
  scale: number,
  stageHeight: number
): { x: number; y: number } {
  return {
    x: PADDING + position.x * scale,
    y: PADDING + (stageHeight - position.y) * scale,
  };
}

/**
 * Convert screen coordinates to stage coordinates
 */
export function screenToStage(
  clientX: number,
  clientY: number,
  svgRect: DOMRect,
  scale: number,
  stageHeight: number
): { x: number; y: number } {
  return {
    x: (clientX - svgRect.left - PADDING) / scale,
    y: stageHeight - (clientY - svgRect.top - PADDING) / scale,
  };
}

export default Stage;
