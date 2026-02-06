/**
 * FormationBlock Component
 * Represents a single formation in the timeline
 */

import React, { useState, useRef } from 'react';
import type { FormationKeyframe } from '../types/timeline';

interface FormationBlockProps {
  formation: FormationKeyframe;
  isSelected: boolean;
  zoom: number;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateDuration: (duration: number) => void;
  onUpdateLabel: (label: string) => void;
}

export const FormationBlock: React.FC<FormationBlockProps> = ({
  formation,
  isSelected,
  zoom,
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
    const previewSize = 40;
    const scale = previewSize / 800; // Assuming 800px stage width

    return (
      <div className="formation-mini-preview">
        {formation.positions.slice(0, 8).map((dancer) => (
          <div
            key={dancer.dancerId}
            className="mini-dancer"
            style={{
              left: dancer.position.x * scale,
              top: dancer.position.y * scale,
              backgroundColor: dancer.color,
            }}
          />
        ))}
        {formation.positions.length > 8 && (
          <span className="more-dancers">+{formation.positions.length - 8}</span>
        )}
      </div>
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
            {formation.label || `Formation ${formation.startCount / 8 + 1}`}
          </span>
        )}

        {/* Count info */}
        <span className="formation-count-info">
          {formation.startCount}-{formation.startCount + formation.duration}
        </span>

        {/* Mini preview */}
        {width > 60 && renderMiniPreview()}
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
