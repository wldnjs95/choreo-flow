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
  onDuplicate?: () => void;
  onUpdateDuration: (duration: number) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateHoldCounts?: (holdCounts: number) => void;
  onDragStart?: (formationId: string) => void;
  onDragEnd?: () => void;
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
  onDuplicate,
  onUpdateDuration,
  onUpdateLabel,
  onUpdateHoldCounts,
  onDragStart,
  onDragEnd,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(formation.label || '');
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Handle drag start for reordering
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    // Use a different MIME type to distinguish from preset drops
    e.dataTransfer.setData('application/x-formation-id', formation.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(formation.id);
  };

  // Handle drag end
  const handleDragEnd = () => {
    setIsDragging(false);
    onDragEnd?.();
  };

  const width = formation.duration * zoom;
  const left = formation.startCount * zoom;
  const holdCounts = formation.holdCounts || 0;
  const holdWidth = holdCounts * zoom;

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
      const deltaCounts = Math.round(deltaX / zoom); // Snap to 1-count
      const newDuration = Math.max(1, Math.min(8, startWidthRef.current + deltaCounts));
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
      className={`formation-block ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ left, width }}
      draggable={!isEditing && !isResizing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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

      {/* Action buttons (visible when selected) */}
      {isSelected && (
        <div className="formation-action-buttons">
          {onDuplicate && (
            <button
              className="formation-action-btn duplicate"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              title="Duplicate Formation (Ctrl/Cmd+D)"
            >
              ⧉
            </button>
          )}
          <button
            className="formation-action-btn delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete Formation"
          >
            ×
          </button>
        </div>
      )}

      {/* Resize handle */}
      <div
        className="formation-resize-handle"
        onMouseDown={handleResizeStart}
      />

      {/* Hold time indicator */}
      {holdCounts > 0 && (
        <div
          className="hold-indicator"
          style={{ width: holdWidth }}
          title={`Hold for ${holdCounts} count${holdCounts > 1 ? 's' : ''}`}
        >
          <span className="hold-label">⏸ {holdCounts}</span>
        </div>
      )}

      {/* Hold adjustment controls (visible when selected) */}
      {isSelected && onUpdateHoldCounts && (
        <div className="hold-controls">
          <button
            className="hold-btn minus"
            onClick={(e) => {
              e.stopPropagation();
              if (holdCounts > 0) {
                onUpdateHoldCounts(holdCounts - 1);
              }
            }}
            disabled={holdCounts <= 0}
            title="Decrease hold time"
          >
            −
          </button>
          <span className="hold-value" title="Hold counts">⏸{holdCounts}</span>
          <button
            className="hold-btn plus"
            onClick={(e) => {
              e.stopPropagation();
              // Don't allow hold time to exceed duration - 1
              if (holdCounts < formation.duration - 1) {
                onUpdateHoldCounts(holdCounts + 1);
              }
            }}
            disabled={holdCounts >= formation.duration - 1}
            title="Increase hold time"
          >
            +
          </button>
        </div>
      )}

      {/* Transition type indicator */}
      <div className={`transition-indicator ${formation.transitionType}`} title={`Transition: ${formation.transitionType}`} />
    </div>
  );
};
