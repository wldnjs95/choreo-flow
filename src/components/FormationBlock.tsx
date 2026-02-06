/**
 * FormationBlock Component
 * Represents a single formation in the timeline
 */

import React, { useState, useRef } from 'react';
import type { FormationKeyframe } from '../types/timeline';

interface FormationBlockProps {
  formation: FormationKeyframe;
  formationIndex: number; // 0-based index for default naming
  isSelected: boolean;
  zoom: number;
  stageWidth: number;
  stageHeight: number;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateDuration: (duration: number) => void;
  onUpdateLabel: (label: string) => void;
}

export const FormationBlock: React.FC<FormationBlockProps> = ({
  formation,
  formationIndex,
  isSelected,
  zoom,
  stageWidth,
  stageHeight,
  onSelect,
  onDelete,
  onUpdateDuration,
  onUpdateLabel,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(formation.label || '');
  const [isResizing, setIsResizing] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const width = formation.duration * zoom;
  const left = formation.startCount * zoom;

  // Handle double-click to edit label
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditLabel(formation.label || '');
  };

  // Handle label save
  const handleLabelSave = () => {
    setIsEditing(false);
    onUpdateLabel(editLabel);
  };

  // Handle resize start
  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = formation.duration;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startXRef.current;
      const deltaCounts = Math.round(deltaX / zoom / 4) * 4; // Snap to 4-count
      const newDuration = Math.max(4, startWidthRef.current + deltaCounts);
      onUpdateDuration(newDuration);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Mini preview of dancer positions
  const renderMiniPreview = () => {
    const previewWidth = 50;
    const previewHeight = 40;
    const scaleX = previewWidth / stageWidth;
    const scaleY = previewHeight / stageHeight;
    const dotSize = 4;

    return (
      <svg className="formation-mini-preview" width={previewWidth} height={previewHeight}>
        <rect
          x={0}
          y={0}
          width={previewWidth}
          height={previewHeight}
          fill="rgba(0,0,0,0.3)"
          rx={2}
        />
        {formation.positions.map((dancer) => (
          <circle
            key={dancer.dancerId}
            cx={dancer.position.x * scaleX}
            cy={(stageHeight - dancer.position.y) * scaleY}
            r={dotSize / 2}
            fill={dancer.color}
          />
        ))}
      </svg>
    );
  };

  return (
    <div
      ref={blockRef}
      className={`formation-block ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{ left, width }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Block content */}
      <div className="formation-block-content">
        {/* Label */}
        {isEditing ? (
          <input
            type="text"
            className="formation-label-input"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={handleLabelSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelSave();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="formation-label">
            {formation.label || String(formationIndex + 1)}
          </span>
        )}

        {/* Count info */}
        <span className="formation-count-info">
          {formation.startCount}-{formation.startCount + formation.duration}
        </span>

        {/* Mini preview - show if block is wide enough */}
        {width >= 50 && renderMiniPreview()}
      </div>

      {/* Delete button (visible when selected) */}
      {isSelected && (
        <button
          className="formation-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete Formation"
        >
          ×
        </button>
      )}

      {/* Resize handle */}
      <div
        className="formation-resize-handle"
        onMouseDown={handleResizeStart}
      />

      {/* Transition type indicator */}
      <div className={`transition-indicator ${formation.transitionType}`} title={`Transition: ${formation.transitionType}`} />
    </div>
  );
};
