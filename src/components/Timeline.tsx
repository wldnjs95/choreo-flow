/**
 * Timeline Component
 * Displays formations in a horizontal timeline with 8-count grid
 */

import React, { useRef, useEffect } from 'react';
import type { FormationKeyframe, ChoreographyProject } from '../types/timeline';
import { FormationBlock } from './FormationBlock';

interface TimelineProps {
  project: ChoreographyProject;
  selectedFormationId: string | null;
  currentCount: number;
  zoom: number; // pixels per count
  onSelectFormation: (id: string) => void;
  onUpdateFormation: (id: string, updates: Partial<FormationKeyframe>) => void;
  onDeleteFormation: (id: string) => void;
  onAddFormation: (afterId: string | null) => void;
  onSeek?: (count: number) => void; // Seek to specific count
  onDropPreset?: (presetJson: string, atCount: number) => void; // Drop preset to add formation
}

const GRID_HEIGHT = 60;
const RULER_HEIGHT = 24;
const MIN_ZOOM = 4;
const MAX_ZOOM = 20;

export const Timeline: React.FC<TimelineProps> = ({
  project,
  selectedFormationId,
  currentCount,
  zoom,
  onSelectFormation,
  onUpdateFormation,
  onDeleteFormation,
  onAddFormation,
  onSeek,
  onDropPreset,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);

  // Calculate total counts (last formation end or minimum 64 counts)
  const lastFormation = project.formations[project.formations.length - 1];
  const totalCounts = lastFormation
    ? Math.max(lastFormation.startCount + lastFormation.duration + 16, 64)
    : 64;

  // Generate ruler marks (every 8 counts)
  const rulerMarks: number[] = [];
  for (let i = 0; i <= totalCounts; i += 8) {
    rulerMarks.push(i);
  }

  // Handle click on empty area to add new formation
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (e.target === timelineRef.current) {
      // Calculate which count was clicked
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickedCount = Math.floor(clickX / zoom / 8) * 8;

      // Check if there's no formation at this position
      const existingFormation = project.formations.find(
        f => clickedCount >= f.startCount && clickedCount < f.startCount + f.duration
      );

      if (!existingFormation) {
        // Find the formation before this position
        const formationsBefore = project.formations.filter(f => f.startCount + f.duration <= clickedCount);
        const lastBefore = formationsBefore.length > 0
          ? formationsBefore[formationsBefore.length - 1]
          : null;
        onAddFormation(lastBefore?.id || null);
      }
    }
  };

  // Playhead drag handlers
  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  };

  const handlePlayheadMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isDraggingPlayhead || !timelineRef.current || !onSeek) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const count = Math.max(0, Math.min(totalCounts, x / zoom));
    onSeek(count);
  }, [isDraggingPlayhead, zoom, totalCounts, onSeek]);

  const handlePlayheadMouseUp = React.useCallback(() => {
    setIsDraggingPlayhead(false);
  }, []);

  // Global mouse events for playhead drag
  React.useEffect(() => {
    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handlePlayheadMouseMove);
      window.addEventListener('mouseup', handlePlayheadMouseUp);
      return () => {
        window.removeEventListener('mousemove', handlePlayheadMouseMove);
        window.removeEventListener('mouseup', handlePlayheadMouseUp);
      };
    }
  }, [isDraggingPlayhead, handlePlayheadMouseMove, handlePlayheadMouseUp]);

  // Scroll to current count when playing
  useEffect(() => {
    if (containerRef.current) {
      const currentX = currentCount * zoom;
      const containerWidth = containerRef.current.clientWidth;
      const scrollLeft = containerRef.current.scrollLeft;

      if (currentX < scrollLeft || currentX > scrollLeft + containerWidth - 100) {
        containerRef.current.scrollLeft = Math.max(0, currentX - 100);
      }
    }
  }, [currentCount, zoom]);

  // Handle ruler click to seek
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedCount = Math.max(0, Math.min(totalCounts, clickX / zoom));
    onSeek(clickedCount);
  };

  // Drag and drop handlers for preset
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!onDropPreset || !timelineRef.current) return;

    const presetJson = e.dataTransfer.getData('application/json');
    if (!presetJson) return;

    // Calculate drop position (count)
    const rect = timelineRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropCount = Math.max(0, dropX / zoom);

    onDropPreset(presetJson, dropCount);
  };

  return (
    <div className="timeline-container" ref={containerRef}>
      {/* Ruler */}
      <div
        className="timeline-ruler"
        style={{ width: totalCounts * zoom, cursor: onSeek ? 'pointer' : 'default' }}
        onClick={handleRulerClick}
      >
        {rulerMarks.map(count => (
          <div
            key={count}
            className="ruler-mark"
            style={{ left: count * zoom }}
          >
            <span className="ruler-label">{count}</span>
            <div className="ruler-tick" />
          </div>
        ))}
      </div>

      {/* Timeline track */}
      <div
        ref={timelineRef}
        className={`timeline-track ${isDragOver ? 'drag-over' : ''}`}
        style={{ width: totalCounts * zoom, height: GRID_HEIGHT }}
        onClick={handleTimelineClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 8-count grid lines */}
        {rulerMarks.map(count => (
          <div
            key={count}
            className={`grid-line ${count % 32 === 0 ? 'major' : ''}`}
            style={{ left: count * zoom }}
          />
        ))}

        {/* Playhead */}
        <div
          className={`playhead ${isDraggingPlayhead ? 'dragging' : ''}`}
          style={{ left: currentCount * zoom, cursor: onSeek ? 'ew-resize' : 'default' }}
          onMouseDown={onSeek ? handlePlayheadMouseDown : undefined}
        >
          <div className="playhead-head" />
          <div className="playhead-line" />
        </div>

        {/* Formation blocks */}
        {project.formations.map(formation => (
          <FormationBlock
            key={formation.id}
            formation={formation}
            isSelected={formation.id === selectedFormationId}
            zoom={zoom}
            onSelect={() => onSelectFormation(formation.id)}
            onDelete={() => onDeleteFormation(formation.id)}
            onUpdateDuration={(duration) => onUpdateFormation(formation.id, { duration })}
            onUpdateLabel={(label) => onUpdateFormation(formation.id, { label })}
          />
        ))}

        {/* Add button at the end */}
        <button
          className="add-formation-btn"
          style={{
            left: lastFormation
              ? (lastFormation.startCount + lastFormation.duration) * zoom + 8
              : 8
          }}
          onClick={(e) => {
            e.stopPropagation();
            onAddFormation(lastFormation?.id || null);
          }}
          title="Add Formation"
        >
          +
        </button>
      </div>
    </div>
  );
};

export { GRID_HEIGHT, RULER_HEIGHT, MIN_ZOOM, MAX_ZOOM };
