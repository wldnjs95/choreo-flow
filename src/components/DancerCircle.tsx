/**
 * DancerCircle Component
 * Reusable dancer visualization component for stage rendering
 */

import React from 'react';
import { getDancerColor, PADDING } from '../constants/visualization';

export interface DancerCircleProps {
  id: number;
  x: number;           // Screen X coordinate
  y: number;           // Screen Y coordinate
  radius: number;      // Circle radius in pixels
  color?: string;      // Override default color
  name?: string;       // Optional dancer name to display
  isSelected?: boolean;
  isSwapTarget?: boolean;    // Highlight as swap target
  isPovHighlight?: boolean;  // POV: Highlight this dancer as the user's perspective
  isDimmed?: boolean;        // POV: Dim other dancers when POV is active
  showLabel?: boolean;
  labelSize?: number;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/**
 * Individual dancer circle component
 */
export function DancerCircle({
  id,
  x,
  y,
  radius,
  color,
  name,
  isSelected = false,
  isSwapTarget = false,
  isPovHighlight = false,
  isDimmed = false,
  showLabel = true,
  labelSize,
  onClick,
  onMouseDown,
  onDoubleClick,
  style,
}: DancerCircleProps) {
  const dancerColor = color || getDancerColor(id);
  const fontSize = labelSize || Math.max(12, radius * 0.9);

  // POV highlight: larger radius and glow effect
  const displayRadius = isPovHighlight ? radius * 1.3 : isSwapTarget ? radius * 1.15 : radius;
  const opacity = isDimmed ? 0.4 : 1;

  // Determine stroke style
  let strokeColor = 'rgba(255,255,255,0.3)';
  let strokeWidth = 2;
  let filterStyle = 'none';

  if (isSwapTarget) {
    strokeColor = '#f59e0b';  // Orange highlight for swap target
    strokeWidth = 4;
    filterStyle = 'drop-shadow(0 0 12px rgba(245, 158, 11, 0.8))';
  } else if (isPovHighlight) {
    strokeColor = '#FFD700';  // Gold highlight for POV
    strokeWidth = 4;
    filterStyle = 'drop-shadow(0 0 15px rgba(255, 215, 0, 0.8))';
  } else if (isSelected) {
    strokeColor = '#fff';
    strokeWidth = 3;
    filterStyle = 'drop-shadow(0 0 10px rgba(255,255,255,0.5))';
  }

  // Display text: name if available, otherwise ID
  const displayText = name || String(id);
  const displayFontSize = name && name.length > 2 ? fontSize * 0.7 : fontSize;

  return (
    <g
      style={{ cursor: onMouseDown || onClick || onDoubleClick ? 'pointer' : 'default', opacity, ...style }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <circle
        cx={x}
        cy={y}
        r={displayRadius}
        fill={dancerColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        style={{ filter: filterStyle }}
      />
      {showLabel && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={isPovHighlight ? displayFontSize * 1.2 : displayFontSize}
          fontWeight="bold"
          stroke="#000"
          strokeWidth={0.5}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {displayText}
        </text>
      )}
    </g>
  );
}

/**
 * Props for DancerCircle positioned with stage coordinates
 */
export interface StageDancerCircleProps extends Omit<DancerCircleProps, 'x' | 'y'> {
  stageX: number;      // Stage X coordinate (meters)
  stageY: number;      // Stage Y coordinate (meters)
  scale: number;       // Scale factor
  stageHeight: number; // Stage height for Y-axis flip
}

/**
 * Dancer circle component that converts stage coordinates to screen coordinates
 */
export function StageDancerCircle({
  stageX,
  stageY,
  scale,
  stageHeight,
  ...props
}: StageDancerCircleProps) {
  const x = PADDING + stageX * scale;
  const y = PADDING + (stageHeight - stageY) * scale;

  return <DancerCircle {...props} x={x} y={y} />;
}

/**
 * Selection box component for multi-select
 */
export interface SelectionBoxProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  scale: number;
  stageHeight: number;
}

export function SelectionBox({
  startX,
  startY,
  endX,
  endY,
  scale,
  stageHeight,
}: SelectionBoxProps) {
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);

  return (
    <rect
      x={PADDING + minX * scale}
      y={PADDING + (stageHeight - maxY) * scale}
      width={(maxX - minX) * scale}
      height={(maxY - minY) * scale}
      fill="rgba(78, 205, 196, 0.2)"
      stroke="#4ECDC4"
      strokeWidth={1}
      strokeDasharray="4,2"
    />
  );
}

export default DancerCircle;
