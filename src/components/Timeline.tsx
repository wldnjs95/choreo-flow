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
  onReorderFormation?: (formationId: string, toIndex: number) => void; // Reorder formation
}

const GRID_HEIGHT = 90; // Increased for thumbnails
const RULER_HEIGHT = 24;
const MIN_ZOOM = 4;
const MAX_ZOOM = 40; // Extended for 1-count granularity

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
  onReorderFormation,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [dropIndicatorX, setDropIndicatorX] = React.useState<number | null>(null);
  const [dragType, setDragType] = React.useState<'preset' | 'formation' | null>(null);
  const [, setDraggingFormationId] = React.useState<string | null>(null);

  // Calculate total counts (last formation end or minimum 64 counts)
  const lastFormation = project.formations[project.formations.length - 1];
  const totalCounts = lastFormation
    ? Math.max(lastFormation.startCount + lastFormation.duration + 16, 64)
    : 64;

  // Generate ruler marks - interval based on zoom level
  // At low zoom: every 8 counts, at medium: every 4, at high: every 1
  const getMarkInterval = (z: number): number => {
    if (z >= 30) return 1;  // Max zoom: every 1 count
    if (z >= 20) return 2;  // High zoom: every 2 counts
    if (z >= 12) return 4;  // Medium zoom: every 4 counts
    return 8;               // Low zoom: every 8 counts
  };

  const markInterval = getMarkInterval(zoom);
  const rulerMarks: number[] = [];
  for (let i = 0; i <= totalCounts; i += markInterval) {
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

  // Handle mousedown on timeline track - seek and start drag
  const handleTrackMouseDown = (e: React.MouseEvent) => {
    if (!onSeek || !timelineRef.current) return;

    // Only handle direct clicks on the track background
    if (e.target !== timelineRef.current) return;

    e.preventDefault();

    // Calculate clicked position and seek there
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const count = Math.max(0, Math.min(totalCounts, x / zoom));
    onSeek(count);

    // Start dragging immediately
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

  // Drag and drop handlers for preset and formation reordering
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Check if it's a formation drag or preset drag
    const formationId = e.dataTransfer.types.includes('application/x-formation-id');
    const isPreset = e.dataTransfer.types.includes('application/json');

    if (formationId) {
      e.dataTransfer.dropEffect = 'move';
      setDragType('formation');
    } else if (isPreset) {
      e.dataTransfer.dropEffect = 'copy';
      setDragType('preset');
    }

    setIsDragOver(true);

    // Calculate and show drop indicator position
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setDropIndicatorX(x);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropIndicatorX(null);
    setDragType(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDropIndicatorX(null);
    setDragType(null);

    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropCount = Math.max(0, dropX / zoom);

    // Check for formation reorder first
    const formationId = e.dataTransfer.getData('application/x-formation-id');
    if (formationId && onReorderFormation) {
      // Calculate target index based on drop position
      let targetIndex = 0;
      for (let i = 0; i < project.formations.length; i++) {
        const f = project.formations[i];
        const fMidpoint = f.startCount + f.duration / 2;
        if (dropCount > fMidpoint) {
          targetIndex = i + 1;
        }
      }
      onReorderFormation(formationId, targetIndex);
      setDraggingFormationId(null);
      return;
    }

    // Handle preset drop
    const presetJson = e.dataTransfer.getData('application/json');
    if (presetJson && onDropPreset) {
      onDropPreset(presetJson, dropCount);
    }
  };

  // Formation drag handlers
  const handleFormationDragStart = (formationId: string) => {
    setDraggingFormationId(formationId);
  };

  const handleFormationDragEnd = () => {
    setDraggingFormationId(null);
  };

  return (
    <div className="timeline-container" ref={containerRef}>
      {/* Ruler */}
      <div
        className="timeline-ruler"
        style={{ width: totalCounts * zoom, cursor: onSeek ? 'pointer' : 'default' }}
        onClick={handleRulerClick}
      >
        {rulerMarks.map(count => {
          const isMajor = count % 8 === 0;
          const isMinor = !isMajor && count % 4 === 0;
          return (
            <div
              key={count}
              className={`ruler-mark ${isMajor ? 'major' : ''} ${isMinor ? 'minor' : ''}`}
              style={{ left: count * zoom }}
            >
              <span className="ruler-label">{count}</span>
              <div className="ruler-tick" />
            </div>
          );
        })}
      </div>

      {/* Timeline track */}
      <div
        ref={timelineRef}
        className={`timeline-track ${isDragOver ? 'drag-over' : ''}`}
        style={{ width: totalCounts * zoom, height: GRID_HEIGHT, cursor: onSeek ? 'pointer' : 'default' }}
        onClick={handleTimelineClick}
        onMouseDown={handleTrackMouseDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Grid lines matching ruler marks */}
        {rulerMarks.map(count => {
          const isMajor = count % 8 === 0;
          return (
            <div
              key={count}
              className={`grid-line ${isMajor ? 'major' : ''}`}
              style={{ left: count * zoom }}
            />
          );
        })}

        {/* Playhead */}
        <div
          className={`playhead ${isDraggingPlayhead ? 'dragging' : ''}`}
          style={{ left: currentCount * zoom, cursor: onSeek ? 'ew-resize' : 'default' }}
          onMouseDown={onSeek ? handlePlayheadMouseDown : undefined}
        >
          <div className="playhead-head" />
          <div className="playhead-line" />
        </div>

        {/* Drop position indicator */}
        {isDragOver && dropIndicatorX !== null && (
          <div
            className={`drop-indicator ${dragType === 'formation' ? 'move' : 'copy'}`}
            style={{ left: dropIndicatorX }}
          >
            <div className="drop-indicator-line" />
            <div className="drop-indicator-label">
              {Math.round(dropIndicatorX / zoom)}
            </div>
          </div>
        )}

        {/* Formation blocks */}
        {project.formations.map((formation, index) => (
          <FormationBlock
            key={formation.id}
            formation={formation}
            formationIndex={index}
            isSelected={formation.id === selectedFormationId}
            zoom={zoom}
            stageWidth={project.stageWidth}
            stageHeight={project.stageHeight}
            onSelect={() => onSelectFormation(formation.id)}
            onDelete={() => onDeleteFormation(formation.id)}
            onUpdateDuration={(duration) => onUpdateFormation(formation.id, { duration })}
            onUpdateLabel={(label) => onUpdateFormation(formation.id, { label })}
            onDragStart={handleFormationDragStart}
            onDragEnd={handleFormationDragEnd}
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
