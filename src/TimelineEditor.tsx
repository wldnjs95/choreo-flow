/**
 * TimelineEditor Page
 * Main page for timeline-based choreography editing
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, screenToStage, stageToScreen } from './components/Stage';
import { DancerCircle } from './components/DancerCircle';
import { Timeline } from './components/Timeline';
import type {
  ChoreographyProject,
  FormationKeyframe,
  ChoreographyExport,
} from './types/timeline';
import {
  createNewProject,
  createEmptyFormation,
} from './types/timeline';
import {
  DEFAULT_STAGE_WIDTH,
  DEFAULT_STAGE_HEIGHT,
  calculateScale,
  PADDING,
} from './constants/visualization';
import preFormationData from '../formation_data/pre-formation.json';
import {
  computeAllPathsWithHybridByClaude,
  computeAllPathsWithHybridByClaudeCubic,
  computeAllPathsWithHybridByCursor,
  computeAllPathsWithHybridByGemini,
  computeAllPathsWithHybridByCodex,
  computeAllPathsWithHybrid,
} from './algorithms';
import { generateCueSheet, type CueSheetResult, type DancerCueSheet } from './gemini/cueSheetGenerator';

// Path algorithm options
type PathAlgorithm =
  | 'hybrid_by_claude'
  | 'hybrid_by_claude_cubic'
  | 'hybrid_by_cursor'
  | 'hybrid_by_gemini'
  | 'hybrid_by_codex'
  | 'hybrid';

const PATH_ALGORITHM_LABELS: Record<PathAlgorithm, string> = {
  'hybrid_by_claude': 'Hybrid by Claude (Quad)',
  'hybrid_by_claude_cubic': 'Hybrid by Claude (Cubic)',
  'hybrid_by_cursor': 'Hybrid by Cursor',
  'hybrid_by_gemini': 'Hybrid by Gemini',
  'hybrid_by_codex': 'Hybrid by Codex',
  'hybrid': 'Hybrid (Basic)',
};

// Generated path structure
interface GeneratedPath {
  dancerId: number;
  path: { x: number; y: number; t: number }[];
}

// Formation preset interface
interface FormationPreset {
  name: string;
  label: string;
  dancerCount: number;
  positions: { x: number; y: number }[];
}

// Organize presets by dancer count
const FORMATION_PRESETS: Map<number, FormationPreset[]> = (() => {
  const map = new Map<number, FormationPreset[]>();

  preFormationData.formations.forEach((f: { name: string; dancerCount: number; positions: { x: number; y: number }[] }) => {
    const existing = map.get(f.dancerCount) || [];
    existing.push({
      name: f.name,
      label: f.name.replace(/_/g, ' ').replace(/(\d+) /, '$1명 '),
      dancerCount: f.dancerCount,
      positions: f.positions,
    });
    map.set(f.dancerCount, existing);
  });

  return map;
})();

// Playback constants
const COUNTS_PER_SECOND = 2; // 2 counts per second (120 BPM = 8 counts per 4 beats)

// Snap to grid helper
const SNAP_SIZE = 0.5; // 0.5m grid
const snapToGrid = (value: number): number => Math.round(value / SNAP_SIZE) * SNAP_SIZE;

// Exit zone size
const EXIT_ZONE_WIDTH = 1.5; // 1.5m on each side

const TimelineEditor: React.FC = () => {
  // Project state
  const [project, setProject] = useState<ChoreographyProject>(() =>
    createNewProject('New Choreography', 8, DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT)
  );

  // View state
  const [selectedFormationId, setSelectedFormationId] = useState<string | null>(
    project.formations[0]?.id || null
  );
  const [zoom, setZoom] = useState(8); // pixels per count
  const [currentCount, setCurrentCount] = useState(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Drag state
  const [draggingDancer, setDraggingDancer] = useState<number | null>(null);
  const [selectedDancers, setSelectedDancers] = useState<Set<number>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{startX: number; startY: number; endX: number; endY: number} | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Dancer count input state
  const [dancerCountInput, setDancerCountInput] = useState(String(project.dancerCount));

  // Path state
  const [generatedPaths, setGeneratedPaths] = useState<Map<string, GeneratedPath[]>>(new Map());
  const [showPaths, setShowPaths] = useState(true);
  const [pathAlgorithm, setPathAlgorithm] = useState<PathAlgorithm>('hybrid_by_claude');
  const [isGeneratingPaths, setIsGeneratingPaths] = useState(false);
  const [pathGenerationStatus, setPathGenerationStatus] = useState<string | null>(null);

  // Cue sheet state
  const [cueSheet, setCueSheet] = useState<CueSheetResult | null>(null);
  const [isGeneratingCueSheet, setIsGeneratingCueSheet] = useState(false);
  const [showCueSheet, setShowCueSheet] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Show toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info', duration = 5000) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, []);

  // File input ref for loading
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get selected formation
  const selectedFormation = project.formations.find(f => f.id === selectedFormationId) || null;

  // Stage scale
  const scale = calculateScale(project.stageWidth, project.stageHeight);

  // Sync dancer count input with project
  useEffect(() => {
    setDancerCountInput(String(project.dancerCount));
  }, [project.dancerCount]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const lastFormation = project.formations[project.formations.length - 1];
    const maxCount = lastFormation ? lastFormation.startCount + lastFormation.duration : 0;

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      setCurrentCount(prev => {
        const next = prev + delta * COUNTS_PER_SECOND * playbackSpeed;
        if (next >= maxCount) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, project.formations]);

  // Update formation
  const updateFormation = useCallback((id: string, updates: Partial<FormationKeyframe>) => {
    setProject(prev => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      formations: prev.formations.map(f =>
        f.id === id ? { ...f, ...updates } : f
      ),
    }));
  }, []);

  // Add new formation
  const addFormation = useCallback((afterId: string | null) => {
    setProject(prev => {
      const formations = [...prev.formations];
      let insertIndex = formations.length;
      let startCount = 0;

      if (afterId) {
        const afterIndex = formations.findIndex(f => f.id === afterId);
        if (afterIndex !== -1) {
          insertIndex = afterIndex + 1;
          startCount = formations[afterIndex].startCount + formations[afterIndex].duration;
        }
      } else if (formations.length > 0) {
        const lastFormation = formations[formations.length - 1];
        startCount = lastFormation.startCount + lastFormation.duration;
      }

      // Copy positions from previous formation if available
      const prevFormation = insertIndex > 0 ? formations[insertIndex - 1] : null;
      const newFormation = prevFormation
        ? {
            ...createEmptyFormation(startCount, prev.dancerCount, prev.stageWidth, prev.stageHeight),
            positions: prevFormation.positions.map(p => ({ ...p, position: { ...p.position } })),
          }
        : createEmptyFormation(startCount, prev.dancerCount, prev.stageWidth, prev.stageHeight);

      formations.splice(insertIndex, 0, newFormation);

      // Adjust subsequent formations
      for (let i = insertIndex + 1; i < formations.length; i++) {
        formations[i] = {
          ...formations[i],
          startCount: formations[i - 1].startCount + formations[i - 1].duration,
        };
      }

      setSelectedFormationId(newFormation.id);

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations,
      };
    });
  }, []);

  // Delete formation
  const deleteFormation = useCallback((id: string) => {
    setProject(prev => {
      if (prev.formations.length <= 1) return prev; // Keep at least one formation

      const formations = prev.formations.filter(f => f.id !== id);

      // Recalculate start counts
      for (let i = 1; i < formations.length; i++) {
        formations[i] = {
          ...formations[i],
          startCount: formations[i - 1].startCount + formations[i - 1].duration,
        };
      }

      // Select previous or next formation
      if (selectedFormationId === id) {
        const index = prev.formations.findIndex(f => f.id === id);
        const newSelectedIndex = Math.max(0, index - 1);
        setSelectedFormationId(formations[newSelectedIndex]?.id || null);
      }

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations,
      };
    });
  }, [selectedFormationId]);

  // Handle stage mouse down for selection box
  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clear selection if clicking on empty space
    setSelectedDancers(new Set());
    setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
    setIsDraggingSelection(true);
  };

  // Handle dancer drag
  const handleDancerMouseDown = (dancerId: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      // Multi-select
      setSelectedDancers(prev => {
        const newSet = new Set(prev);
        if (newSet.has(dancerId)) {
          newSet.delete(dancerId);
        } else {
          newSet.add(dancerId);
        }
        return newSet;
      });
    } else {
      if (!selectedDancers.has(dancerId)) {
        setSelectedDancers(new Set([dancerId]));
      }
      setDraggingDancer(dancerId);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();

    // Selection box dragging
    if (isDraggingSelection && selectionBox) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectionBox(prev => prev ? { ...prev, endX: x, endY: y } : null);
      return;
    }

    // Dancer dragging
    if (draggingDancer === null || !selectedFormation) return;

    const stagePos = screenToStage(e.clientX, e.clientY, rect, scale, project.stageHeight);

    // Clamp to stage bounds
    const clampedX = Math.max(0, Math.min(project.stageWidth, stagePos.x));
    const clampedY = Math.max(0, Math.min(project.stageHeight, stagePos.y));

    // Calculate delta
    const currentDancer = selectedFormation.positions.find(p => p.dancerId === draggingDancer);
    if (!currentDancer) return;

    const deltaX = clampedX - currentDancer.position.x;
    const deltaY = clampedY - currentDancer.position.y;

    // Update all selected dancers
    const dancersToMove = selectedDancers.has(draggingDancer)
      ? Array.from(selectedDancers)
      : [draggingDancer];

    const newPositions = selectedFormation.positions.map(p => {
      if (dancersToMove.includes(p.dancerId)) {
        return {
          ...p,
          position: {
            x: Math.max(0, Math.min(project.stageWidth, p.position.x + deltaX)),
            y: Math.max(0, Math.min(project.stageHeight, p.position.y + deltaY)),
          },
        };
      }
      return p;
    });

    updateFormation(selectedFormation.id, { positions: newPositions });
  };

  const handleMouseUp = () => {
    // Selection box complete
    if (isDraggingSelection && selectionBox && selectedFormation) {
      const svg = svgRef.current;
      if (svg) {
        const minX = Math.min(selectionBox.startX, selectionBox.endX);
        const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY);
        const maxY = Math.max(selectionBox.startY, selectionBox.endY);

        // Find dancers inside selection box
        const newSelected = new Set<number>();
        selectedFormation.positions.forEach((pos) => {
          const screenPos = stageToScreen(pos.position, scale, project.stageHeight);
          if (screenPos.x >= minX && screenPos.x <= maxX && screenPos.y >= minY && screenPos.y <= maxY) {
            newSelected.add(pos.dancerId);
          }
        });

        setSelectedDancers(newSelected);
      }
      setSelectionBox(null);
      setIsDraggingSelection(false);
      return;
    }

    // Snap to grid on release
    if (draggingDancer !== null && selectedFormation) {
      const dancersToMove = selectedDancers.has(draggingDancer)
        ? Array.from(selectedDancers)
        : [draggingDancer];

      const snappedPositions = selectedFormation.positions.map(p => {
        if (dancersToMove.includes(p.dancerId)) {
          return {
            ...p,
            position: {
              x: Math.max(0, Math.min(project.stageWidth, snapToGrid(p.position.x))),
              y: Math.max(0, Math.min(project.stageHeight, snapToGrid(p.position.y))),
            },
          };
        }
        return p;
      });

      updateFormation(selectedFormation.id, { positions: snappedPositions });
    }
    setDraggingDancer(null);
  };

  // Save project to JSON
  const handleSave = () => {
    const exportData: ChoreographyExport = {
      version: '1.0',
      project,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load project from JSON
  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as ChoreographyExport;
        setProject(data.project);
        setSelectedFormationId(data.project.formations[0]?.id || null);
        setCurrentCount(0);
        setIsPlaying(false);
      } catch (err) {
        alert('Failed to load choreography file');
      }
    };
    reader.readAsText(file);

    // Reset input
    e.target.value = '';
  };

  // New project
  const handleNew = () => {
    if (project.formations.length > 1 || project.formations[0]?.label) {
      if (!confirm('Create a new project? Unsaved changes will be lost.')) return;
    }
    const newProject = createNewProject('New Choreography', project.dancerCount, project.stageWidth, project.stageHeight);
    setProject(newProject);
    setSelectedFormationId(newProject.formations[0]?.id || null);
    setCurrentCount(0);
    setIsPlaying(false);
  };

  // Change dancer count
  const handleDancerCountChange = (newCount: number) => {
    if (isNaN(newCount) || newCount < 1 || newCount > 24) return;

    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
    ];

    const EXIT_ZONE_CENTER = 0.75; // Center of 1.5m exit zone
    const SLOT_SPACING = 1.0; // 1m spacing between slots

    setProject(prev => ({
      ...prev,
      dancerCount: newCount,
      updatedAt: new Date().toISOString(),
      formations: prev.formations.map(f => {
        const existingPositions = [...f.positions];

        if (newCount > existingPositions.length) {
          // Generate all possible exit zone slots (left side top to bottom, then right side)
          const slots: { x: number; y: number }[] = [];
          const slotsPerSide = Math.floor(prev.stageHeight / SLOT_SPACING);

          // Left side slots (top to bottom: y from high to low in stage coords)
          for (let i = 0; i < slotsPerSide; i++) {
            slots.push({
              x: EXIT_ZONE_CENTER,
              y: prev.stageHeight - SLOT_SPACING * (i + 0.5)
            });
          }
          // Right side slots (top to bottom)
          for (let i = 0; i < slotsPerSide; i++) {
            slots.push({
              x: prev.stageWidth - EXIT_ZONE_CENTER,
              y: prev.stageHeight - SLOT_SPACING * (i + 0.5)
            });
          }

          // Find which slots are occupied (dancer within 0.5m of slot)
          const isSlotOccupied = (slot: { x: number; y: number }) => {
            return existingPositions.some(p => {
              const dx = Math.abs(p.position.x - slot.x);
              const dy = Math.abs(p.position.y - slot.y);
              return dx < 0.5 && dy < 0.5;
            });
          };

          // Add new dancers to first available slots
          for (let i = existingPositions.length; i < newCount; i++) {
            // Find first empty slot
            const emptySlot = slots.find(slot => !isSlotOccupied(slot));

            if (emptySlot) {
              existingPositions.push({
                dancerId: i,
                position: { x: emptySlot.x, y: emptySlot.y },
                color: colors[i % colors.length],
              });
            } else {
              // Fallback: place at center if no slots available
              existingPositions.push({
                dancerId: i,
                position: { x: prev.stageWidth / 2, y: prev.stageHeight / 2 },
                color: colors[i % colors.length],
              });
            }
          }

          return { ...f, positions: existingPositions };
        } else if (newCount < existingPositions.length) {
          // Remove dancers from the end, keep existing positions
          return { ...f, positions: existingPositions.slice(0, newCount) };
        }

        return f;
      }),
    }));
  };

  // Generate paths between formations using selected algorithm
  const generatePathsForTransition = useCallback(async (
    fromFormation: FormationKeyframe,
    toFormation: FormationKeyframe,
    algorithm: PathAlgorithm
  ): Promise<GeneratedPath[]> => {
    // Create assignments for the algorithm
    const assignments = fromFormation.positions.map((pos) => {
      const endPos = toFormation.positions.find(p => p.dancerId === pos.dancerId);
      const startPosition = { x: pos.position.x, y: pos.position.y };
      const endPosition = endPos ? { x: endPos.position.x, y: endPos.position.y } : { x: pos.position.x, y: pos.position.y };
      const dx = endPosition.x - startPosition.x;
      const dy = endPosition.y - startPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      return {
        dancerId: pos.dancerId,
        startPosition,
        endPosition,
        distance,
      };
    });

    const config = {
      totalCounts: fromFormation.duration,
      numPoints: 32,
      collisionRadius: 0.5,
    };

    let results: { dancerId: number; path: { x: number; y: number; t: number }[] }[];

    switch (algorithm) {
      case 'hybrid_by_claude':
        results = computeAllPathsWithHybridByClaude(assignments, config);
        break;
      case 'hybrid_by_claude_cubic':
        results = computeAllPathsWithHybridByClaudeCubic(assignments, config);
        break;
      case 'hybrid_by_cursor':
        results = computeAllPathsWithHybridByCursor(assignments, config);
        break;
      case 'hybrid_by_gemini':
        results = computeAllPathsWithHybridByGemini(assignments, config);
        break;
      case 'hybrid_by_codex':
        results = computeAllPathsWithHybridByCodex(assignments, config);
        break;
      case 'hybrid':
      default:
        results = computeAllPathsWithHybrid(assignments, config);
        break;
    }

    return results.map(r => ({
      dancerId: r.dancerId,
      path: r.path,
    }));
  }, []);

  // Generate paths for current formation
  const handleGeneratePaths = useCallback(async () => {
    if (!selectedFormation) return;

    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) {
      alert('Select a formation that has a next formation to generate paths.');
      return;
    }

    setIsGeneratingPaths(true);
    setPathGenerationStatus(`Generating paths with ${PATH_ALGORITHM_LABELS[pathAlgorithm]}...`);

    try {
      const currentFormation = project.formations[currentIndex];
      const nextFormation = project.formations[currentIndex + 1];
      const pathKey = `${currentFormation.id}->${nextFormation.id}`;

      const paths = await generatePathsForTransition(currentFormation, nextFormation, pathAlgorithm);

      setGeneratedPaths(prev => {
        const newMap = new Map(prev);
        newMap.set(pathKey, paths);
        return newMap;
      });

      setPathGenerationStatus('Paths generated!');
      setTimeout(() => setPathGenerationStatus(null), 2000);

      // Generate cue sheet in BACKGROUND (non-blocking)
      setIsGeneratingCueSheet(true);
      const formationDuration = currentFormation.duration;

      // Convert paths to DancerPath format for cue sheet generator
      const dancerPaths = paths.map(p => ({
        dancerId: p.dancerId,
        path: p.path,
        startTime: p.path[0]?.t || 0,
        speed: 1,
        totalDistance: p.path.reduce((acc, point, i, arr) => {
          if (i === 0) return 0;
          const prev = arr[i - 1];
          return acc + Math.sqrt((point.x - prev.x) ** 2 + (point.y - prev.y) ** 2);
        }, 0),
      }));

      // Run in background - don't await
      generateCueSheet(dancerPaths, {
        stageWidth: project.stageWidth,
        stageHeight: project.stageHeight,
        totalCounts: formationDuration,
        language: 'en',
        includeRelativePositioning: true,
        includeArtisticNuance: true,
      })
        .then((cueSheetResult) => {
          setCueSheet(cueSheetResult);
          setIsGeneratingCueSheet(false);
          showToast('✓ Cue sheet ready! Click to view.', 'success', 8000);
        })
        .catch((cueError) => {
          console.error('Cue sheet generation failed:', cueError);
          setIsGeneratingCueSheet(false);
          showToast('Cue sheet generation failed', 'error', 5000);
        });
    } catch (error) {
      console.error('Path generation failed:', error);
      setPathGenerationStatus('Path generation failed');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingPaths(false);
    }
  }, [selectedFormation, selectedFormationId, project.formations, pathAlgorithm, generatePathsForTransition, project.stageWidth, project.stageHeight]);

  // Generate all paths for playback
  const generateAllPaths = useCallback(async () => {
    if (project.formations.length < 2) return;

    setIsGeneratingPaths(true);
    setPathGenerationStatus('Generating all movement paths...');

    try {
      const newPaths = new Map<string, GeneratedPath[]>();

      for (let i = 0; i < project.formations.length - 1; i++) {
        const current = project.formations[i];
        const next = project.formations[i + 1];
        const pathKey = `${current.id}->${next.id}`;

        // Skip if already generated
        if (generatedPaths.has(pathKey)) {
          newPaths.set(pathKey, generatedPaths.get(pathKey)!);
          continue;
        }

        setPathGenerationStatus(`Generating paths for Formation ${i + 1} → ${i + 2}...`);
        const paths = await generatePathsForTransition(current, next, pathAlgorithm);
        newPaths.set(pathKey, paths);
      }

      setGeneratedPaths(newPaths);
      setPathGenerationStatus(null);
    } catch (error) {
      console.error('Path generation failed:', error);
      setPathGenerationStatus('Path generation failed');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingPaths(false);
    }
  }, [project.formations, pathAlgorithm, generatedPaths, generatePathsForTransition]);

  // Get paths for current formation
  const getCurrentPaths = useCallback(() => {
    if (!selectedFormation) return null;

    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) return null;

    const nextFormation = project.formations[currentIndex + 1];
    const pathKey = `${selectedFormation.id}->${nextFormation.id}`;

    return generatedPaths.get(pathKey) || null;
  }, [selectedFormation, selectedFormationId, project.formations, generatedPaths]);

  const currentPaths = getCurrentPaths();
  const hasNextFormation = selectedFormation && project.formations.findIndex(f => f.id === selectedFormationId) < project.formations.length - 1;

  // Check if all paths are generated
  const allPathsGenerated = project.formations.length < 2 ||
    project.formations.slice(0, -1).every((f, i) => {
      const next = project.formations[i + 1];
      return generatedPaths.has(`${f.id}->${next.id}`);
    });

  // Change stage size
  const handleStageSizeChange = (width: number, height: number) => {
    setProject(prev => ({
      ...prev,
      stageWidth: width,
      stageHeight: height,
      updatedAt: new Date().toISOString(),
    }));
  };

  // Apply preset formation
  const handleApplyPreset = (preset: FormationPreset) => {
    if (!selectedFormation) return;

    // Check dancer count
    if (preset.dancerCount !== project.dancerCount) {
      if (!confirm(`This preset is for ${preset.dancerCount} dancers. Apply anyway (will adjust dancer count)?`)) {
        return;
      }
      // Adjust dancer count if needed
      handleDancerCountChange(preset.dancerCount);
    }

    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
    ];

    // Apply positions to selected formation
    const newPositions = preset.positions.map((pos, i) => ({
      dancerId: i,
      position: { x: pos.x, y: pos.y },
      color: colors[i % colors.length],
    }));

    updateFormation(selectedFormation.id, { positions: newPositions });
  };

  // Get presets for current dancer count
  const availablePresets = FORMATION_PRESETS.get(project.dancerCount) || [];

  // Playback controls
  const handlePlay = async () => {
    if (currentCount >= (project.formations[project.formations.length - 1]?.startCount || 0) +
        (project.formations[project.formations.length - 1]?.duration || 0)) {
      setCurrentCount(0);
    }

    // Auto-generate paths if not all paths are generated
    if (!allPathsGenerated && project.formations.length >= 2) {
      await generateAllPaths();
    }

    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentCount(0);
  };

  // Jump to formation
  const handleJumpToFormation = (formation: FormationKeyframe) => {
    setCurrentCount(formation.startCount);
    setSelectedFormationId(formation.id);
  };

  // Interpolate dancer positions based on currentCount (works for both playback and scrubbing)
  const getInterpolatedPositions = useCallback(() => {
    // If no formations or only one, return selected formation positions
    if (project.formations.length < 2) {
      return selectedFormation?.positions || [];
    }

    // Find current and next formation based on currentCount
    let currentFormation: FormationKeyframe | null = null;
    let nextFormation: FormationKeyframe | null = null;

    for (let i = 0; i < project.formations.length; i++) {
      const f = project.formations[i];
      if (currentCount >= f.startCount && currentCount < f.startCount + f.duration) {
        currentFormation = f;
        nextFormation = project.formations[i + 1] || null;
        break;
      }
    }

    // If currentCount is past all formations, show last formation
    if (!currentFormation) {
      const lastFormation = project.formations[project.formations.length - 1];
      if (currentCount >= lastFormation.startCount + lastFormation.duration) {
        return lastFormation.positions;
      }
      return selectedFormation?.positions || [];
    }

    if (!nextFormation) {
      return currentFormation.positions;
    }

    // Get generated paths for this transition
    const pathKey = `${currentFormation.id}->${nextFormation.id}`;
    const paths = generatedPaths.get(pathKey);

    // Calculate transition timing
    const transitionStart = currentFormation.startCount + currentFormation.duration * 0.5;
    const transitionEnd = currentFormation.startCount + currentFormation.duration;

    if (currentCount < transitionStart) {
      return currentFormation.positions;
    }

    // Calculate normalized time within transition (0 to 1)
    const t = (currentCount - transitionStart) / (transitionEnd - transitionStart);

    // Use generated paths if available
    if (paths && paths.length > 0) {
      return currentFormation.positions.map((pos) => {
        const dancerPath = paths.find(p => p.dancerId === pos.dancerId);
        if (!dancerPath || dancerPath.path.length === 0) {
          // Fallback to linear interpolation
          const endPos = nextFormation!.positions.find(p => p.dancerId === pos.dancerId);
          const easedT = t * t * (3 - 2 * t);
          return {
            ...pos,
            position: {
              x: pos.position.x + ((endPos?.position.x || pos.position.x) - pos.position.x) * easedT,
              y: pos.position.y + ((endPos?.position.y || pos.position.y) - pos.position.y) * easedT,
            },
          };
        }

        // Find the path point at current time
        const pathTime = t * currentFormation!.duration;
        let pointIndex = 0;
        for (let i = 0; i < dancerPath.path.length - 1; i++) {
          if (dancerPath.path[i].t <= pathTime && dancerPath.path[i + 1].t > pathTime) {
            pointIndex = i;
            break;
          }
          if (i === dancerPath.path.length - 2) {
            pointIndex = i;
          }
        }

        // Interpolate between path points
        const p1 = dancerPath.path[pointIndex];
        const p2 = dancerPath.path[Math.min(pointIndex + 1, dancerPath.path.length - 1)];
        const segmentT = p2.t > p1.t ? (pathTime - p1.t) / (p2.t - p1.t) : 0;
        const clampedT = Math.max(0, Math.min(1, segmentT));

        return {
          ...pos,
          position: {
            x: p1.x + (p2.x - p1.x) * clampedT,
            y: p1.y + (p2.y - p1.y) * clampedT,
          },
        };
      });
    }

    // Fallback: linear interpolation with easing
    const easedT = t * t * (3 - 2 * t); // Smooth step
    return currentFormation.positions.map((pos) => {
      const endPos = nextFormation!.positions.find(p => p.dancerId === pos.dancerId);
      return {
        ...pos,
        position: {
          x: pos.position.x + ((endPos?.position.x || pos.position.x) - pos.position.x) * easedT,
          y: pos.position.y + ((endPos?.position.y || pos.position.y) - pos.position.y) * easedT,
        },
      };
    });
  }, [isPlaying, project.formations, currentCount, selectedFormation, generatedPaths]);

  // Always use interpolated positions when paths exist (for scrubbing/playback)
  // When editing (currentCount is at formation start and not playing), show the editable positions
  const isAtFormationStart = selectedFormation &&
    Math.abs(currentCount - selectedFormation.startCount) < 0.1 && !isPlaying;
  const displayPositions = isAtFormationStart
    ? (selectedFormation?.positions || [])
    : getInterpolatedPositions();

  return (
    <div className="timeline-editor">
      {/* Header */}
      <header className="timeline-header">
        <div className="header-left">
          <input
            type="text"
            className="project-name-input"
            value={project.name}
            onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div className="header-center">
          <div className="header-control">
            <label>Dancers:</label>
            <input
              type="number"
              min={1}
              max={24}
              value={dancerCountInput}
              onChange={(e) => setDancerCountInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDancerCountChange(parseInt(dancerCountInput, 10));
                }
              }}
              className="header-number-input"
            />
            <button
              className="header-confirm-btn"
              onClick={() => handleDancerCountChange(parseInt(dancerCountInput, 10))}
              disabled={parseInt(dancerCountInput, 10) === project.dancerCount}
            >
              OK
            </button>
          </div>
          <div className="header-control">
            <label>Stage:</label>
            <select
              value={`${project.stageWidth}x${project.stageHeight}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number);
                handleStageSizeChange(w, h);
              }}
              className="header-select"
            >
              <option value="8x6">Small (8×6m)</option>
              <option value="10x8">Medium (10×8m)</option>
              <option value="15x12">Large (15×12m)</option>
              <option value="20x15">XLarge (20×15m)</option>
            </select>
          </div>
        </div>
        <div className="header-right">
          <button onClick={handleNew} className="header-btn">New</button>
          <button onClick={() => fileInputRef.current?.click()} className="header-btn">Load</button>
          <button onClick={handleSave} className="header-btn primary">Save</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleLoad}
          />
        </div>
      </header>

      {/* Main content */}
      <div className="timeline-main">
        {/* Stage view */}
        <div className="stage-panel">
          <div className="stage-header">
            <h3>{selectedFormation?.label || `Formation ${selectedFormation ? project.formations.indexOf(selectedFormation) + 1 : '-'}`}</h3>
            <span className="count-display">Count: {Math.floor(currentCount)}</span>
          </div>
          <Stage
            stageWidth={project.stageWidth}
            stageHeight={project.stageHeight}
            scale={scale}
            svgRef={svgRef}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Exit zones (1.5m on each side) */}
            <rect
              x={PADDING}
              y={PADDING}
              width={EXIT_ZONE_WIDTH * scale}
              height={project.stageHeight * scale}
              fill="rgba(255, 107, 107, 0.15)"
              stroke="rgba(255, 107, 107, 0.4)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <rect
              x={PADDING + (project.stageWidth - EXIT_ZONE_WIDTH) * scale}
              y={PADDING}
              width={EXIT_ZONE_WIDTH * scale}
              height={project.stageHeight * scale}
              fill="rgba(255, 107, 107, 0.15)"
              stroke="rgba(255, 107, 107, 0.4)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            {/* Exit zone labels */}
            <text
              x={PADDING + (EXIT_ZONE_WIDTH / 2) * scale}
              y={PADDING + 20}
              textAnchor="middle"
              fill="rgba(255, 107, 107, 0.6)"
              fontSize="10"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              EXIT
            </text>
            <text
              x={PADDING + (project.stageWidth - EXIT_ZONE_WIDTH / 2) * scale}
              y={PADDING + 20}
              textAnchor="middle"
              fill="rgba(255, 107, 107, 0.6)"
              fontSize="10"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              EXIT
            </text>

            {/* Stage direction labels */}
            <text
              x={PADDING + (project.stageWidth / 2) * scale}
              y={PADDING - 8}
              textAnchor="middle"
              fill="rgba(255, 255, 255, 0.4)"
              fontSize="10"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              FRONT (Audience)
            </text>
            <text
              x={PADDING + (project.stageWidth / 2) * scale}
              y={PADDING + project.stageHeight * scale + 16}
              textAnchor="middle"
              fill="rgba(255, 255, 255, 0.3)"
              fontSize="10"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              BACK
            </text>

            {/* Movement Paths */}
            {showPaths && currentPaths && currentPaths.map((pathData) => {
              const dancer = displayPositions.find(d => d.dancerId === pathData.dancerId);
              const color = dancer?.color || '#888';
              const path = pathData.path;

              if (!path || path.length < 2) return null;

              // Create SVG path from points
              const pathPoints = path.map(p => stageToScreen({ x: p.x, y: p.y }, scale, project.stageHeight));
              const pathD = pathPoints.reduce((acc, p, i) => {
                if (i === 0) return `M ${p.x} ${p.y}`;
                return `${acc} L ${p.x} ${p.y}`;
              }, '');

              const startScreen = pathPoints[0];
              const endScreen = pathPoints[pathPoints.length - 1];

              return (
                <g key={`path-${pathData.dancerId}`}>
                  {/* Path curve */}
                  <path
                    d={pathD}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="6,3"
                    fill="none"
                    opacity={0.6}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Arrow head at end */}
                  <circle
                    cx={endScreen.x}
                    cy={endScreen.y}
                    r={6}
                    fill={color}
                    opacity={0.8}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Start marker (hollow) */}
                  <circle
                    cx={startScreen.x}
                    cy={startScreen.y}
                    r={6}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.8}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })}

            {/* Dancers */}
            {displayPositions.map((dancer) => {
              const screenPos = stageToScreen(dancer.position, scale, project.stageHeight);
              return (
                <DancerCircle
                  key={dancer.dancerId}
                  id={dancer.dancerId}
                  x={screenPos.x}
                  y={screenPos.y}
                  radius={0.4 * scale}
                  color={dancer.color}
                  isSelected={selectedDancers.has(dancer.dancerId)}
                  onMouseDown={(e) => handleDancerMouseDown(dancer.dancerId, e)}
                />
              );
            })}

            {/* Selection box */}
            {selectionBox && (
              <rect
                x={Math.min(selectionBox.startX, selectionBox.endX)}
                y={Math.min(selectionBox.startY, selectionBox.endY)}
                width={Math.abs(selectionBox.endX - selectionBox.startX)}
                height={Math.abs(selectionBox.endY - selectionBox.startY)}
                fill="rgba(78, 205, 196, 0.2)"
                stroke="#4ECDC4"
                strokeWidth={1}
                strokeDasharray="4,2"
              />
            )}
          </Stage>

          {/* Formation list quick nav */}
          <div className="formation-quick-nav">
            {project.formations.map((f, i) => (
              <button
                key={f.id}
                className={`quick-nav-btn ${f.id === selectedFormationId ? 'active' : ''}`}
                onClick={() => handleJumpToFormation(f)}
              >
                {f.label || `F${i + 1}`}
              </button>
            ))}
          </div>
        </div>

        {/* Properties panel */}
        <div className="properties-panel">
          <h3>Formation Properties</h3>
          {selectedFormation ? (
            <>
              <div className="property-row">
                <label>Label</label>
                <input
                  type="text"
                  value={selectedFormation.label || ''}
                  onChange={(e) => updateFormation(selectedFormation.id, { label: e.target.value })}
                  placeholder="Formation name..."
                />
              </div>
              <div className="property-row">
                <label>Duration</label>
                <select
                  value={selectedFormation.duration}
                  onChange={(e) => updateFormation(selectedFormation.id, { duration: parseInt(e.target.value, 10) })}
                >
                  <option value={4}>4 counts</option>
                  <option value={8}>8 counts</option>
                  <option value={12}>12 counts</option>
                  <option value={16}>16 counts</option>
                  <option value={20}>20 counts</option>
                  <option value={24}>24 counts</option>
                  <option value={32}>32 counts</option>
                </select>
              </div>
              <div className="property-row">
                <label>Start Count</label>
                <span className="property-value">{selectedFormation.startCount}</span>
              </div>

              {/* Path generation section */}
              <div className="path-section">
                <h4>Movement Paths</h4>

                {/* Algorithm selector */}
                <div className="algorithm-selector">
                  <label>Algorithm:</label>
                  <select
                    value={pathAlgorithm}
                    onChange={(e) => setPathAlgorithm(e.target.value as PathAlgorithm)}
                    disabled={isGeneratingPaths}
                  >
                    {Object.entries(PATH_ALGORITHM_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                {hasNextFormation ? (
                  <>
                    <button
                      className="generate-path-btn"
                      onClick={handleGeneratePaths}
                      disabled={isGeneratingPaths}
                    >
                      {isGeneratingPaths ? 'Generating...' : 'Generate Paths'}
                    </button>

                    {/* Status display */}
                    {pathGenerationStatus && (
                      <div className={`path-generation-status ${isGeneratingPaths ? 'loading' : 'success'}`}>
                        {isGeneratingPaths && <span className="loading-spinner" />}
                        {pathGenerationStatus}
                      </div>
                    )}

                    {currentPaths && !isGeneratingPaths && !pathGenerationStatus && (
                      <span className="path-status">✓ Paths generated ({PATH_ALGORITHM_LABELS[pathAlgorithm]})</span>
                    )}

                    <label className="show-path-toggle">
                      <input
                        type="checkbox"
                        checked={showPaths}
                        onChange={(e) => setShowPaths(e.target.checked)}
                      />
                      Show paths on stage
                    </label>
                  </>
                ) : (
                  <p className="path-hint">Add a next formation to generate paths</p>
                )}
              </div>

              {/* Preset formations section */}
              <div className="preset-section">
                <h4>Formation Presets</h4>
                {availablePresets.length > 0 ? (
                  <div className="preset-list">
                    {availablePresets.map((preset) => (
                      <button
                        key={preset.name}
                        className="preset-btn"
                        onClick={() => handleApplyPreset(preset)}
                        title={`Apply ${preset.name}`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="preset-empty">
                    <p>No presets for {project.dancerCount} dancers</p>
                    <p className="preset-hint">Presets available: 4-12 dancers</p>
                  </div>
                )}

                {/* Show presets from other dancer counts */}
                <details className="other-presets">
                  <summary>Other dancer counts</summary>
                  <div className="other-presets-content">
                    {[4, 5, 6, 7, 8, 9, 10, 11, 12]
                      .filter(count => count !== project.dancerCount)
                      .map(count => {
                        const presets = FORMATION_PRESETS.get(count) || [];
                        if (presets.length === 0) return null;
                        return (
                          <div key={count} className="preset-group">
                            <span className="preset-group-label">{count} dancers:</span>
                            {presets.map((preset) => (
                              <button
                                key={preset.name}
                                className="preset-btn small"
                                onClick={() => handleApplyPreset(preset)}
                                title={`Apply ${preset.name} (${count} dancers)`}
                              >
                                {preset.name.replace(/^\d+_/, '')}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                </details>
              </div>
            </>
          ) : (
            <p className="no-selection">No formation selected</p>
          )}
        </div>
      </div>

      {/* Playback controls */}
      <div className="playback-controls">
        <button onClick={handleStop} className="playback-btn" title="Stop" disabled={isGeneratingPaths}>⏹</button>
        {isPlaying ? (
          <button onClick={handlePause} className="playback-btn" title="Pause">⏸</button>
        ) : isGeneratingPaths ? (
          <button className="playback-btn primary generating" disabled title="Generating paths...">
            <span className="loading-spinner small" />
          </button>
        ) : (
          <button onClick={handlePlay} className="playback-btn primary" title="Play">▶</button>
        )}
        {isGeneratingPaths && (
          <span className="playback-status">{pathGenerationStatus || 'Generating paths...'}</span>
        )}
        <div className="speed-control">
          <label>Speed:</label>
          <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </div>
        <div className="zoom-control">
          <label>Zoom:</label>
          <input
            type="range"
            min={4}
            max={20}
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value, 10))}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="timeline-panel">
        <Timeline
          project={project}
          selectedFormationId={selectedFormationId}
          currentCount={currentCount}
          zoom={zoom}
          onSelectFormation={setSelectedFormationId}
          onUpdateFormation={updateFormation}
          onDeleteFormation={deleteFormation}
          onAddFormation={addFormation}
          onSeek={(count) => {
            setCurrentCount(count);
            // Stop playback when seeking
            if (isPlaying) setIsPlaying(false);
          }}
        />
      </div>

      {/* Cue Sheet Modal */}
      {showCueSheet && cueSheet && (
        <div className="cue-sheet-modal-overlay" onClick={() => setShowCueSheet(false)}>
          <div className="cue-sheet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cue-sheet-header">
              <h2>{cueSheet.title || 'Cue Sheet'}</h2>
              <div className="cue-sheet-meta">
                <span>Stage: {cueSheet.stageInfo}</span>
                <span>Duration: {cueSheet.totalCounts} counts</span>
              </div>
              <button className="cue-sheet-close" onClick={() => setShowCueSheet(false)}>×</button>
            </div>

            {cueSheet.generalNotes && cueSheet.generalNotes.length > 0 && (
              <div className="cue-sheet-notes">
                <h4>General Notes</h4>
                <ul>
                  {cueSheet.generalNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="cue-sheet-dancers">
              {cueSheet.dancers.map((dancer: DancerCueSheet) => (
                <div key={dancer.dancerId} className="dancer-cue-card">
                  <div className="dancer-cue-header">
                    <span className="dancer-label">{dancer.dancerLabel}</span>
                    <span className="dancer-summary">{dancer.summary}</span>
                  </div>
                  <div className="dancer-cues">
                    {dancer.cues.map((cue, i) => (
                      <div key={i} className="cue-entry">
                        <span className="cue-time">{cue.timeRange}</span>
                        <div className="cue-content">
                          <p className="cue-instruction">{cue.instruction}</p>
                          {cue.notes && <p className="cue-notes">{cue.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cue Sheet Background Indicator */}
      {isGeneratingCueSheet && (
        <div className="cue-sheet-background-indicator">
          <span className="loading-spinner small" />
          <span>Cue sheet generating...</span>
        </div>
      )}

      {/* Cue Sheet Ready Button */}
      {!isGeneratingCueSheet && cueSheet && !showCueSheet && (
        <button
          className="cue-sheet-ready-btn"
          onClick={() => setShowCueSheet(true)}
        >
          📋 View Cue Sheet
        </button>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`toast-notification ${toast.type}`}
          onClick={() => {
            if (toast.type === 'success' && cueSheet) {
              setShowCueSheet(true);
            }
            setToast(null);
          }}
        >
          <span>{toast.message}</span>
          <button className="toast-close" onClick={(e) => { e.stopPropagation(); setToast(null); }}>×</button>
        </div>
      )}
    </div>
  );
};

export default TimelineEditor;
