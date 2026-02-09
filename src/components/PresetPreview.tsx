/**
 * PresetPreview Component
 * Renders a small SVG preview of a formation preset
 */

import React, { useState } from 'react';
import type { FormationPreset } from '../constants/editor';

// Dancer colors palette
const DANCER_COLORS = [
  '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
  '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
  '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
  '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1',
  '#7B68EE', '#00CED1', '#D63384',
];

interface PresetPreviewProps {
  preset: FormationPreset;
  isSelected?: boolean;
  onClick: () => void;
  audienceAtTop?: boolean;
}

export const PresetPreview: React.FC<PresetPreviewProps> = ({
  preset,
  isSelected,
  onClick,
  audienceAtTop = true,
}) => {
  const previewSize = 60;
  const previewPadding = 6;
  const dotRadius = 2;

  const stageW = preset.stageWidth;
  const stageH = preset.stageHeight;

  const availableWidth = previewSize - previewPadding * 2;
  const availableHeight = previewSize - previewPadding * 2;
  const scale = Math.min(availableWidth / stageW, availableHeight / stageH);

  const offsetX = previewPadding + (availableWidth - stageW * scale) / 2;
  const offsetY = previewPadding + (availableHeight - stageH * scale) / 2;

  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(preset));
    e.dataTransfer.effectAllowed = 'copy';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      className={`preset-preview-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
      title={`${preset.name} (${preset.dancerCount} dancers) - Drag to timeline`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <svg width={previewSize} height={previewSize} className="preset-preview-svg">
        <rect
          x={1}
          y={1}
          width={previewSize - 2}
          height={previewSize - 2}
          fill="rgba(40, 40, 60, 0.8)"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          rx={4}
        />
        <rect
          x={offsetX}
          y={offsetY}
          width={stageW * scale}
          height={stageH * scale}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={0.5}
        />
        {preset.positions.map((pos, i) => (
          <circle
            key={i}
            cx={offsetX + pos.x * scale}
            cy={audienceAtTop
              ? offsetY + (stageH - pos.y) * scale
              : offsetY + pos.y * scale
            }
            r={dotRadius}
            fill={DANCER_COLORS[i % DANCER_COLORS.length]}
          />
        ))}
      </svg>
      <span className="preset-preview-label">{preset.name}</span>
      <span className="preset-preview-count">{preset.dancerCount}P</span>
    </div>
  );
};

export { DANCER_COLORS };
