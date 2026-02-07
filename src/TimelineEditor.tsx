/**
 * TimelineEditor Page
 * Main page for timeline-based choreography editing
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Stage, screenToStage, stageToScreen } from './components/Stage';
import { DancerCircle } from './components/DancerCircle';
import { Timeline } from './components/Timeline';
import { PresetPreview } from './components/PresetPreview';
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
import {
  type PathAlgorithm,
  type GeneratedPath,
  type FormationPreset,
  type ScoreBreakdown,
  type PathEvaluationResult,
  PATH_ALGORITHM_LABELS,
  ALGORITHM_PRIORITY,
  FORMATION_PRESETS,
  ALL_PRESETS,
  COUNTS_PER_SECOND,
  snapToGrid,
  EXIT_ZONE_WIDTH,
  MAX_UNDO_HISTORY,
} from './constants/editor';
import {
  computePathsCleanFlow,
  computePathsNaturalCurves,
  computePathsWaveSync,
  computePathsPerfectSync,
  computePathsBalancedDirect,
  computePathsHarmonizedFlow,
} from './algorithms';
import { generateCueSheet, type CueSheetResult, type DancerCueSheet } from './gemini/cueSheetGenerator';
import { callGeminiAPIWithImages, type GeminiImageData } from './gemini';

// Keep alias for backwards compatibility
type GeminiTransitionResult = PathEvaluationResult;

const TimelineEditor: React.FC = () => {
  // Project state
  const [project, setProject] = useState<ChoreographyProject>(() =>
    createNewProject('New Choreography', 8, DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT)
  );

  // Undo history
  const [undoHistory, setUndoHistory] = useState<ChoreographyProject[]>([]);
  const [redoHistory, setRedoHistory] = useState<ChoreographyProject[]>([]);
  const isUndoingRef = useRef(false); // Prevent saving state during undo/redo

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

  // Metronome state
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const lastBeatRef = useRef<number>(-1);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Play metronome click sound
  const playMetronomeClick = useCallback((isDownbeat: boolean = false) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Higher pitch for downbeat (every 4 counts), lower for regular beats
    oscillator.frequency.value = isDownbeat ? 1000 : 800;
    oscillator.type = 'sine';

    // Quick attack and decay for click sound
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    oscillator.start(now);
    oscillator.stop(now + 0.05);
  }, []);

  // Drag state
  const [draggingDancer, setDraggingDancer] = useState<number | null>(null);
  const [selectedDancers, setSelectedDancers] = useState<Set<number>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{startX: number; startY: number; endX: number; endY: number} | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Dancer count input state
  const [dancerCountInput, setDancerCountInput] = useState(String(project.dancerCount));

  // Path state - now stores paths for ALL algorithms per transition
  // Key format: "formationId->formationId:algorithm"
  const [allAlgorithmPaths, setAllAlgorithmPaths] = useState<Map<string, Map<PathAlgorithm, GeneratedPath[]>>>(new Map());
  const [showPaths, setShowPaths] = useState(true);
  const [pathAlgorithm, setPathAlgorithm] = useState<PathAlgorithm>('natural_curves'); // Default to Cubic
  const [isGeneratingPaths, setIsGeneratingPaths] = useState(false);
  const [pathGenerationStatus, setPathGenerationStatus] = useState<string | null>(null);

  // Path evaluation state - stored per transition
  const [geminiResults, setGeminiResults] = useState<Map<string, GeminiTransitionResult>>(new Map());
  const [isRankingWithGemini, setIsRankingWithGemini] = useState(false);
  const [rankingTransitionKey, setRankingTransitionKey] = useState<string | null>(null); // Which transition is being ranked

  // User-selected algorithm per transition (pathKey -> algorithm)
  const [userSelectedAlgorithms, setUserSelectedAlgorithms] = useState<Map<string, PathAlgorithm>>(new Map());

  // Cue sheet state
  const [cueSheet, setCueSheet] = useState<CueSheetResult | null>(null);
  const [cueSheetAlgorithm, setCueSheetAlgorithm] = useState<PathAlgorithm | null>(null);
  const [isGeneratingCueSheet, setIsGeneratingCueSheet] = useState(false);
  const [showCueSheet, setShowCueSheet] = useState(false);

  // Preset filter state
  const [presetFilter, setPresetFilter] = useState<'all' | number>('all');

  // POV (Point of View) state
  // 'choreographer' = choreographer view (show General Notes)
  // number = specific dancer view (highlight that dancer + show only their cue sheet)
  const [povMode, setPovMode] = useState<'choreographer' | number>('choreographer');

  // UI Mode state
  // 'edit' = edit mode (show all editing tools, hide cue sheet)
  // 'rehearsal' = rehearsal mode (show only playback/cue sheet/stage, no editing)
  const [uiMode, setUiMode] = useState<'edit' | 'rehearsal'>('edit');

  // Audience direction state
  // true = audience at top of screen (current default behavior)
  // false = audience at bottom of screen
  const [audienceAtTop, setAudienceAtTop] = useState(true);

  // Helper: Get paths for current algorithm from allAlgorithmPaths
  const getPathsForAlgorithm = useCallback((pathKey: string, algorithm: PathAlgorithm): GeneratedPath[] | null => {
    const algorithmMap = allAlgorithmPaths.get(pathKey);
    if (!algorithmMap) return null;
    return algorithmMap.get(algorithm) || null;
  }, [allAlgorithmPaths]);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Show toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info', duration = 5000) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, []);

  // Save state to undo history (call before making changes)
  const saveToHistory = useCallback(() => {
    if (isUndoingRef.current) return;
    setUndoHistory(prev => {
      const newHistory = [...prev, project];
      // Limit history size
      if (newHistory.length > MAX_UNDO_HISTORY) {
        return newHistory.slice(-MAX_UNDO_HISTORY);
      }
      return newHistory;
    });
    // Clear redo history when new action is performed
    setRedoHistory([]);
  }, [project]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (undoHistory.length === 0) return;

    isUndoingRef.current = true;
    const previousState = undoHistory[undoHistory.length - 1];

    // Save current state to redo history
    setRedoHistory(prev => [...prev, project]);

    // Remove last item from undo history
    setUndoHistory(prev => prev.slice(0, -1));

    // Restore previous state
    setProject(previousState);

    // Update selected formation if needed
    if (previousState.formations.length > 0) {
      const stillExists = previousState.formations.find(f => f.id === selectedFormationId);
      if (!stillExists) {
        setSelectedFormationId(previousState.formations[0].id);
      }
    }

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    showToast('Undo', 'info', 1500);
  }, [undoHistory, project, selectedFormationId, showToast]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (redoHistory.length === 0) return;

    isUndoingRef.current = true;
    const nextState = redoHistory[redoHistory.length - 1];

    // Save current state to undo history
    setUndoHistory(prev => [...prev, project]);

    // Remove last item from redo history
    setRedoHistory(prev => prev.slice(0, -1));

    // Restore next state
    setProject(nextState);

    // Update selected formation if needed
    if (nextState.formations.length > 0) {
      const stillExists = nextState.formations.find(f => f.id === selectedFormationId);
      if (!stillExists) {
        setSelectedFormationId(nextState.formations[0].id);
      }
    }

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    showToast('Redo', 'info', 1500);
  }, [redoHistory, project, selectedFormationId, showToast]);

  // Keyboard shortcut for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo/Redo shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
      // Space bar: Play/Pause (only when not typing in input)
      if (e.key === ' ' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }
      // Escape: Switch to edit mode
      if (e.key === 'Escape' && uiMode === 'rehearsal') {
        setUiMode('edit');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, uiMode]);

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
      // Reset metronome beat tracker when stopped
      lastBeatRef.current = -1;
      return;
    }

    const lastFormation = project.formations[project.formations.length - 1];
    const maxCount = lastFormation ? lastFormation.startCount + lastFormation.duration : 0;

    // Track current count for metronome
    let currentCountValue = currentCount;

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      const next = currentCountValue + delta * COUNTS_PER_SECOND * playbackSpeed;

      // Check for metronome beat crossing
      if (metronomeEnabled) {
        const currentBeat = Math.floor(next);
        if (currentBeat !== lastBeatRef.current && currentBeat >= 0) {
          lastBeatRef.current = currentBeat;
          // Downbeat every 4 counts (0, 4, 8, 12...)
          const isDownbeat = currentBeat % 4 === 0;
          playMetronomeClick(isDownbeat);
        }
      }

      if (next >= maxCount) {
        setIsPlaying(false);
        setCurrentCount(0);
        return;
      }

      currentCountValue = next;
      setCurrentCount(next);

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    // Initialize beat tracker to current position
    lastBeatRef.current = Math.floor(currentCount);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, project.formations, metronomeEnabled, playMetronomeClick, currentCount]);

  // Update formation
  const updateFormation = useCallback((id: string, updates: Partial<FormationKeyframe>) => {
    saveToHistory();
    setProject(prev => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      formations: prev.formations.map(f =>
        f.id === id ? { ...f, ...updates } : f
      ),
    }));
  }, [saveToHistory]);

  // Add new formation
  const addFormation = useCallback((afterId: string | null) => {
    saveToHistory();
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
  }, [saveToHistory]);

  // Add formation from preset (for drag & drop)
  const addFormationFromPreset = useCallback((preset: FormationPreset, atCount?: number) => {
    saveToHistory();

    const colors = [
      '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
      '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
      '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
      '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1', '#7B68EE', '#00CED1', '#D63384',
    ];

    setProject(prev => {
      const formations = [...prev.formations];
      const lastFormation = formations[formations.length - 1];
      const startCount = atCount !== undefined
        ? Math.floor(atCount / 8) * 8 // Snap to 8-count grid
        : (lastFormation ? lastFormation.startCount + lastFormation.duration : 0);

      // Create new formation with preset positions
      const newFormation = createEmptyFormation(startCount, prev.dancerCount, prev.stageWidth, prev.stageHeight);

      // Apply preset positions to matching dancers
      newFormation.positions = newFormation.positions.map((pos, i) => {
        if (i < preset.positions.length) {
          return {
            ...pos,
            position: { x: preset.positions[i].x, y: preset.positions[i].y },
            color: colors[i % colors.length],
          };
        }
        return pos;
      });

      newFormation.label = preset.name;

      // Find insert position based on startCount
      let insertIndex = formations.length;
      for (let i = 0; i < formations.length; i++) {
        if (formations[i].startCount >= startCount) {
          insertIndex = i;
          break;
        }
      }

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

    showToast(`Added formation: ${preset.name}`, 'success', 2000);
  }, [saveToHistory, showToast]);

  // Delete formation
  const deleteFormation = useCallback((id: string) => {
    saveToHistory();
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
  }, [selectedFormationId, saveToHistory]);

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

    const stagePos = screenToStage(e.clientX, e.clientY, rect, scale, project.stageHeight, audienceAtTop);

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
          const screenPos = stageToScreen(pos.position, scale, project.stageHeight, audienceAtTop);
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
    if (isNaN(newCount) || newCount < 1 || newCount > 35) return;

    saveToHistory();

    const colors = [
      '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
      '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
      '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
      '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1', '#7B68EE', '#00CED1', '#D63384',
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
                dancerId: i + 1,
                position: { x: emptySlot.x, y: emptySlot.y },
                color: colors[i % colors.length],
              });
            } else {
              // Fallback: place at center if no slots available
              existingPositions.push({
                dancerId: i + 1,
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

  // Calculate optimal entry position for a new dancer entering from exit zone
  const calculateOptimalEntryPosition = useCallback((
    targetPosition: { x: number; y: number },
    stageWidth: number,
    stageHeight: number,
    existingEntryPositions: { x: number; y: number }[]
  ): { x: number; y: number } => {
    const EXIT_ZONE_CENTER = 0.75; // Center of 1.5m exit zone
    const MIN_SPACING = 1.0; // Minimum spacing between dancers in exit zone

    // Choose left or right exit based on target position
    const useLeftExit = targetPosition.x < stageWidth / 2;
    const exitX = useLeftExit ? EXIT_ZONE_CENTER : stageWidth - EXIT_ZONE_CENTER;

    // Start with Y matching target position (horizontal entry path)
    let entryY = Math.max(0.5, Math.min(stageHeight - 0.5, targetPosition.y));

    // Check for collisions with other entry positions and adjust if needed
    const isPositionOccupied = (y: number) => {
      return existingEntryPositions.some(pos =>
        Math.abs(pos.x - exitX) < 0.5 && Math.abs(pos.y - y) < MIN_SPACING
      );
    };

    // If position is occupied, search for nearby available slot
    if (isPositionOccupied(entryY)) {
      // Try positions above and below, alternating
      for (let offset = MIN_SPACING; offset < stageHeight; offset += MIN_SPACING) {
        const aboveY = entryY + offset;
        const belowY = entryY - offset;

        if (aboveY <= stageHeight - 0.5 && !isPositionOccupied(aboveY)) {
          entryY = aboveY;
          break;
        }
        if (belowY >= 0.5 && !isPositionOccupied(belowY)) {
          entryY = belowY;
          break;
        }
      }
    }

    return { x: exitX, y: entryY };
  }, []);

  // Calculate optimal exit position for a dancer leaving through exit zone
  const calculateOptimalExitPosition = useCallback((
    currentPosition: { x: number; y: number },
    stageWidth: number,
    stageHeight: number
  ): { x: number; y: number } => {
    const EXIT_ZONE_CENTER = 0.75;

    // Choose left or right exit based on current position (exit to nearest side)
    const useLeftExit = currentPosition.x < stageWidth / 2;
    const exitX = useLeftExit ? EXIT_ZONE_CENTER : stageWidth - EXIT_ZONE_CENTER;

    // Keep same Y position for horizontal exit path
    const exitY = Math.max(0.5, Math.min(stageHeight - 0.5, currentPosition.y));

    return { x: exitX, y: exitY };
  }, []);

  // Generate paths between formations using selected algorithm
  const generatePathsForTransition = useCallback(async (
    fromFormation: FormationKeyframe,
    toFormation: FormationKeyframe,
    algorithm: PathAlgorithm
  ): Promise<GeneratedPath[]> => {
    // Create assignments for dancers in fromFormation
    const assignments = fromFormation.positions.map((pos) => {
      const endPos = toFormation.positions.find(p => p.dancerId === pos.dancerId);
      const startPosition = { x: pos.position.x, y: pos.position.y };

      // If dancer doesn't exist in next formation, they're exiting
      let endPosition: { x: number; y: number };
      if (!endPos) {
        // Calculate exit position (nearest exit zone, same Y level)
        endPosition = calculateOptimalExitPosition(startPosition, project.stageWidth, project.stageHeight);
      } else {
        endPosition = { x: endPos.position.x, y: endPos.position.y };
      }

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

    // Find new dancers entering in toFormation (not in fromFormation)
    const existingDancerIds = new Set(fromFormation.positions.map(p => p.dancerId));
    const newDancers = toFormation.positions.filter(p => !existingDancerIds.has(p.dancerId));

    // Calculate optimal entry positions for new dancers
    const entryPositions: { x: number; y: number }[] = [];
    for (const newDancer of newDancers) {
      const targetPosition = { x: newDancer.position.x, y: newDancer.position.y };
      const entryPosition = calculateOptimalEntryPosition(
        targetPosition,
        project.stageWidth,
        project.stageHeight,
        entryPositions
      );
      entryPositions.push(entryPosition);

      const dx = targetPosition.x - entryPosition.x;
      const dy = targetPosition.y - entryPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      assignments.push({
        dancerId: newDancer.dancerId,
        startPosition: entryPosition,
        endPosition: targetPosition,
        distance,
      });
    }

    const config = {
      totalCounts: fromFormation.duration,
      numPoints: 32,
      collisionRadius: 0.5,
    };

    let results: { dancerId: number; path: { x: number; y: number; t: number }[] }[];

    switch (algorithm) {
      case 'clean_flow':
        results = computePathsCleanFlow(assignments, config);
        break;
      case 'natural_curves':
        results = computePathsNaturalCurves(assignments, config);
        break;
      case 'wave_sync':
        results = computePathsWaveSync(assignments, config);
        break;
      case 'perfect_sync':
        results = computePathsPerfectSync(assignments, config);
        break;
      case 'balanced_direct':
        results = computePathsBalancedDirect(assignments, config);
        break;
      case 'harmonized_flow':
      default:
        results = computePathsHarmonizedFlow(assignments, config);
        break;
    }

    return results.map(r => ({
      dancerId: r.dancerId,
      path: r.path,
    }));
  }, [calculateOptimalEntryPosition, calculateOptimalExitPosition, project.stageWidth, project.stageHeight]);

  // Path Stability / Deviation Tolerance
  // Calculate how much each dancer can deviate from planned path without collision
  // Higher value = safer path for actual performance
  const calculatePathStability = useCallback((paths: GeneratedPath[]): {
    minClearance: number;      // Minimum distance (m)
    deviationTolerance: number; // Allowed deviation (m) - each dancer can deviate this much safely
  } => {
    const COLLISION_THRESHOLD = 0.8; // meters
    let minClearance = Infinity;

    // Calculate distance between all dancer pairs at all times
    if (paths.length < 2) {
      return { minClearance: Infinity, deviationTolerance: Infinity };
    }

    // Collect time points (from all dancer paths)
    const timePoints = new Set<number>();
    paths.forEach(p => p.path.forEach(pt => timePoints.add(pt.t)));
    const sortedTimes = Array.from(timePoints).sort((a, b) => a - b);

    // Calculate distance between all dancer pairs at each time
    for (const t of sortedTimes) {
      // Calculate each dancer's position at this time (interpolate)
      const positions: { x: number; y: number }[] = paths.map(dancerPath => {
        const path = dancerPath.path;
        // Find exact time match
        const exactPoint = path.find(p => Math.abs(p.t - t) < 0.01);
        if (exactPoint) return { x: exactPoint.x, y: exactPoint.y };

        // Interpolation needed
        let before = path[0];
        let after = path[path.length - 1];
        for (let i = 0; i < path.length - 1; i++) {
          if (path[i].t <= t && path[i + 1].t >= t) {
            before = path[i];
            after = path[i + 1];
            break;
          }
        }

        if (before.t === after.t) return { x: before.x, y: before.y };

        const ratio = (t - before.t) / (after.t - before.t);
        return {
          x: before.x + (after.x - before.x) * ratio,
          y: before.y + (after.y - before.y) * ratio,
        };
      });

      // Calculate distance for all pairs
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = positions[i].x - positions[j].x;
          const dy = positions[i].y - positions[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          minClearance = Math.min(minClearance, dist);
        }
      }
    }

    // Calculate deviation tolerance: (min distance - collision threshold) / 2
    // Divided by 2 because two dancers can deviate toward each other
    const deviationTolerance = Math.max(0, (minClearance - COLLISION_THRESHOLD) / 2);

    return {
      minClearance: Math.round(minClearance * 100) / 100,
      deviationTolerance: Math.round(deviationTolerance * 100) / 100,
    };
  }, []);

  // Deterministic scoring function - calculates objective score based on metrics
  const calculateDeterministicScore = useCallback((paths: GeneratedPath[]): {
    score: number;
    breakdown: {
      efficiency: number;      // Distance efficiency (shorter = better)
      safety: number;          // Collision margin (larger = better)
      directness: number;      // How direct the paths are (straighter = better)
      synchronization: number; // Arrival time sync (more sync = better)
    };
  } => {
    if (paths.length === 0) {
      return { score: 0, breakdown: { efficiency: 0, safety: 0, directness: 0, synchronization: 0 } };
    }

    // 1. Efficiency: Total distance (normalize by comparing to straight-line distance)
    let totalActualDistance = 0;
    let totalStraightDistance = 0;
    paths.forEach(p => {
      const start = p.path[0];
      const end = p.path[p.path.length - 1];
      const straightDist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      totalStraightDistance += straightDist;

      // Calculate actual path distance
      let actualDist = 0;
      for (let i = 1; i < p.path.length; i++) {
        const dx = p.path[i].x - p.path[i - 1].x;
        const dy = p.path[i].y - p.path[i - 1].y;
        actualDist += Math.sqrt(dx * dx + dy * dy);
      }
      totalActualDistance += actualDist;
    });
    // Efficiency ratio: 1.0 = perfect (straight line), lower = more detour
    const efficiencyRatio = totalStraightDistance > 0 ? totalStraightDistance / totalActualDistance : 1;
    const efficiency = Math.min(100, Math.max(0, efficiencyRatio * 100));

    // 2. Safety: Minimum clearance between dancers
    const stability = calculatePathStability(paths);
    // 0.5m = dangerous (0 points), 2m+ = very safe (100 points)
    const safetyScore = Math.min(100, Math.max(0, (stability.minClearance - 0.5) / 1.5 * 100));

    // 3. Directness: How much paths curve (less curve = better)
    let totalCurvature = 0;
    paths.forEach(p => {
      for (let i = 1; i < p.path.length - 1; i++) {
        const prev = p.path[i - 1];
        const curr = p.path[i];
        const next = p.path[i + 1];
        // Calculate angle change
        const v1x = curr.x - prev.x;
        const v1y = curr.y - prev.y;
        const v2x = next.x - curr.x;
        const v2y = next.y - curr.y;
        const dot = v1x * v2x + v1y * v2y;
        const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
        const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
        if (len1 > 0.01 && len2 > 0.01) {
          const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)));
          const angle = Math.acos(cos);
          totalCurvature += angle;
        }
      }
    });
    // Less curvature = higher directness score
    const avgCurvature = totalCurvature / Math.max(1, paths.length);
    const directness = Math.min(100, Math.max(0, 100 - avgCurvature * 20));

    // 4. Synchronization: How close arrival times are
    const endTimes = paths.map(p => p.path[p.path.length - 1]?.t || 0);
    const avgEndTime = endTimes.reduce((a, b) => a + b, 0) / endTimes.length;
    const endTimeVariance = endTimes.reduce((acc, t) => acc + (t - avgEndTime) ** 2, 0) / endTimes.length;
    // Lower variance = better sync
    const synchronization = Math.min(100, Math.max(0, 100 - endTimeVariance * 10));

    // Weighted total score
    const score = Math.round(
      efficiency * 0.25 +      // 25% weight
      safetyScore * 0.35 +     // 35% weight (most important)
      directness * 0.25 +      // 25% weight
      synchronization * 0.15   // 15% weight
    );

    return {
      score,
      breakdown: {
        efficiency: Math.round(efficiency),
        safety: Math.round(safetyScore),
        directness: Math.round(directness),
        synchronization: Math.round(synchronization),
      },
    };
  }, [calculatePathStability]);

  // Helper: Generate path visualization image as base64
  const generatePathVisualization = useCallback((
    paths: GeneratedPath[],
    stageWidth: number,
    stageHeight: number,
    label: string
  ): string => {
    const canvas = document.createElement('canvas');
    const scale = 40; // pixels per meter
    const padding = 30;
    canvas.width = stageWidth * scale + padding * 2;
    canvas.height = stageHeight * scale + padding * 2;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stage area
    ctx.fillStyle = 'rgba(40, 40, 60, 0.5)';
    ctx.fillRect(padding, padding, stageWidth * scale, stageHeight * scale);

    // Grid lines
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    for (let x = 0; x <= stageWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(padding + x * scale, padding);
      ctx.lineTo(padding + x * scale, padding + stageHeight * scale);
      ctx.stroke();
    }
    for (let y = 0; y <= stageHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(padding, padding + y * scale);
      ctx.lineTo(padding + stageWidth * scale, padding + y * scale);
      ctx.stroke();
    }

    // Draw paths for each dancer
    const colors = [
      '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
      '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
    ];

    paths.forEach((dancerPath, idx) => {
      const color = colors[idx % colors.length];

      // Draw path line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();

      dancerPath.path.forEach((point, i) => {
        const x = padding + point.x * scale;
        const y = padding + (stageHeight - point.y) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw start position (filled circle)
      const start = dancerPath.path[0];
      if (start) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(padding + start.x * scale, padding + (stageHeight - start.y) * scale, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), padding + start.x * scale, padding + (stageHeight - start.y) * scale);
      }

      // Draw end position (ring)
      const end = dancerPath.path[dancerPath.path.length - 1];
      if (end) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(padding + end.x * scale, padding + (stageHeight - end.y) * scale, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Label
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Option ${label}`, padding, 20);

    return canvas.toDataURL('image/png').split(',')[1]; // Return base64 without prefix
  }, []);

  // Check if two path sets are identical (for skipping unnecessary Gemini calls)
  // Uses 0.3m tolerance to filter out visually similar paths
  const arePathsIdentical = useCallback((paths1: GeneratedPath[], paths2: GeneratedPath[]): boolean => {
    if (paths1.length !== paths2.length) return false;

    // Sort both by dancer ID to ensure consistent comparison
    const sorted1 = [...paths1].sort((a, b) => a.dancerId - b.dancerId);
    const sorted2 = [...paths2].sort((a, b) => a.dancerId - b.dancerId);

    for (let i = 0; i < sorted1.length; i++) {
      // Check if dancer IDs match
      if (sorted1[i].dancerId !== sorted2[i].dancerId) return false;

      const p1 = sorted1[i].path;
      const p2 = sorted2[i].path;
      if (p1.length !== p2.length) return false;

      // Compare all points with 0.3m tolerance
      for (let j = 0; j < p1.length; j++) {
        if (Math.abs(p1[j].x - p2[j].x) > 0.3 || Math.abs(p1[j].y - p2[j].y) > 0.3) {
          return false;
        }
      }
    }
    return true;
  }, []);

  // Get unique algorithms for a transition (filter out duplicates, keep highest priority)
  const getUniqueAlgorithms = useCallback((algorithmPaths: Map<PathAlgorithm, GeneratedPath[]> | undefined): PathAlgorithm[] => {
    if (!algorithmPaths || algorithmPaths.size === 0) {
      return ALGORITHM_PRIORITY; // Return all if no paths yet
    }

    const algorithms = Array.from(algorithmPaths.keys());
    const uniqueAlgos: PathAlgorithm[] = [];
    const processedGroups: GeneratedPath[][] = [];

    // Process in priority order
    for (const algo of ALGORITHM_PRIORITY) {
      if (!algorithms.includes(algo)) continue;

      const paths = algorithmPaths.get(algo);
      if (!paths) continue;

      // Check if this path is identical to any already processed
      let isDuplicate = false;
      for (const existingPaths of processedGroups) {
        if (arePathsIdentical(paths, existingPaths)) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        uniqueAlgos.push(algo);
        processedGroups.push(paths);
      }
    }

    return uniqueAlgos.length > 0 ? uniqueAlgos : ALGORITHM_PRIORITY;
  }, [arePathsIdentical]);

  // Gemini ranking function - hybrid approach with anonymization + coordinates + images
  const rankPathsWithGemini = useCallback(async (
    allPaths: Map<PathAlgorithm, GeneratedPath[]>,
    stageWidth: number,
    stageHeight: number,
    totalCounts: number,
    transitionKey: string
  ) => {
    setIsRankingWithGemini(true);
    setRankingTransitionKey(transitionKey);

    try {
      // Sort algorithms in consistent order to avoid LLM position bias
      const algorithms = Array.from(allPaths.keys()).sort((a, b) => {
        const priorityA = ALGORITHM_PRIORITY.indexOf(a);
        const priorityB = ALGORITHM_PRIORITY.indexOf(b);
        return priorityA - priorityB;
      });
      const firstPaths = allPaths.get(algorithms[0])!;

      // Check if all paths are identical - skip Gemini if so
      let allIdentical = true;
      for (let i = 1; i < algorithms.length; i++) {
        const otherPaths = allPaths.get(algorithms[i])!;
        if (!arePathsIdentical(firstPaths, otherPaths)) {
          allIdentical = false;
          break;
        }
      }

      // If all paths are identical, use priority-based selection
      if (allIdentical) {
        const bestAlgo = ALGORITHM_PRIORITY.find(algo => algorithms.includes(algo)) || algorithms[0];
        const scores = new Map<PathAlgorithm, number>();
        const breakdowns = new Map<PathAlgorithm, ScoreBreakdown>();
        const insights = new Map<PathAlgorithm, string>();

        algorithms.forEach(algo => {
          scores.set(algo, 85); // Equal score for identical paths
          breakdowns.set(algo, { efficiency: 85, safety: 85, directness: 85, synchronization: 85 });
          insights.set(algo, 'Simple transition - all algorithms produce identical paths');
        });

        const transitionResult: PathEvaluationResult = {
          pick: bestAlgo,
          scores,
          breakdowns,
          insights,
          pickReason: 'Paths are identical for this simple transition. Selected based on algorithm reliability.',
        };

        setGeminiResults(prev => {
          const newMap = new Map(prev);
          newMap.set(transitionKey, transitionResult);
          return newMap;
        });

        showToast(`Identical paths - using ${PATH_ALGORITHM_LABELS[bestAlgo]}`, 'info', 3000);
        setIsRankingWithGemini(false);
        setRankingTransitionKey(null);
        return;
      }

      // Create anonymized mapping (A, B, C, ...)
      const anonymousLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const algoToAnon = new Map<PathAlgorithm, string>();
      const anonToAlgo = new Map<string, PathAlgorithm>();

      algorithms.forEach((algo, idx) => {
        const label = anonymousLabels[idx];
        algoToAnon.set(algo, label);
        anonToAlgo.set(label, algo);
      });

      // Prepare data for each algorithm
      // Build option data with coordinates + path stability
      // For large formations (10+ dancers), sample path points to prevent API limits
      const MAX_PATH_POINTS = 10; // Max points per path (including start, middle, end)

      // Use sorted algorithms order for consistent presentation
      const optionData = algorithms.map((algo) => {
        const paths = allPaths.get(algo)!;
        const anonLabel = algoToAnon.get(algo)!;

        // Calculate path stability
        const stability = calculatePathStability(paths);

        // Extract dancer coordinates (sampled to limit data size)
        const allDancerPaths = paths.map((dancerPath, dancerIdx) => {
          const fullPath = dancerPath.path;
          let sampledPath = fullPath;

          // Sample evenly if path is longer than MAX_PATH_POINTS
          if (fullPath.length > MAX_PATH_POINTS) {
            sampledPath = [];
            for (let i = 0; i < MAX_PATH_POINTS; i++) {
              const idx = Math.floor(i * (fullPath.length - 1) / (MAX_PATH_POINTS - 1));
              sampledPath.push(fullPath[idx]);
            }
          }

          return {
            dancer: dancerIdx + 1,
            path: sampledPath.map(point => ({
              t: Math.round(point.t * 10) / 10,
              x: Math.round(point.x * 10) / 10,
              y: Math.round(point.y * 10) / 10,
            })),
          };
        });

        return {
          option: anonLabel,
          // Path stability: safe deviation distance for each dancer (m)
          pathStability: {
            minClearance: stability.minClearance,        // Minimum distance between dancers
            deviationTolerance: stability.deviationTolerance, // Allowed deviation
          },
          dancerPaths: allDancerPaths,
        };
      });

      // Calculate deterministic scores for each algorithm
      const deterministicScores = new Map<PathAlgorithm, { score: number; breakdown: { efficiency: number; safety: number; directness: number; synchronization: number } }>();
      for (const algo of algorithms) {
        const paths = allPaths.get(algo)!;
        const scoreData = calculateDeterministicScore(paths);
        deterministicScores.set(algo, scoreData);
      }

      // Find best algorithm based on deterministic score
      let bestAlgo = algorithms[0];
      let bestScore = 0;
      for (const [algo, scoreData] of deterministicScores.entries()) {
        if (scoreData.score > bestScore) {
          bestScore = scoreData.score;
          bestAlgo = algo;
        }
      }

      // Generate visualization images (in same sorted order)
      const images: GeminiImageData[] = [];
      for (const algo of algorithms) {
        const paths = allPaths.get(algo)!;
        const label = algoToAnon.get(algo)!;
        const base64 = generatePathVisualization(paths, stageWidth, stageHeight, label);
        if (base64) {
          images.push({ base64, mimeType: 'image/png' });
        }
      }

      // Gemini prompt - ask for scores and brief reasons
      const prompt = `You are a professional choreographer evaluating dancer movement paths.

## Stage Info
- Size: ${stageWidth}m x ${stageHeight}m
- Duration: ${totalCounts} counts
- Dancers: ${allPaths.get(algorithms[0])?.length || 0}

## Path Options (${algorithms.length} total)
${JSON.stringify(optionData, null, 2)}

## Attached Images
Visualization of each path option (A, B, C, etc.)

## Evaluation Criteria (in priority order)
1. **Safety (40%)**: Minimum 0.5m clearance between dancers at all times. Penalize any near-collisions heavily.
2. **Path Cleanliness (30%)**: Prefer straight lines or gentle curves. Penalize sharp turns, zigzags, or unnecessarily curved paths.
3. **Efficiency (20%)**: Shorter total travel distance is better. No detours or backtracking.
4. **Timing (10%)**: Dancers should arrive smoothly, not all bunched at the end.

## Scoring Guide
- 90-100: Excellent - clean straight/gentle paths, safe spacing, efficient
- 75-89: Good - mostly clean with minor issues
- 60-74: Acceptable - noticeable curves or timing issues
- Below 60: Poor - excessive curves, near-collisions, or inefficient

## Task
Score each option 0-100 based on the weighted criteria above.

## Response Format (JSON only)
{
  "rankings": {
    "A": { "score": 85, "reason": "Brief one-line reason" },
    "B": { "score": 72, "reason": "Brief one-line reason" }
  },
  "best": "A"
}`;

      // Use temperature 0 for consistent scoring
      const response = await callGeminiAPIWithImages(prompt, images, { temperature: 0 });

      // Build breakdowns map from deterministic scores (for display)
      const breakdowns = new Map<PathAlgorithm, ScoreBreakdown>();
      for (const [algo, scoreData] of deterministicScores.entries()) {
        breakdowns.set(algo, scoreData.breakdown);
      }

      // Parse Gemini response for scores and reasons
      const scores = new Map<PathAlgorithm, number>();
      const insights = new Map<PathAlgorithm, string>();
      let geminiBestAlgo: PathAlgorithm | null = null;

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);

          // Extract scores and reasons from Gemini response
          for (const [anonLabel, data] of Object.entries(result.rankings || {})) {
            const algo = anonToAlgo.get(anonLabel);
            if (algo && typeof data === 'object' && data !== null) {
              const rankData = data as { score?: number; reason?: string };
              if (typeof rankData.score === 'number') {
                scores.set(algo, Math.round(rankData.score));
              }
              if (typeof rankData.reason === 'string') {
                insights.set(algo, rankData.reason);
              }
            }
          }

          // Get Gemini's best pick
          if (result.best && anonToAlgo.has(result.best)) {
            geminiBestAlgo = anonToAlgo.get(result.best)!;
          }
        } catch {
          console.warn('Failed to parse Gemini response, using deterministic scores');
        }
      }

      // Fallback to deterministic scores if Gemini parsing failed
      if (scores.size === 0) {
        for (const [algo, scoreData] of deterministicScores.entries()) {
          scores.set(algo, scoreData.score);
        }
      }

      // Fill in missing scores/insights
      for (const algo of algorithms) {
        if (!scores.has(algo)) {
          scores.set(algo, deterministicScores.get(algo)?.score || 70);
        }
        if (!insights.has(algo)) {
          insights.set(algo, 'No additional insights available');
        }
      }

      // Determine best algorithm (prefer Gemini's pick, fallback to highest score)
      let finalBestAlgo = geminiBestAlgo || bestAlgo;
      let finalBestScore = scores.get(finalBestAlgo) || bestScore;

      // If Gemini didn't pick, use highest score from Gemini's scores
      if (!geminiBestAlgo) {
        for (const [algo, score] of scores.entries()) {
          if (score > finalBestScore) {
            finalBestScore = score;
            finalBestAlgo = algo;
          }
        }
      }

      // Store result with Gemini's pick and scores
      const transitionResult: PathEvaluationResult = {
        pick: finalBestAlgo,
        scores,
        breakdowns,
        insights,
        pickReason: insights.get(finalBestAlgo) || `Score: ${finalBestScore}/100`,
      };

      setGeminiResults(prev => {
        const newMap = new Map(prev);
        newMap.set(transitionKey, transitionResult);
        return newMap;
      });

      showToast(`Gemini's Pick: ${PATH_ALGORITHM_LABELS[finalBestAlgo]} (Score: ${finalBestScore})`, 'success', 5000);
    } catch (error) {
      console.error('Gemini ranking failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        showToast('Gemini ranking timeout - try with fewer dancers', 'error', 5000);
      } else if (errorMessage.includes('413') || errorMessage.includes('too large')) {
        showToast('Request too large - path data exceeded limit', 'error', 5000);
      } else {
        showToast(`Gemini ranking failed: ${errorMessage.slice(0, 50)}`, 'error', 5000);
      }
    } finally {
      setIsRankingWithGemini(false);
      setRankingTransitionKey(null);
    }
  }, [showToast, generatePathVisualization, calculateDeterministicScore, calculatePathStability, arePathsIdentical]);

  // Generate paths for current formation - ALL ALGORITHMS
  const handleGeneratePaths = useCallback(async () => {
    if (!selectedFormation) return;

    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) {
      alert('Select a formation that has a next formation to generate paths.');
      return;
    }

    setIsGeneratingPaths(true);

    const currentFormation = project.formations[currentIndex];
    const nextFormation = project.formations[currentIndex + 1];
    const pathKey = `${currentFormation.id}->${nextFormation.id}`;

    const allAlgorithms: PathAlgorithm[] = [
      'natural_curves',  // Default first
      'clean_flow',
      'wave_sync',
      'perfect_sync',
      'balanced_direct',
      'harmonized_flow',
    ];

    try {
      const algorithmPaths = new Map<PathAlgorithm, GeneratedPath[]>();

      for (let i = 0; i < allAlgorithms.length; i++) {
        const algo = allAlgorithms[i];
        setPathGenerationStatus(`Generating paths (${i + 1}/${allAlgorithms.length}): ${PATH_ALGORITHM_LABELS[algo]}...`);

        const paths = await generatePathsForTransition(currentFormation, nextFormation, algo);
        algorithmPaths.set(algo, paths);
      }

      // Store all algorithm paths
      setAllAlgorithmPaths(prev => {
        const newMap = new Map(prev);
        newMap.set(pathKey, algorithmPaths);
        return newMap;
      });

      // Set default algorithm
      setPathAlgorithm('natural_curves');

      setPathGenerationStatus('All paths generated! Select algorithm then generate cue sheet.');
      setTimeout(() => setPathGenerationStatus(null), 3000);

      // Start Gemini ranking in background
      rankPathsWithGemini(algorithmPaths, project.stageWidth, project.stageHeight, currentFormation.duration, pathKey);
    } catch (error) {
      console.error('Path generation failed:', error);
      setPathGenerationStatus('Path generation failed');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingPaths(false);
    }
  }, [selectedFormation, selectedFormationId, project.formations, generatePathsForTransition, project.stageWidth, project.stageHeight, showToast, rankPathsWithGemini]);

  // Generate all paths for playback (generates all algorithms for each transition)
  const generateAllPaths = useCallback(async () => {
    if (project.formations.length < 2) return;

    setIsGeneratingPaths(true);
    setPathGenerationStatus('Generating all movement paths...');

    const allAlgorithms: PathAlgorithm[] = [
      'natural_curves',
      'clean_flow',
      'wave_sync',
      'perfect_sync',
      'balanced_direct',
      'harmonized_flow',
    ];

    try {
      const newAllPaths = new Map(allAlgorithmPaths);

      for (let i = 0; i < project.formations.length - 1; i++) {
        const current = project.formations[i];
        const next = project.formations[i + 1];
        const pathKey = `${current.id}->${next.id}`;

        // Skip if already generated
        if (newAllPaths.has(pathKey) && (newAllPaths.get(pathKey)?.size || 0) > 0) {
          continue;
        }

        setPathGenerationStatus(`Generating paths for Formation ${i + 1} → ${i + 2}...`);

        const algorithmPaths = new Map<PathAlgorithm, GeneratedPath[]>();
        for (const algo of allAlgorithms) {
          const paths = await generatePathsForTransition(current, next, algo);
          algorithmPaths.set(algo, paths);
        }
        newAllPaths.set(pathKey, algorithmPaths);
      }

      setAllAlgorithmPaths(newAllPaths);
      setPathGenerationStatus(null);
    } catch (error) {
      console.error('Path generation failed:', error);
      setPathGenerationStatus('Path generation failed');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingPaths(false);
    }
  }, [project.formations, allAlgorithmPaths, generatePathsForTransition]);

  // Generate all paths and rank with Gemini
  const generateAllPathsWithRanking = useCallback(async () => {
    if (project.formations.length < 2) {
      showToast('Need at least 2 formations to generate paths', 'error');
      return;
    }

    setIsGeneratingPaths(true);
    setPathGenerationStatus('Starting path generation...');

    const allAlgorithms: PathAlgorithm[] = [
      'natural_curves',
      'clean_flow',
      'wave_sync',
      'perfect_sync',
      'balanced_direct',
      'harmonized_flow',
    ];

    try {
      const totalTransitions = project.formations.length - 1;

      // Process each transition incrementally (generate paths + rank immediately)
      for (let i = 0; i < totalTransitions; i++) {
        const current = project.formations[i];
        const next = project.formations[i + 1];
        const pathKey = `${current.id}->${next.id}`;

        // Check if already generated and ranked
        const existingPaths = allAlgorithmPaths.get(pathKey);
        const alreadyGenerated = existingPaths && existingPaths.size > 0;
        const alreadyRanked = geminiResults.has(pathKey);

        if (alreadyGenerated && alreadyRanked) {
          continue; // Skip this transition entirely
        }

        // Step 1: Generate paths for this transition (if not already done)
        let algorithmPaths: Map<PathAlgorithm, GeneratedPath[]>;
        if (alreadyGenerated) {
          algorithmPaths = existingPaths;
        } else {
          setPathGenerationStatus(`Generating paths (${i + 1}/${totalTransitions})...`);

          algorithmPaths = new Map<PathAlgorithm, GeneratedPath[]>();
          for (const algo of allAlgorithms) {
            const paths = await generatePathsForTransition(current, next, algo);
            algorithmPaths.set(algo, paths);
          }

          // Update state immediately so UI shows progress
          setAllAlgorithmPaths(prev => {
            const updated = new Map(prev);
            updated.set(pathKey, algorithmPaths);
            return updated;
          });

          // Yield to event loop to allow React to re-render
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Step 2: Rank with Gemini for this transition (if not already done)
        if (!alreadyRanked) {
          setPathGenerationStatus(`Ranking with Gemini (${i + 1}/${totalTransitions})...`);
          await rankPathsWithGemini(algorithmPaths, project.stageWidth, project.stageHeight, current.duration, pathKey);

          // Yield to event loop to allow React to re-render after Gemini ranking
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      setPathGenerationStatus(null);
      showToast('✓ All paths generated!', 'success', 5000);

    } catch (error) {
      console.error('Generation failed:', error);
      setPathGenerationStatus('Generation failed');
      showToast('Generation failed. Check console for details.', 'error');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingPaths(false);
    }
  }, [project.formations, project.stageWidth, project.stageHeight, allAlgorithmPaths, generatePathsForTransition, showToast, geminiResults, rankPathsWithGemini]);

  // Generate cue sheets based on user-selected paths (or Gemini's pick as fallback)
  const generateAllCueSheets = useCallback(async () => {
    if (project.formations.length < 2) {
      showToast('Need at least 2 formations to generate cue sheets', 'error');
      return;
    }

    // Check if paths exist
    const totalTransitions = project.formations.length - 1;
    let hasAllPaths = true;
    for (let i = 0; i < totalTransitions; i++) {
      const current = project.formations[i];
      const next = project.formations[i + 1];
      const pathKey = `${current.id}->${next.id}`;
      if (!allAlgorithmPaths.has(pathKey) || (allAlgorithmPaths.get(pathKey)?.size || 0) === 0) {
        hasAllPaths = false;
        break;
      }
    }

    if (!hasAllPaths) {
      showToast('Please generate paths first', 'error');
      return;
    }

    setIsGeneratingCueSheet(true);
    setPathGenerationStatus('Generating cue sheets...');

    try {
      // Collect all paths for cue sheet generation
      const allDancerPaths: Array<{
        dancerId: number;
        path: { x: number; y: number; t: number }[];
        startTime: number;
        speed: number;
        totalDistance: number;
      }> = [];

      for (let i = 0; i < totalTransitions; i++) {
        const current = project.formations[i];
        const next = project.formations[i + 1];
        const pathKey = `${current.id}->${next.id}`;
        const transitionPaths = allAlgorithmPaths.get(pathKey);

        if (transitionPaths) {
          // Priority: 1. User-selected algorithm, 2. Gemini's pick, 3. natural_curves
          const userSelected = userSelectedAlgorithms.get(pathKey);
          const geminiPick = geminiResults.get(pathKey)?.pick;
          const selectedAlgo = userSelected || geminiPick || 'natural_curves';

          const selectedPaths = transitionPaths.get(selectedAlgo) ||
            transitionPaths.get('natural_curves') ||
            Array.from(transitionPaths.values())[0];

          if (selectedPaths) {
            const transitionStartCount = current.startCount + current.duration;
            selectedPaths.forEach((p: GeneratedPath) => {
              allDancerPaths.push({
                dancerId: p.dancerId,
                path: p.path.map((pt: { x: number; y: number; t: number }) => ({
                  ...pt,
                  t: pt.t + transitionStartCount,
                })),
                startTime: transitionStartCount,
                speed: 1,
                totalDistance: p.path.reduce((acc: number, point: { x: number; y: number }, idx: number, arr: { x: number; y: number }[]) => {
                  if (idx === 0) return 0;
                  const prev = arr[idx - 1];
                  return acc + Math.sqrt((point.x - prev.x) ** 2 + (point.y - prev.y) ** 2);
                }, 0),
              });
            });
          }
        }
      }

      // Merge paths by dancer ID
      const mergedPaths = new Map<number, typeof allDancerPaths[0]>();
      allDancerPaths.forEach(dp => {
        const existing = mergedPaths.get(dp.dancerId);
        if (existing) {
          existing.path = [...existing.path, ...dp.path];
          existing.totalDistance += dp.totalDistance;
        } else {
          mergedPaths.set(dp.dancerId, { ...dp });
        }
      });

      const lastFormation = project.formations[project.formations.length - 1];
      const totalCounts = lastFormation.startCount + lastFormation.duration;

      const cueSheetResult = await generateCueSheet(
        Array.from(mergedPaths.values()),
        {
          stageWidth: project.stageWidth,
          stageHeight: project.stageHeight,
          totalCounts,
          language: 'en',
          includeRelativePositioning: true,
          includeArtisticNuance: true,
        }
      );

      setCueSheet(cueSheetResult);
      // Track which algorithm was used (for single transition, show specific; for multiple, show 'mixed')
      if (totalTransitions === 1) {
        const pathKey = `${project.formations[0].id}->${project.formations[1].id}`;
        const userSelected = userSelectedAlgorithms.get(pathKey);
        const geminiPick = geminiResults.get(pathKey)?.pick;
        setCueSheetAlgorithm(userSelected || geminiPick || 'natural_curves');
      } else {
        setCueSheetAlgorithm(null); // Mixed algorithms for multiple transitions
      }
      setPathGenerationStatus(null);
      showToast('✓ Cue sheets generated!', 'success', 5000);

    } catch (error) {
      console.error('Cue sheet generation failed:', error);
      setPathGenerationStatus('Cue sheet generation failed');
      showToast('Cue sheet generation failed. Check console for details.', 'error');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingCueSheet(false);
    }
  }, [project.formations, project.stageWidth, project.stageHeight, allAlgorithmPaths, userSelectedAlgorithms, geminiResults, showToast]);

  // Get paths for current formation using selected algorithm
  const getCurrentPaths = useCallback(() => {
    if (!selectedFormation) return null;

    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) return null;

    const nextFormation = project.formations[currentIndex + 1];
    const pathKey = `${selectedFormation.id}->${nextFormation.id}`;

    return getPathsForAlgorithm(pathKey, pathAlgorithm);
  }, [selectedFormation, selectedFormationId, project.formations, getPathsForAlgorithm, pathAlgorithm]);

  const currentPaths = getCurrentPaths();
  const hasNextFormation = selectedFormation && project.formations.findIndex(f => f.id === selectedFormationId) < project.formations.length - 1;

  // Compute current transition info for UI display
  const currentTransitionInfo = useMemo(() => {
    if (!selectedFormation) return null;
    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) return null;

    const current = project.formations[currentIndex];
    const next = project.formations[currentIndex + 1];
    const pathKey = `${current.id}->${next.id}`;
    const currentLabel = current.label || String(currentIndex + 1);
    const nextLabel = next.label || String(currentIndex + 2);

    return { pathKey, currentLabel, nextLabel, currentIndex, nextIndex: currentIndex + 1 };
  }, [selectedFormation, selectedFormationId, project.formations]);

  // Get Gemini results for current transition
  const currentGeminiResult = currentTransitionInfo ? geminiResults.get(currentTransitionInfo.pathKey) : null;
  const isCurrentTransitionRanking = Boolean(
    currentTransitionInfo &&
    isRankingWithGemini &&
    rankingTransitionKey === currentTransitionInfo.pathKey
  );

  // Get unique algorithms for current transition (filter out identical paths)
  const currentUniqueAlgorithms = useMemo(() => {
    if (!currentTransitionInfo) return ALGORITHM_PRIORITY;
    const algorithmPaths = allAlgorithmPaths.get(currentTransitionInfo.pathKey);
    return getUniqueAlgorithms(algorithmPaths);
  }, [currentTransitionInfo, allAlgorithmPaths, getUniqueAlgorithms]);

  // Track previous transition to detect when user navigates to different formation
  const prevTransitionKeyRef = useRef<string | null>(null);
  const prevGeminiPickRef = useRef<PathAlgorithm | null>(null);

  // Auto-switch to Gemini's pick only when:
  // 1. Transition changes (user navigates to different formation)
  // 2. Gemini results first arrive for current transition
  useEffect(() => {
    const currentKey = currentTransitionInfo?.pathKey || null;
    const geminiPick = currentGeminiResult?.pick || null;

    // Detect if transition changed
    const transitionChanged = currentKey !== prevTransitionKeyRef.current;
    // Detect if Gemini pick just arrived (was null, now has value)
    const geminiPickArrived = geminiPick && prevGeminiPickRef.current !== geminiPick;

    if (transitionChanged || geminiPickArrived) {
      // Auto-select Gemini's pick or first unique algorithm
      if (geminiPick && currentUniqueAlgorithms.includes(geminiPick)) {
        setPathAlgorithm(geminiPick);
      } else if (currentUniqueAlgorithms.length > 0 && !currentUniqueAlgorithms.includes(pathAlgorithm)) {
        setPathAlgorithm(currentUniqueAlgorithms[0]);
      }
    }

    // Update refs
    prevTransitionKeyRef.current = currentKey;
    prevGeminiPickRef.current = geminiPick;
  }, [currentTransitionInfo?.pathKey, currentUniqueAlgorithms, currentGeminiResult?.pick, pathAlgorithm]);

  // Check if all paths are generated (for any algorithm)
  const allPathsGenerated = project.formations.length < 2 ||
    project.formations.slice(0, -1).every((f, i) => {
      const next = project.formations[i + 1];
      const pathKey = `${f.id}->${next.id}`;
      return allAlgorithmPaths.has(pathKey) && (allAlgorithmPaths.get(pathKey)?.size || 0) > 0;
    });

  // Track completion status for each transition (for progress display)
  const transitionProgress = useMemo(() => {
    if (project.formations.length < 2) return [];

    return project.formations.slice(0, -1).map((f, i) => {
      const next = project.formations[i + 1];
      const pathKey = `${f.id}->${next.id}`;
      const hasPath = allAlgorithmPaths.has(pathKey) && (allAlgorithmPaths.get(pathKey)?.size || 0) > 0;
      const hasRanking = geminiResults.has(pathKey);
      return {
        index: i,
        label: `${i + 1}→${i + 2}`,
        pathKey,
        hasPath,
        hasRanking,
        complete: hasPath && hasRanking,
      };
    });
  }, [project.formations, allAlgorithmPaths, geminiResults]);

  // Change stage size - scale dancer positions proportionally
  const handleStageSizeChange = (width: number, height: number) => {
    saveToHistory();
    setProject(prev => {
      const scaleX = width / prev.stageWidth;
      const scaleY = height / prev.stageHeight;

      // Scale all dancer positions in all formations
      const scaledFormations = prev.formations.map(formation => ({
        ...formation,
        positions: formation.positions.map(pos => ({
          ...pos,
          position: {
            x: Math.max(0.5, Math.min(width - 0.5, pos.position.x * scaleX)),
            y: Math.max(0.5, Math.min(height - 0.5, pos.position.y * scaleY)),
          },
        })),
      }));

      return {
        ...prev,
        stageWidth: width,
        stageHeight: height,
        formations: scaledFormations,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Apply preset formation
  const handleApplyPreset = (preset: FormationPreset) => {
    if (!selectedFormation) return;

    const colors = [
      '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
      '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
      '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
      '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1', '#7B68EE', '#00CED1', '#D63384',
    ];

    // Apply preset to first N dancers, keep rest at current or exit positions
    const newPositions = selectedFormation.positions.map((currentPos, i) => {
      if (i < preset.positions.length) {
        // Apply preset position
        return {
          dancerId: i + 1,
          position: { x: preset.positions[i].x, y: preset.positions[i].y },
          color: colors[i % colors.length],
        };
      } else {
        // Keep current position (dancers not in preset stay where they are)
        return currentPos;
      }
    });

    updateFormation(selectedFormation.id, { positions: newPositions });
  };

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

  // Select formation and jump to it (for timeline clicks)
  const handleSelectFormation = useCallback((formationId: string) => {
    const formation = project.formations.find(f => f.id === formationId);
    if (formation) {
      setSelectedFormationId(formationId);
      setCurrentCount(formation.startCount);
      if (isPlaying) setIsPlaying(false);
    }
  }, [project.formations, isPlaying]);

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

    // Get generated paths for this transition using selected algorithm
    const pathKey = `${currentFormation.id}->${nextFormation.id}`;
    const paths = getPathsForAlgorithm(pathKey, pathAlgorithm);

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
  }, [isPlaying, project.formations, currentCount, selectedFormation, getPathsForAlgorithm, pathAlgorithm]);

  // Always use interpolated positions when paths exist (for scrubbing/playback)
  // When editing (currentCount is at formation start and not playing), show the editable positions
  const isAtFormationStart = selectedFormation &&
    Math.abs(currentCount - selectedFormation.startCount) < 0.1 && !isPlaying;
  const displayPositions = isAtFormationStart
    ? (selectedFormation?.positions || [])
    : getInterpolatedPositions();

  return (
    <div className={`timeline-editor ${uiMode === 'rehearsal' ? 'rehearsal-mode' : 'edit-mode'}`}>
      {/* Header - Edit mode only */}
      {uiMode === 'edit' && (
        <header className="timeline-header">
          <div className="header-left">
            <input
              type="text"
              className="project-name-input"
              value={project.name}
              onFocus={() => saveToHistory()}
              onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="header-center">
          <div className="header-control">
            <label>Dancers:</label>
            <input
              type="number"
              min={1}
              max={35}
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
          <div className="header-control">
            <label>Audience:</label>
            <button
              className={`audience-toggle-btn ${audienceAtTop ? 'top' : 'bottom'}`}
              onClick={() => setAudienceAtTop(!audienceAtTop)}
              title={audienceAtTop ? 'Audience at top of screen' : 'Audience at bottom of screen'}
            >
              {audienceAtTop ? '⬆ Top' : '⬇ Bottom'}
            </button>
          </div>
        </div>
        <div className="header-right">
          <button
            onClick={generateAllPathsWithRanking}
            className={`header-btn generate-all-btn ${isGeneratingPaths ? 'generating' : ''}`}
            disabled={isGeneratingPaths || isGeneratingCueSheet || project.formations.length < 2}
            title="Generate all movement paths"
          >
            {isGeneratingPaths ? (
              <>
                <span className="loading-spinner small" />
                Generating...
              </>
            ) : (
              'Generate All Paths'
            )}
          </button>
          <button
            onClick={generateAllCueSheets}
            className={`header-btn generate-all-btn ${isGeneratingCueSheet ? 'generating' : ''}`}
            disabled={isGeneratingPaths || isGeneratingCueSheet || project.formations.length < 2}
            title="Generate cue sheets for all transitions"
          >
            {isGeneratingCueSheet ? (
              <>
                <span className="loading-spinner small" />
                Generating...
              </>
            ) : (
              'Generate Cue Sheet'
            )}
          </button>
          {/* Transition progress indicator */}
          {transitionProgress.length > 0 && (
            <div className="transition-progress" title="Transition completion status">
              {transitionProgress.map((t) => (
                <span
                  key={t.pathKey}
                  className={`progress-dot ${t.complete ? 'complete' : t.hasPath ? 'partial' : 'pending'}`}
                  title={`${t.label}: ${t.complete ? 'Complete' : t.hasPath ? 'Paths ready' : 'Pending'}`}
                >
                  {t.complete ? '✓' : t.hasPath ? '◐' : '○'}
                </span>
              ))}
            </div>
          )}
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
      )}

      {/* Rehearsal Mode Header */}
      {uiMode === 'rehearsal' && (
        <header className="rehearsal-header">
          <div className="rehearsal-title">
            <h2>🎭 {project.name}</h2>
            <span className="rehearsal-badge">Rehearsal Mode</span>
          </div>
          <div className="rehearsal-controls">
            <button
              className={`play-btn ${isPlaying ? 'playing' : ''}`}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>
            <button
              className={`metronome-toggle-btn ${metronomeEnabled ? 'active' : ''}`}
              onClick={() => setMetronomeEnabled(!metronomeEnabled)}
              title={metronomeEnabled ? 'Metronome ON' : 'Metronome OFF'}
            >
              {metronomeEnabled ? '🔔' : '🔕'}
            </button>
            <span className="count-badge">Count: {Math.floor(currentCount)}</span>
            <button
              className="mode-toggle-btn"
              onClick={() => setUiMode('edit')}
            >
              ✏️ Edit Mode
            </button>
          </div>
        </header>
      )}

      {/* Main content */}
      <div className="timeline-main">
        {/* Left Panel - Formation Presets (Edit mode only) */}
        {uiMode === 'edit' && (
        <div className="presets-panel">
          <h3>Formation Presets</h3>
          <div className="preset-filter">
            <label>Filter:</label>
            <select
              value={presetFilter}
              onChange={(e) => setPresetFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
              className="preset-filter-select"
            >
              <option value="all">All ({ALL_PRESETS.length})</option>
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map(count => {
                const countPresets = FORMATION_PRESETS.get(count) || [];
                return (
                  <option key={count} value={count}>{count}P ({countPresets.length})</option>
                );
              })}
            </select>
          </div>
          <div className="preset-grid">
            {ALL_PRESETS
              .filter(preset => presetFilter === 'all' || preset.dancerCount === presetFilter)
              .map((preset, idx) => (
                <PresetPreview
                  key={`${preset.dancerCount}-${preset.name}-${idx}`}
                  preset={preset}
                  onClick={() => handleApplyPreset(preset)}
                  audienceAtTop={audienceAtTop}
                />
              ))}
          </div>
        </div>
        )}

        {/* Center - Stage view */}
        <div className={`stage-panel ${uiMode === 'rehearsal' ? 'stage-panel-fullwidth' : ''}`}>
          <div className="stage-header">
            <h3>{selectedFormation?.label || `Formation ${selectedFormation ? project.formations.indexOf(selectedFormation) + 1 : '-'}`}</h3>
            <span className="count-display">Count: {Math.floor(currentCount)}</span>
            {/* POV (Point of View) Selector */}
            <div className="pov-selector">
              <label>POV:</label>
              <select
                value={typeof povMode === 'number' ? `dancer-${povMode}` : povMode}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'choreographer') {
                    setPovMode('choreographer');
                  } else if (value.startsWith('dancer-')) {
                    setPovMode(parseInt(value.replace('dancer-', ''), 10));
                  }
                }}
                className="pov-select"
              >
                <option value="choreographer">Choreographer</option>
                {selectedFormation?.positions.map((pos) => (
                  <option key={pos.dancerId} value={`dancer-${pos.dancerId}`}>
                    Dancer {pos.dancerId}
                  </option>
                ))}
              </select>
            </div>
            {/* Mode Toggle Button */}
            {uiMode === 'edit' && (
              <button
                className="mode-toggle-btn rehearsal-btn"
                onClick={() => setUiMode('rehearsal')}
                title="Switch to Rehearsal Mode"
              >
                🎭 Rehearsal
              </button>
            )}
          </div>

          {/* Choreographer POV: General Notes above stage (Rehearsal mode only) */}
          {uiMode === 'rehearsal' && povMode === 'choreographer' && cueSheet && cueSheet.generalNotes && cueSheet.generalNotes.length > 0 && (
            <div className="pov-cue-sheet pov-general-notes">
              <div className="pov-cue-card">
                <div className="pov-cue-header">
                  <span className="pov-dancer-label">👁️ General Notes</span>
                </div>
                <div className="pov-cue-list">
                  {cueSheet.generalNotes.map((note, i) => (
                    <div key={i} className="pov-cue-item">
                      <span className="pov-cue-instruction">{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Individual Dancer Cue Sheet (POV mode) - Shows above stage (Rehearsal mode only) */}
          {uiMode === 'rehearsal' && typeof povMode === 'number' && cueSheet && (
            <div className="pov-cue-sheet">
              {cueSheet.dancers
                .filter((dancer: DancerCueSheet) => dancer.dancerId === povMode)
                .map((dancer: DancerCueSheet) => (
                  <div key={dancer.dancerId} className="pov-cue-card">
                    <div className="pov-cue-header">
                      <span className="pov-dancer-label">🎯 {dancer.dancerLabel}</span>
                      <span className="pov-dancer-summary">{dancer.summary}</span>
                    </div>
                    <div className="pov-cue-list">
                      {dancer.cues.map((cue, i) => {
                        // Parse timeRange like "0~4" or "0~4 count" to check if current
                        const timeMatch = cue.timeRange.match(/(\d+)~(\d+)/);
                        const isCurrentCue = timeMatch
                          ? currentCount >= parseInt(timeMatch[1]) && currentCount < parseInt(timeMatch[2])
                          : false;
                        return (
                          <div key={i} className={`pov-cue-item ${isCurrentCue ? 'pov-cue-active' : ''}`}>
                            <span className="pov-cue-time">{cue.timeRange}</span>
                            <span className="pov-cue-instruction">{cue.instruction}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}

          <Stage
            stageWidth={project.stageWidth}
            stageHeight={project.stageHeight}
            scale={scale}
            svgRef={svgRef}
            onMouseDown={uiMode === 'edit' ? handleStageMouseDown : undefined}
            onMouseMove={uiMode === 'edit' ? handleMouseMove : undefined}
            onMouseUp={uiMode === 'edit' ? handleMouseUp : undefined}
            onMouseLeave={uiMode === 'edit' ? handleMouseUp : undefined}
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
              {audienceAtTop ? 'FRONT (Audience)' : 'BACK'}
            </text>
            <text
              x={PADDING + (project.stageWidth / 2) * scale}
              y={PADDING + project.stageHeight * scale + 16}
              textAnchor="middle"
              fill="rgba(255, 255, 255, 0.3)"
              fontSize="10"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {audienceAtTop ? 'BACK' : 'FRONT (Audience)'}
            </text>

            {/* Movement Paths */}
            {showPaths && currentPaths && currentPaths.map((pathData) => {
              const dancer = displayPositions.find(d => d.dancerId === pathData.dancerId);
              const color = dancer?.color || '#888';
              const path = pathData.path;

              if (!path || path.length < 2) return null;

              // POV highlighting for paths
              const isPovPath = typeof povMode === 'number' && povMode === pathData.dancerId;
              const isPathDimmed = typeof povMode === 'number' && povMode !== pathData.dancerId;
              const pathOpacity = isPathDimmed ? 0.2 : (isPovPath ? 1 : 0.6);
              const pathStrokeWidth = isPovPath ? 4 : 2;

              // Create SVG path from points
              const pathPoints = path.map(p => stageToScreen({ x: p.x, y: p.y }, scale, project.stageHeight, audienceAtTop));
              const pathD = pathPoints.reduce((acc, p, i) => {
                if (i === 0) return `M ${p.x} ${p.y}`;
                return `${acc} L ${p.x} ${p.y}`;
              }, '');

              const startScreen = pathPoints[0];
              const endScreen = pathPoints[pathPoints.length - 1];

              return (
                <g key={`path-${pathData.dancerId}`}>
                  {/* POV glow effect */}
                  {isPovPath && (
                    <path
                      d={pathD}
                      stroke="#FFD700"
                      strokeWidth={8}
                      fill="none"
                      opacity={0.3}
                      style={{ pointerEvents: 'none', filter: 'blur(4px)' }}
                    />
                  )}
                  {/* Path curve */}
                  <path
                    d={pathD}
                    stroke={isPovPath ? '#FFD700' : color}
                    strokeWidth={pathStrokeWidth}
                    strokeDasharray={isPovPath ? 'none' : '6,3'}
                    fill="none"
                    opacity={pathOpacity}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Arrow head at end */}
                  <circle
                    cx={endScreen.x}
                    cy={endScreen.y}
                    r={isPovPath ? 8 : 6}
                    fill={isPovPath ? '#FFD700' : color}
                    opacity={isPathDimmed ? 0.3 : 0.8}
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Start marker (hollow) */}
                  <circle
                    cx={startScreen.x}
                    cy={startScreen.y}
                    r={isPovPath ? 8 : 6}
                    fill="none"
                    stroke={isPovPath ? '#FFD700' : color}
                    strokeWidth={isPovPath ? 3 : 2}
                    opacity={isPathDimmed ? 0.3 : 0.8}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })}

            {/* Dancers */}
            {displayPositions.map((dancer) => {
              const screenPos = stageToScreen(dancer.position, scale, project.stageHeight, audienceAtTop);
              const isPovDancer = typeof povMode === 'number' && povMode === dancer.dancerId;
              const isDimmed = typeof povMode === 'number' && povMode !== dancer.dancerId;
              return (
                <DancerCircle
                  key={dancer.dancerId}
                  id={dancer.dancerId}
                  x={screenPos.x}
                  y={screenPos.y}
                  radius={0.4 * scale}
                  color={dancer.color}
                  isSelected={uiMode === 'edit' && selectedDancers.has(dancer.dancerId)}
                  isPovHighlight={isPovDancer}
                  isDimmed={isDimmed}
                  onMouseDown={uiMode === 'edit' ? (e) => handleDancerMouseDown(dancer.dancerId, e) : undefined}
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

        {/* Properties panel (Edit mode only) */}
        {uiMode === 'edit' && (
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
                  placeholder={`Formation ${project.formations.findIndex(f => f.id === selectedFormation.id) + 1}`}
                />
              </div>
              <div className="property-row">
                <label>Duration</label>
                <select
                  value={selectedFormation.duration}
                  onChange={(e) => updateFormation(selectedFormation.id, { duration: parseInt(e.target.value, 10) })}
                >
                  <option value={1}>1 count</option>
                  <option value={2}>2 counts</option>
                  <option value={3}>3 counts</option>
                  <option value={4}>4 counts</option>
                  <option value={5}>5 counts</option>
                  <option value={6}>6 counts</option>
                  <option value={7}>7 counts</option>
                  <option value={8}>8 counts</option>
                </select>
              </div>
              <div className="property-row">
                <label>Start Count</label>
                <span className="property-value">{selectedFormation.startCount}</span>
              </div>

              {/* Quick actions */}
              <div className="formation-actions">
                <button
                  className="action-btn exit-all-btn"
                  onClick={() => {
                    saveToHistory();
                    updateFormation(selectedFormation.id, {
                      positions: selectedFormation.positions.map(pos => {
                        const exitPos = calculateOptimalExitPosition(pos.position, project.stageWidth, project.stageHeight);
                        return { ...pos, position: exitPos };
                      }),
                    });
                  }}
                  title="Move all dancers to nearest exit zone"
                >
                  🚪 Exit All
                </button>
              </div>

              {/* Path generation section */}
              <div className="path-section">
                <h4>Movement Paths</h4>
                {/* Show current transition context */}
                {currentTransitionInfo && (
                  <div className="transition-context">
                    Formation {currentTransitionInfo.currentLabel} → Formation {currentTransitionInfo.nextLabel}
                  </div>
                )}

                {/* Algorithm cards - show all available paths */}
                {currentUniqueAlgorithms.length > 0 && (
                  <div className="algorithm-cards">
                    <div className="algorithm-cards-header">
                      <span className="paths-ready-label">
                        {currentUniqueAlgorithms.length} paths ready
                        {isCurrentTransitionRanking && ' · Gemini evaluating...'}
                      </span>
                    </div>
                    <div className="algorithm-cards-grid">
                      {currentUniqueAlgorithms.map((algo) => {
                        const isSelected = pathAlgorithm === algo;
                        const isGeminiPick = currentGeminiResult?.pick === algo;
                        const score = currentGeminiResult?.scores?.get(algo);

                        return (
                          <div
                            key={algo}
                            className={`algorithm-card ${isSelected ? 'selected' : ''} ${isGeminiPick ? 'gemini-pick' : ''}`}
                            onClick={() => {
                              if (!isGeneratingPaths) {
                                setPathAlgorithm(algo);
                                // Save user selection for this transition
                                if (currentTransitionInfo) {
                                  setUserSelectedAlgorithms(prev => {
                                    const updated = new Map(prev);
                                    updated.set(currentTransitionInfo.pathKey, algo);
                                    return updated;
                                  });
                                }
                              }
                            }}
                          >
                            <div className="algorithm-card-name">
                              {PATH_ALGORITHM_LABELS[algo]}
                            </div>
                            {score !== undefined && (
                              <div className="algorithm-card-score">{score}</div>
                            )}
                            {isGeminiPick && (
                              <div className="algorithm-card-badge">★ Best</div>
                            )}
                            {isSelected && !isGeminiPick && (
                              <div className="algorithm-card-check">✓</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {isCurrentTransitionRanking && (
                      <div className="gemini-evaluating-hint">
                        <span className="loading-spinner small" />
                        <span>Click any card to preview while Gemini evaluates</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Gemini evaluation display - show for current transition */}
                {currentGeminiResult && !isCurrentTransitionRanking && (
                  <div className="gemini-scores">
                    <details open>
                      <summary>Gemini Evaluation</summary>
                      {/* Best pick reason */}
                      {currentGeminiResult.pickReason && (
                        <div className="gemini-pick-reason">
                          <strong>Gemini's Pick:</strong> {PATH_ALGORITHM_LABELS[currentGeminiResult.pick]} - {currentGeminiResult.pickReason}
                        </div>
                      )}
                      <div className="score-list">
                        {Array.from(currentGeminiResult.scores.entries())
                          .filter(([algo]) => currentUniqueAlgorithms.includes(algo))
                          .sort((a, b) => b[1] - a[1])
                          .map(([algo, score]) => (
                            <div
                              key={algo}
                              className={`score-item ${algo === currentGeminiResult.pick ? 'pick' : ''} ${algo === pathAlgorithm ? 'selected' : ''}`}
                              onClick={() => setPathAlgorithm(algo)}
                            >
                              <div className="score-item-header">
                                <span className="algo-name">{PATH_ALGORITHM_LABELS[algo]}</span>
                                <span className="algo-score">{score}</span>
                                {algo === currentGeminiResult.pick && <span className="pick-star">★</span>}
                              </div>
                              {/* Gemini insight */}
                              {currentGeminiResult.insights?.get(algo) && (
                                <div className="algo-insight">{currentGeminiResult.insights.get(algo)}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    </details>
                  </div>
                )}

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

                    {currentPaths && (
                      <div className="path-status-row">
                        <span className="path-status">
                          ✓ Paths generated ({PATH_ALGORITHM_LABELS[pathAlgorithm]})
                          {isGeneratingPaths ? ' · Generating remaining transitions...' : ''}
                        </span>
                        {/* Cue sheet status */}
                        {cueSheet ? (
                          <button
                            className="view-cue-sheet-btn"
                            onClick={() => setShowCueSheet(true)}
                          >
                            View Cue Sheet ({cueSheetAlgorithm ? PATH_ALGORITHM_LABELS[cueSheetAlgorithm] : 'Mixed'})
                          </button>
                        ) : (
                          <button
                            className="generate-cue-sheet-btn"
                            onClick={generateAllCueSheets}
                            disabled={isGeneratingCueSheet}
                          >
                            {isGeneratingCueSheet ? 'Generating...' : 'Generate Cue Sheet'}
                          </button>
                        )}
                      </div>
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

            </>
          ) : (
            <p className="no-selection">No formation selected</p>
          )}
        </div>
        )}
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
        <button
          className={`metronome-toggle-btn ${metronomeEnabled ? 'active' : ''}`}
          onClick={() => setMetronomeEnabled(!metronomeEnabled)}
          title={metronomeEnabled ? 'Metronome ON' : 'Metronome OFF'}
        >
          {metronomeEnabled ? '🔔' : '🔕'}
        </button>
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
            max={40}
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value, 10))}
          />
          <span className="zoom-level">{zoom >= 30 ? '1ct' : zoom >= 20 ? '2ct' : zoom >= 12 ? '4ct' : '8ct'}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="timeline-panel">
        <Timeline
          project={project}
          selectedFormationId={selectedFormationId}
          currentCount={currentCount}
          zoom={zoom}
          onSelectFormation={handleSelectFormation}
          onUpdateFormation={updateFormation}
          onDeleteFormation={deleteFormation}
          onAddFormation={addFormation}
          onSeek={(count) => {
            setCurrentCount(count);
            // Stop playback when seeking
            if (isPlaying) setIsPlaying(false);
          }}
          onDropPreset={(presetJson, atCount) => {
            try {
              const preset = JSON.parse(presetJson) as FormationPreset;
              addFormationFromPreset(preset, atCount);
            } catch (e) {
              console.error('Failed to parse preset:', e);
            }
          }}
        />
      </div>

      {/* Cue Sheet Modal */}
      {showCueSheet && cueSheet && (
        <div className="cue-sheet-modal-overlay" onClick={() => setShowCueSheet(false)}>
          <div className="cue-sheet-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cue-sheet-header">
              <h2>{cueSheet.title || 'All Cue Sheets'}</h2>
              <div className="cue-sheet-meta">
                <span>Stage: {cueSheet.stageInfo}</span>
                <span>Duration: {cueSheet.totalCounts} counts</span>
                <span className="cue-sheet-algorithm">
                  Algorithm: {cueSheetAlgorithm ? PATH_ALGORITHM_LABELS[cueSheetAlgorithm] : 'User selections'}
                </span>
              </div>
              <button className="cue-sheet-close" onClick={() => setShowCueSheet(false)}>×</button>
            </div>

            {/* General Notes */}
            {cueSheet.generalNotes && cueSheet.generalNotes.length > 0 && (
              <div className="cue-sheet-notes cue-sheet-notes-prominent">
                <h4>General Notes</h4>
                <ul>
                  {cueSheet.generalNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* All Dancers */}
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
          📋 View All Cue Sheets
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
