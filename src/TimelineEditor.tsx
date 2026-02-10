/**
 * TimelineEditor Page
 * Main page for timeline-based choreography editing
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Stage, screenToStage, stageToScreen } from './components/Stage';
import { DancerCircle } from './components/DancerCircle';
import { Timeline } from './components/Timeline';
import { PresetPreview } from './components/PresetPreview';
import { SettingsModal } from './components/SettingsModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { CustomSelect } from './components/CustomSelect';
import type {
  ChoreographyProject,
  FormationKeyframe,
  ChoreographyExport,
} from './types/timeline';
import {
  createNewProject,
  createEmptyFormation,
  generateFormationId,
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
  PATH_ALGORITHM_DESCRIPTIONS,
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

const STORAGE_KEY = 'dance-choreography-autosave';
const AUTOSAVE_DELAY = 2000; // 2 seconds debounce

const TimelineEditor: React.FC = () => {
  // Project state - load from localStorage if available
  const [project, setProject] = useState<ChoreographyProject>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate it has required fields
        if (parsed.name && parsed.formations && parsed.dancerCount) {
          return parsed as ChoreographyProject;
        }
      }
    } catch (e) {
      console.warn('Failed to load autosave:', e);
    }
    return createNewProject('New Choreography', 8, DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT);
  });

  // Track if we restored from localStorage
  const [restoredFromStorage] = useState(() => {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  });

  // Undo history
  const [undoHistory, setUndoHistory] = useState<ChoreographyProject[]>([]);
  const [redoHistory, setRedoHistory] = useState<ChoreographyProject[]>([]);
  const isUndoingRef = useRef(false); // Prevent saving state during undo/redo

  // Auto-save to localStorage with debounce
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    // Debounced save
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      } catch (e) {
        console.warn('Auto-save failed:', e);
      }
    }, AUTOSAVE_DELAY);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [project]);

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
  const lastTimeRef = useRef<number | null>(null);
  const currentCountRef = useRef(0); // For smooth animation without re-renders
  const frameCountRef = useRef(0); // For throttling state updates

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
  const dragNeedsHistorySave = useRef(false); // Save history only on first move

  // Dancer swap state (double-click to swap)
  const [swapSourceDancerId, setSwapSourceDancerId] = useState<number | null>(null);

  // Quick swap popup state (right-click to show all dancers)
  const [quickSwapPopup, setQuickSwapPopup] = useState<{
    sourceDancerId: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Clipboard for copy/paste dancer positions
  const [copiedPositions, setCopiedPositions] = useState<Map<number, { x: number; y: number }> | null>(null);

  // Rotation state for smooth rotation control
  const [rotationAngle, setRotationAngle] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const rotationOriginalPositions = useRef<Map<number, { x: number; y: number }> | null>(null);
  const rotationCentroid = useRef<{ x: number; y: number } | null>(null);
  const rotationDancerIds = useRef<Set<number> | null>(null);

  // Path state - now stores paths for ALL algorithms per transition
  // Key format: "formationId->formationId:algorithm"
  const [allAlgorithmPaths, setAllAlgorithmPaths] = useState<Map<string, Map<PathAlgorithm, GeneratedPath[]>>>(new Map());
  const [showPaths, setShowPaths] = useState(true);
  const [pathAlgorithm, setPathAlgorithm] = useState<PathAlgorithm>('natural_curves'); // Default to Cubic
  const [isGeneratingPaths, setIsGeneratingPaths] = useState(false);
  const [pathGenerationStatus, setPathGenerationStatus] = useState<string | null>(null);
  const [pathGenerationProgress, setPathGenerationProgress] = useState<{ current: number; total: number; algorithm: string } | null>(null);

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
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);
  const [isCueSheetCollapsed, setIsCueSheetCollapsed] = useState(false);
  // Track which algorithm was used for each transition's cue sheet generation
  // Key: pathKey (e.g., "formation-1->formation-2"), Value: algorithm used
  const [cueSheetGeneratedWith, setCueSheetGeneratedWith] = useState<Map<string, PathAlgorithm>>(new Map());

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

  // Collapsible sections state (for progressive disclosure)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  // Helper: Get paths for current algorithm from allAlgorithmPaths
  const getPathsForAlgorithm = useCallback((pathKey: string, algorithm: PathAlgorithm): GeneratedPath[] | null => {
    const algorithmMap = allAlgorithmPaths.get(pathKey);
    if (!algorithmMap) return null;
    return algorithmMap.get(algorithm) || null;
  }, [allAlgorithmPaths]);

  // Toast notification state - Stack based (multiple toasts)
  interface ToastItem {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
    duration: number;
    createdAt: number;
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdCounter = useRef(0);
  const MAX_VISIBLE_TOASTS = 4;

  // Remove a specific toast by ID
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Show toast notification - adds to stack
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info', duration = 5000) => {
    const id = `toast-${++toastIdCounter.current}-${Date.now()}`;
    const newToast: ToastItem = { id, message, type, duration, createdAt: Date.now() };

    setToasts(prev => {
      // Add new toast and limit to max visible
      const updated = [...prev, newToast];
      if (updated.length > MAX_VISIBLE_TOASTS) {
        return updated.slice(-MAX_VISIBLE_TOASTS);
      }
      return updated;
    });

    // Auto-dismiss after duration
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  // Show toast on restore from localStorage (only once on mount)
  useEffect(() => {
    if (restoredFromStorage) {
      // Delay slightly to ensure component is fully mounted
      const timer = setTimeout(() => {
        showToast('Previous work restored', 'success', 3000);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Onboarding state - check if first time user
  const [showOnboarding, setShowOnboarding] = useState(() => {
    const hasSeenOnboarding = localStorage.getItem('dance-choreography-onboarding-seen');
    return !hasSeenOnboarding;
  });

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('dance-choreography-onboarding-seen', 'true');
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
      // Escape: Cancel swap mode or switch to edit mode
      if (e.key === 'Escape') {
        if (swapSourceDancerId !== null) {
          setSwapSourceDancerId(null);
          showToast('Swap cancelled', 'info', 1500);
        } else if (uiMode === 'rehearsal') {
          setUiMode('edit');
          showToast('Switched to Edit Mode', 'info', 2000);
        }
      }
      // C key: Toggle cue sheet collapse (only in rehearsal mode, not typing) - but not Ctrl+C
      if (e.key.toLowerCase() === 'c' && !(e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        if (uiMode === 'rehearsal') {
          setIsCueSheetCollapsed(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, uiMode, swapSourceDancerId, showToast]);

  // File input ref for loading
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get selected formation
  const selectedFormation = project.formations.find(f => f.id === selectedFormationId) || null;

  // Stage scale
  const scale = calculateScale(project.stageWidth, project.stageHeight);

  // Keyboard shortcut for copy/paste dancer positions
  useEffect(() => {
    const handleCopyPaste = (e: KeyboardEvent) => {
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        // Ctrl+C: Copy selected dancers' positions
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          if (uiMode === 'edit' && selectedDancers.size > 0 && selectedFormation) {
            e.preventDefault();
            const positions = new Map<number, { x: number; y: number }>();
            selectedFormation.positions.forEach(p => {
              if (selectedDancers.has(p.dancerId)) {
                positions.set(p.dancerId, { x: p.position.x, y: p.position.y });
              }
            });
            setCopiedPositions(positions);
            showToast(`Copied ${positions.size} dancer positions`, 'success', 1500);
          }
        }
        // Ctrl+V: Paste copied positions to current formation
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
          if (uiMode === 'edit' && copiedPositions && copiedPositions.size > 0 && selectedFormation) {
            e.preventDefault();
            saveToHistory();
            const formationId = selectedFormation.id;
            setProject(prev => ({
              ...prev,
              updatedAt: new Date().toISOString(),
              formations: prev.formations.map(f => {
                if (f.id !== formationId) return f;
                return {
                  ...f,
                  positions: f.positions.map(p => {
                    const copiedPos = copiedPositions.get(p.dancerId);
                    if (copiedPos) {
                      return {
                        ...p,
                        position: {
                          x: Math.max(0, Math.min(prev.stageWidth, snapToGrid(copiedPos.x))),
                          y: Math.max(0, Math.min(prev.stageHeight, snapToGrid(copiedPos.y))),
                        },
                      };
                    }
                    return p;
                  }),
                };
              }),
            }));
            showToast(`Pasted ${copiedPositions.size} dancer positions`, 'success', 1500);
          }
        }
      }
    };
    window.addEventListener('keydown', handleCopyPaste);
    return () => window.removeEventListener('keydown', handleCopyPaste);
  }, [uiMode, selectedDancers, selectedFormation, copiedPositions, saveToHistory, showToast]);

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

    // Initialize ref with current state value
    currentCountRef.current = currentCount;
    frameCountRef.current = 0;

    const animate = (time: number) => {
      // Fix: Use null check instead of falsy check
      if (lastTimeRef.current === null) {
        lastTimeRef.current = time;
      }
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      const next = currentCountRef.current + delta * COUNTS_PER_SECOND * playbackSpeed;

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
        currentCountRef.current = 0;
        return;
      }

      // Update ref immediately (for smooth animation)
      currentCountRef.current = next;

      // Throttle React state updates (every 2 frames for 30fps state updates)
      frameCountRef.current++;
      if (frameCountRef.current % 2 === 0) {
        setCurrentCount(next);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    // Fix: Use null instead of 0 to properly detect first frame
    lastTimeRef.current = null;
    // Initialize beat tracker to current position
    lastBeatRef.current = Math.floor(currentCount);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        // Sync final state when stopping
        setCurrentCount(currentCountRef.current);
      }
    };
    // Fix: Remove currentCount from dependencies to prevent animation restart
  }, [isPlaying, playbackSpeed, project.formations, metronomeEnabled, playMetronomeClick]);

  // Update formation (saves to undo history)
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

  // Update formation without saving history (for drag operations)
  const updateFormationDrag = useCallback((id: string, updates: Partial<FormationKeyframe>) => {
    setProject(prev => ({
      ...prev,
      formations: prev.formations.map(f =>
        f.id === id ? { ...f, ...updates } : f
      ),
    }));
  }, []);

  // Check if position is in exit zone and return which side ('left' | 'right' | null)
  const getExitZoneSide = useCallback((x: number, stageWidth: number): 'left' | 'right' | null => {
    if (x < EXIT_ZONE_WIDTH) return 'left';
    if (x > stageWidth - EXIT_ZONE_WIDTH) return 'right';
    return null;
  }, []);

  // Calculate stacked exit position for dancers in exit zone (for display/placement)
  const calculateExitZoneStackPosition = useCallback((
    dancerId: number,
    side: 'left' | 'right',
    allPositions: { dancerId: number; position: { x: number; y: number } }[],
    stageWidth: number,
    stageHeight: number
  ): { x: number; y: number } => {
    const EXIT_ZONE_CENTER = 0.75;
    const SLOT_SPACING = 1.0;

    // Get all dancers in this exit zone (excluding current dancer)
    const dancersInZone = allPositions.filter(p => {
      if (p.dancerId === dancerId) return false;
      const zoneSide = getExitZoneSide(p.position.x, stageWidth);
      return zoneSide === side;
    });

    // Sort by Y position (top to bottom)
    dancersInZone.sort((a, b) => b.position.y - a.position.y);

    // Find next available slot from top
    const exitX = side === 'left' ? EXIT_ZONE_CENTER : stageWidth - EXIT_ZONE_CENTER;
    let slotY = stageHeight - SLOT_SPACING * 0.5; // Start from top

    for (const dancer of dancersInZone) {
      if (Math.abs(dancer.position.y - slotY) < SLOT_SPACING * 0.5) {
        slotY -= SLOT_SPACING; // Move to next slot
      }
    }

    // Clamp to stage bounds
    slotY = Math.max(SLOT_SPACING * 0.5, Math.min(stageHeight - SLOT_SPACING * 0.5, slotY));

    return { x: exitX, y: slotY };
  }, [getExitZoneSide]);

  // Swap two dancers' positions in CURRENT formation only (keep colors and names)
  const swapDancers = useCallback((dancerId1: number, dancerId2: number) => {
    if (dancerId1 === dancerId2) return;
    if (!selectedFormationId) {
      showToast('Select a formation first', 'info', 2000);
      return;
    }

    saveToHistory();
    setProject(prev => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      formations: prev.formations.map(f => {
        // Only swap in the currently selected formation
        if (f.id !== selectedFormationId) return f;

        // Find both dancers
        const dancer1 = f.positions.find(d => d.dancerId === dancerId1);
        const dancer2 = f.positions.find(d => d.dancerId === dancerId2);

        if (!dancer1 || !dancer2) return f;

        // Swap only their positions, keep dancerId, color, and name intact
        return {
          ...f,
          positions: f.positions.map(p => {
            if (p.dancerId === dancerId1) {
              return { ...p, position: dancer2.position };
            } else if (p.dancerId === dancerId2) {
              return { ...p, position: dancer1.position };
            }
            return p;
          }),
        };
      }),
      // Do NOT swap dancer names - they stay with their dancer IDs
    }));

    showToast(`Swapped positions: ${dancerId1} ↔ ${dancerId2}`, 'success', 2000);
  }, [saveToHistory, showToast, selectedFormationId]);

  // Handle dancer double-click for swap
  const handleDancerDoubleClick = useCallback((dancerId: number) => {
    if (swapSourceDancerId === null) {
      // First click - select source dancer
      setSwapSourceDancerId(dancerId);
      showToast(`Click another dancer to swap with #${dancerId}`, 'info', 3000);
    } else if (swapSourceDancerId === dancerId) {
      // Cancel swap
      setSwapSourceDancerId(null);
      showToast('Swap cancelled', 'info', 1500);
    } else {
      // Second click - perform swap
      swapDancers(swapSourceDancerId, dancerId);
      setSwapSourceDancerId(null);
    }
  }, [swapSourceDancerId, swapDancers, showToast]);

  // Handle right-click on dancer to show quick swap menu
  const handleDancerRightClick = useCallback((dancerId: number, screenX: number, screenY: number) => {
    setQuickSwapPopup({
      sourceDancerId: dancerId,
      screenX,
      screenY,
    });
  }, []);

  // Handle quick swap selection from popup
  const handleQuickSwapSelect = useCallback((targetDancerId: number) => {
    if (quickSwapPopup) {
      swapDancers(quickSwapPopup.sourceDancerId, targetDancerId);
      setQuickSwapPopup(null);
    }
  }, [quickSwapPopup, swapDancers]);

  // Close quick swap popup
  const closeQuickSwapPopup = useCallback(() => {
    setQuickSwapPopup(null);
  }, []);

  // Rotate positions of selected dancers (shift positions CW or CCW)
  // Dancers are sorted by angle from centroid to form a circular order
  const rotateSelectedPositions = useCallback((direction: 'cw' | 'ccw') => {
    if (selectedDancers.size < 2) {
      showToast('Select at least 2 dancers to rotate', 'info', 2000);
      return;
    }
    if (!selectedFormationId) {
      showToast('Select a formation first', 'info', 2000);
      return;
    }

    saveToHistory();
    setProject(prev => {
      const formation = prev.formations.find(f => f.id === selectedFormationId);
      if (!formation) return prev;

      // Get selected dancers with their positions
      const selectedDancerData = Array.from(selectedDancers)
        .map(id => {
          const dancer = formation.positions.find(d => d.dancerId === id);
          return dancer ? { id, position: { ...dancer.position } } : null;
        })
        .filter((d): d is { id: number; position: { x: number; y: number } } => d !== null);

      if (selectedDancerData.length < 2) return prev;

      // Calculate centroid of selected dancers
      const centroid = {
        x: selectedDancerData.reduce((sum, d) => sum + d.position.x, 0) / selectedDancerData.length,
        y: selectedDancerData.reduce((sum, d) => sum + d.position.y, 0) / selectedDancerData.length,
      };

      // Sort dancers by angle from centroid (counter-clockwise from positive X axis)
      // This creates a circular order around the centroid
      const sortedDancers = [...selectedDancerData].sort((a, b) => {
        const angleA = Math.atan2(a.position.y - centroid.y, a.position.x - centroid.x);
        const angleB = Math.atan2(b.position.y - centroid.y, b.position.x - centroid.x);
        return angleA - angleB;
      });

      // Get positions in circular order
      const positions = sortedDancers.map(d => d.position);
      const dancerIds = sortedDancers.map(d => d.id);

      // Rotate positions: CW = each dancer takes next position in circle
      // CCW = each dancer takes previous position in circle
      const rotatedPositions = direction === 'cw'
        ? [positions[positions.length - 1], ...positions.slice(0, -1)]
        : [...positions.slice(1), positions[0]];

      // Create mapping: dancerId -> new position
      const positionMap = new Map<number, { x: number; y: number }>();
      dancerIds.forEach((id, idx) => {
        positionMap.set(id, rotatedPositions[idx]);
      });

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations: prev.formations.map(f => {
          if (f.id !== selectedFormationId) return f;
          return {
            ...f,
            positions: f.positions.map(p => {
              const newPos = positionMap.get(p.dancerId);
              if (!newPos) return p;
              return { ...p, position: newPos };
            }),
          };
        }),
      };
    });

    const dirLabel = direction === 'cw' ? '↻' : '↺';
    showToast(`Rotated ${selectedDancers.size} positions ${dirLabel}`, 'success', 1500);
  }, [selectedDancers, selectedFormationId, saveToHistory, showToast]);

  // Start rotation - save original positions
  const startRotation = useCallback(() => {
    if (!selectedFormationId) return;

    const formation = project.formations.find(f => f.id === selectedFormationId);
    if (!formation || formation.positions.length === 0) return;

    // Determine which dancers to rotate
    const dancersToRotate = selectedDancers.size > 0
      ? formation.positions.filter(p => selectedDancers.has(p.dancerId))
      : formation.positions;

    if (dancersToRotate.length === 0) return;

    // Save original positions
    const originalPositions = new Map<number, { x: number; y: number }>();
    dancersToRotate.forEach(d => {
      originalPositions.set(d.dancerId, { x: d.position.x, y: d.position.y });
    });
    rotationOriginalPositions.current = originalPositions;

    // Save centroid
    rotationCentroid.current = {
      x: dancersToRotate.reduce((sum, d) => sum + d.position.x, 0) / dancersToRotate.length,
      y: dancersToRotate.reduce((sum, d) => sum + d.position.y, 0) / dancersToRotate.length,
    };

    // Save dancer IDs
    rotationDancerIds.current = new Set(dancersToRotate.map(d => d.dancerId));

    saveToHistory();
    setIsRotating(true);
    setRotationAngle(0);
  }, [selectedFormationId, project.formations, selectedDancers, saveToHistory]);

  // Apply rotation preview (during slider drag)
  const applyRotationPreview = useCallback((angleDegrees: number) => {
    if (!selectedFormationId || !rotationOriginalPositions.current || !rotationCentroid.current || !rotationDancerIds.current) return;

    const centroid = rotationCentroid.current;
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    setProject(prev => ({
      ...prev,
      formations: prev.formations.map(f => {
        if (f.id !== selectedFormationId) return f;
        return {
          ...f,
          positions: f.positions.map(p => {
            const originalPos = rotationOriginalPositions.current?.get(p.dancerId);
            if (!originalPos || !rotationDancerIds.current?.has(p.dancerId)) return p;

            const dx = originalPos.x - centroid.x;
            const dy = originalPos.y - centroid.y;
            const newX = centroid.x + (dx * cosA - dy * sinA);
            const newY = centroid.y + (dx * sinA + dy * cosA);

            return {
              ...p,
              position: {
                x: Math.max(0, Math.min(prev.stageWidth, newX)),
                y: Math.max(0, Math.min(prev.stageHeight, newY)),
              },
            };
          }),
        };
      }),
    }));

    setRotationAngle(angleDegrees);
  }, [selectedFormationId]);

  // Commit rotation (on slider release) - snap to grid
  const commitRotation = useCallback(() => {
    if (!selectedFormationId || !rotationDancerIds.current) {
      setIsRotating(false);
      return;
    }

    // Snap final positions to grid
    setProject(prev => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      formations: prev.formations.map(f => {
        if (f.id !== selectedFormationId) return f;
        return {
          ...f,
          positions: f.positions.map(p => {
            if (!rotationDancerIds.current?.has(p.dancerId)) return p;
            return {
              ...p,
              position: {
                x: Math.max(0, Math.min(prev.stageWidth, snapToGrid(p.position.x))),
                y: Math.max(0, Math.min(prev.stageHeight, snapToGrid(p.position.y))),
              },
            };
          }),
        };
      }),
    }));

    const count = rotationDancerIds.current.size;
    if (Math.abs(rotationAngle) > 0.5) {
      showToast(`Rotated ${count} dancer${count > 1 ? 's' : ''} by ${Math.round(rotationAngle)}°`, 'success', 1500);
    }

    // Reset rotation state
    rotationOriginalPositions.current = null;
    rotationCentroid.current = null;
    rotationDancerIds.current = null;
    setIsRotating(false);
    setRotationAngle(0);
  }, [selectedFormationId, rotationAngle, showToast]);

  // Cancel rotation - restore original positions
  const cancelRotation = useCallback(() => {
    if (!selectedFormationId || !rotationOriginalPositions.current) {
      setIsRotating(false);
      return;
    }

    setProject(prev => ({
      ...prev,
      formations: prev.formations.map(f => {
        if (f.id !== selectedFormationId) return f;
        return {
          ...f,
          positions: f.positions.map(p => {
            const originalPos = rotationOriginalPositions.current?.get(p.dancerId);
            if (!originalPos) return p;
            return { ...p, position: originalPos };
          }),
        };
      }),
    }));

    rotationOriginalPositions.current = null;
    rotationCentroid.current = null;
    rotationDancerIds.current = null;
    setIsRotating(false);
    setRotationAngle(0);
  }, [selectedFormationId]);

  // Update dancer name
  const updateDancerName = useCallback((dancerId: number, name: string) => {
    setProject(prev => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      dancerNames: {
        ...prev.dancerNames,
        [dancerId]: name,
      },
    }));
  }, []);

  // Get next formation number (for permanent labeling)
  const getNextFormationNumber = useCallback((formations: FormationKeyframe[]) => {
    let maxNum = 0;
    for (const f of formations) {
      if (f.label) {
        const num = parseInt(f.label, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    return maxNum + 1;
  }, []);

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

      // Get next permanent formation number
      const nextNumber = getNextFormationNumber(formations);

      // Copy positions from previous formation if available
      const prevFormation = insertIndex > 0 ? formations[insertIndex - 1] : null;
      const newFormation = prevFormation
        ? {
            ...createEmptyFormation(startCount, prev.dancerCount, prev.stageWidth, prev.stageHeight, nextNumber),
            positions: prevFormation.positions.map(p => ({ ...p, position: { ...p.position } })),
          }
        : createEmptyFormation(startCount, prev.dancerCount, prev.stageWidth, prev.stageHeight, nextNumber);

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
  }, [saveToHistory, getNextFormationNumber]);

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

      // Clear cue sheet tracking since transitions changed
      setCueSheetGeneratedWith(new Map());

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations,
      };
    });
  }, [selectedFormationId, saveToHistory]);

  // Duplicate formation
  const duplicateFormation = useCallback((formationId: string) => {
    saveToHistory();
    setProject(prev => {
      const sourceIndex = prev.formations.findIndex(f => f.id === formationId);
      if (sourceIndex === -1) return prev;

      const source = prev.formations[sourceIndex];
      const nextNumber = getNextFormationNumber(prev.formations);

      const duplicate: FormationKeyframe = {
        id: generateFormationId(),
        startCount: source.startCount + source.duration,
        duration: source.duration,
        label: String(nextNumber),
        transitionType: source.transitionType,
        positions: source.positions.map(p => ({
          ...p,
          position: { ...p.position }
        }))
      };

      const formations = [...prev.formations];
      formations.splice(sourceIndex + 1, 0, duplicate);

      // Recalculate startCounts for subsequent formations
      for (let i = sourceIndex + 2; i < formations.length; i++) {
        formations[i] = {
          ...formations[i],
          startCount: formations[i - 1].startCount + formations[i - 1].duration
        };
      }

      // Clear cue sheet and path caches
      setCueSheetGeneratedWith(new Map());

      setSelectedFormationId(duplicate.id);

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations
      };
    });

    showToast('Formation duplicated', 'success', 1500);
  }, [saveToHistory, getNextFormationNumber, showToast]);

  // Keyboard shortcut for duplicate formation (Ctrl/Cmd + D)
  useEffect(() => {
    const handleDuplicateKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        if (selectedFormationId) {
          duplicateFormation(selectedFormationId);
        }
      }
    };
    window.addEventListener('keydown', handleDuplicateKeyDown);
    return () => window.removeEventListener('keydown', handleDuplicateKeyDown);
  }, [selectedFormationId, duplicateFormation]);

  // Reorder formation (move to new position)
  const reorderFormation = useCallback((formationId: string, toIndex: number) => {
    // Pre-check if move is valid before modifying state
    const formations = project.formations;
    const fromIndex = formations.findIndex(f => f.id === formationId);

    if (fromIndex === -1 || fromIndex === toIndex) return;

    // Calculate adjusted index (where to insert after removal)
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

    // Check if this would result in no actual movement
    if (adjustedIndex === fromIndex) return;

    saveToHistory();

    setProject(prev => {
      const newFormations = [...prev.formations];

      // Remove formation from current position
      const [movedFormation] = newFormations.splice(fromIndex, 1);

      // Insert at new position
      newFormations.splice(adjustedIndex, 0, movedFormation);

      // Recalculate all start counts
      let count = 0;
      for (let i = 0; i < newFormations.length; i++) {
        newFormations[i] = {
          ...newFormations[i],
          startCount: count,
        };
        count += newFormations[i].duration;
      }

      // Clear cue sheet tracking since transitions changed
      setCueSheetGeneratedWith(new Map());

      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        formations: newFormations,
      };
    });

    showToast('Formation moved', 'success', 1500);
  }, [project.formations, saveToHistory, showToast]);

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
      // Mark that we need to save history on first actual move
      dragNeedsHistorySave.current = true;
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

    // Skip if no actual movement
    if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) return;

    // Save history only on first actual move
    if (dragNeedsHistorySave.current) {
      saveToHistory();
      dragNeedsHistorySave.current = false;
    }

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

    updateFormationDrag(selectedFormation.id, { positions: newPositions });
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

    // Snap to grid on release - use setProject to get latest state
    // Special handling for exit zones: auto-stack vertically
    if (draggingDancer !== null && selectedFormationId) {
      const dancersToMove = selectedDancers.has(draggingDancer)
        ? Array.from(selectedDancers)
        : [draggingDancer];

      setProject(prev => {
        const formation = prev.formations.find(f => f.id === selectedFormationId);
        if (!formation) return prev;

        // First pass: identify which dancers are going to exit zones
        const exitZoneAssignments = new Map<number, 'left' | 'right'>();
        for (const dancerId of dancersToMove) {
          const dancer = formation.positions.find(p => p.dancerId === dancerId);
          if (dancer) {
            const side = getExitZoneSide(dancer.position.x, prev.stageWidth);
            if (side) {
              exitZoneAssignments.set(dancerId, side);
            }
          }
        }

        // Second pass: calculate positions
        const snappedPositions = formation.positions.map(p => {
          if (!dancersToMove.includes(p.dancerId)) return p;

          const exitSide = exitZoneAssignments.get(p.dancerId);
          if (exitSide) {
            // Dancer is in exit zone - stack vertically for clean display
            const stackedPos = calculateExitZoneStackPosition(
              p.dancerId,
              exitSide,
              formation.positions,
              prev.stageWidth,
              prev.stageHeight
            );
            return { ...p, position: stackedPos };
          } else {
            // Normal grid snap
            return {
              ...p,
              position: {
                x: Math.max(0, Math.min(prev.stageWidth, snapToGrid(p.position.x))),
                y: Math.max(0, Math.min(prev.stageHeight, snapToGrid(p.position.y))),
              },
            };
          }
        });

        return {
          ...prev,
          formations: prev.formations.map(f =>
            f.id === selectedFormationId ? { ...f, positions: snappedPositions } : f
          ),
        };
      });
    }
    setDraggingDancer(null);
    dragNeedsHistorySave.current = false;
  };

  // Save project to JSON
  const handleSave = () => {
    // Serialize allAlgorithmPaths: Map<string, Map<PathAlgorithm, GeneratedPath[]>>
    const serializedPaths: Record<string, Record<string, GeneratedPath[]>> = {};
    allAlgorithmPaths.forEach((algorithmMap, pathKey) => {
      serializedPaths[pathKey] = {};
      algorithmMap.forEach((paths, algorithm) => {
        serializedPaths[pathKey][algorithm] = paths;
      });
    });

    // Serialize userSelectedAlgorithms: Map<string, PathAlgorithm>
    const serializedUserSelected: Record<string, PathAlgorithm> = {};
    userSelectedAlgorithms.forEach((algorithm, pathKey) => {
      serializedUserSelected[pathKey] = algorithm;
    });

    // Serialize geminiResults: Map<string, GeminiTransitionResult>
    const serializedGeminiResults: Record<string, {
      pick: PathAlgorithm;
      scores: Record<string, number>;
      breakdowns: Record<string, ScoreBreakdown>;
      insights: Record<string, string>;
      pickReason: string;
    }> = {};
    geminiResults.forEach((result, pathKey) => {
      const scoresObj: Record<string, number> = {};
      result.scores.forEach((score, alg) => { scoresObj[alg] = score; });
      const breakdownsObj: Record<string, ScoreBreakdown> = {};
      result.breakdowns.forEach((breakdown, alg) => { breakdownsObj[alg] = breakdown; });
      const insightsObj: Record<string, string> = {};
      result.insights.forEach((insight, alg) => { insightsObj[alg] = insight; });
      serializedGeminiResults[pathKey] = {
        pick: result.pick,
        scores: scoresObj,
        breakdowns: breakdownsObj,
        insights: insightsObj,
        pickReason: result.pickReason,
      };
    });

    const exportData: ChoreographyExport = {
      version: '2.0',
      project,
      exportedAt: new Date().toISOString(),
      allAlgorithmPaths: serializedPaths,
      userSelectedAlgorithms: serializedUserSelected,
      geminiResults: serializedGeminiResults,
      cueSheet: cueSheet,
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

        // Version 2.0+ - restore extended data
        if (data.version === '2.0' || parseFloat(data.version) >= 2.0) {
          // Restore allAlgorithmPaths
          if (data.allAlgorithmPaths) {
            const restoredPaths = new Map<string, Map<PathAlgorithm, GeneratedPath[]>>();
            Object.entries(data.allAlgorithmPaths).forEach(([pathKey, algorithms]) => {
              const algorithmMap = new Map<PathAlgorithm, GeneratedPath[]>();
              Object.entries(algorithms).forEach(([algorithm, paths]) => {
                algorithmMap.set(algorithm as PathAlgorithm, paths);
              });
              restoredPaths.set(pathKey, algorithmMap);
            });
            setAllAlgorithmPaths(restoredPaths);
          }

          // Restore userSelectedAlgorithms
          if (data.userSelectedAlgorithms) {
            const restoredUserSelected = new Map<string, PathAlgorithm>();
            Object.entries(data.userSelectedAlgorithms).forEach(([pathKey, algorithm]) => {
              restoredUserSelected.set(pathKey, algorithm);
            });
            setUserSelectedAlgorithms(restoredUserSelected);
          }

          // Restore geminiResults
          if (data.geminiResults) {
            const restoredGemini = new Map<string, GeminiTransitionResult>();
            Object.entries(data.geminiResults).forEach(([pathKey, result]) => {
              const scoresMap = new Map<PathAlgorithm, number>();
              Object.entries(result.scores).forEach(([alg, score]) => {
                scoresMap.set(alg as PathAlgorithm, score);
              });
              const breakdownsMap = new Map<PathAlgorithm, ScoreBreakdown>();
              Object.entries(result.breakdowns).forEach(([alg, breakdown]) => {
                breakdownsMap.set(alg as PathAlgorithm, breakdown);
              });
              const insightsMap = new Map<PathAlgorithm, string>();
              Object.entries(result.insights).forEach(([alg, insight]) => {
                insightsMap.set(alg as PathAlgorithm, insight);
              });
              restoredGemini.set(pathKey, {
                pick: result.pick,
                scores: scoresMap,
                breakdowns: breakdownsMap,
                insights: insightsMap,
                pickReason: result.pickReason,
              });
            });
            setGeminiResults(restoredGemini);
          }

          // Restore cueSheet
          if (data.cueSheet !== undefined) {
            setCueSheet(data.cueSheet);

            // Reconstruct cueSheetGeneratedWith from userSelectedAlgorithms
            // This assumes the cueSheet was generated with the saved algorithm selections
            if (data.cueSheet && data.userSelectedAlgorithms) {
              const restoredGenWith = new Map<string, PathAlgorithm>();
              Object.entries(data.userSelectedAlgorithms).forEach(([pathKey, algorithm]) => {
                restoredGenWith.set(pathKey, algorithm);
              });
              setCueSheetGeneratedWith(restoredGenWith);
            } else {
              setCueSheetGeneratedWith(new Map());
            }
          } else {
            setCueSheetGeneratedWith(new Map());
          }
        } else {
          // Version 1.0 - clear extended data
          setAllAlgorithmPaths(new Map());
          setUserSelectedAlgorithms(new Map());
          setGeminiResults(new Map());
          setCueSheet(null);
          setCueSheetGeneratedWith(new Map());
        }
      } catch (err) {
        showToast('Failed to load choreography file. Please check the file format.', 'error');
      }
    };
    reader.readAsText(file);

    // Reset input
    e.target.value = '';
  };

  // New project - confirm action
  const confirmNewProject = () => {
    const newProject = createNewProject('New Choreography', project.dancerCount, project.stageWidth, project.stageHeight);
    setProject(newProject);
    setSelectedFormationId(newProject.formations[0]?.id || null);
    setCurrentCount(0);
    setIsPlaying(false);
    // Clear cue sheet and tracking
    setCueSheet(null);
    setCueSheetGeneratedWith(new Map());
    setAllAlgorithmPaths(new Map());
    setUserSelectedAlgorithms(new Map());
    setGeminiResults(new Map());
    // Clear localStorage auto-save
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear autosave:', e);
    }
    setShowConfirmNew(false);
  };

  // New project - show confirm dialog if needed
  const handleNew = () => {
    if (project.formations.length > 1 || project.formations[0]?.label) {
      setShowConfirmNew(true);
    } else {
      confirmNewProject();
    }
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

  // Delete a specific dancer by ID (removes from all formations and renumbers)
  const deleteSpecificDancer = useCallback((dancerId: number) => {
    saveToHistory();
    setProject(prev => {
      // Remove dancer from all formations and renumber
      const newFormations = prev.formations.map(f => ({
        ...f,
        positions: f.positions
          .filter(p => p.dancerId !== dancerId)
          .map(p => ({
            ...p,
            // Renumber: dancers after the deleted one shift down by 1
            dancerId: p.dancerId > dancerId ? p.dancerId - 1 : p.dancerId,
          })),
      }));

      // Update dancer names (shift all names after the deleted dancer)
      const newDancerNames: Record<number, string> = {};
      for (let i = 1; i <= prev.dancerCount; i++) {
        if (i < dancerId) {
          if (prev.dancerNames?.[i]) newDancerNames[i] = prev.dancerNames[i];
        } else if (i > dancerId) {
          if (prev.dancerNames?.[i]) newDancerNames[i - 1] = prev.dancerNames[i];
        }
      }

      return {
        ...prev,
        dancerCount: prev.dancerCount - 1,
        formations: newFormations,
        dancerNames: newDancerNames,
        updatedAt: new Date().toISOString(),
      };
    });

    showToast(`Dancer ${dancerId} deleted`, 'success', 2000);
  }, [saveToHistory, showToast]);

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

  // Check if position is in exit zone
  const isInExitZone = useCallback((x: number, stageWidth: number): boolean => {
    return x < EXIT_ZONE_WIDTH || x > stageWidth - EXIT_ZONE_WIDTH;
  }, []);

  // Generate simple horizontal path for exit/entry
  const generateHorizontalPath = useCallback((
    startPos: { x: number; y: number },
    endPos: { x: number; y: number },
    totalCounts: number,
    numPoints: number = 16
  ): { x: number; y: number; t: number }[] => {
    const path: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = (i / numPoints) * totalCounts;
      const progress = i / numPoints;
      // Smooth easing
      const eased = progress * progress * (3 - 2 * progress);
      path.push({
        x: startPos.x + (endPos.x - startPos.x) * eased,
        y: startPos.y, // Keep Y constant for horizontal movement
        t,
      });
    }
    return path;
  }, []);

  // Generate paths between formations using selected algorithm
  const generatePathsForTransition = useCallback(async (
    fromFormation: FormationKeyframe,
    toFormation: FormationKeyframe,
    algorithm: PathAlgorithm
  ): Promise<GeneratedPath[]> => {
    const regularAssignments: { dancerId: number; startPosition: { x: number; y: number }; endPosition: { x: number; y: number }; distance: number }[] = [];
    const exitPaths: GeneratedPath[] = [];
    const entryPaths: GeneratedPath[] = [];

    // Process dancers in fromFormation
    for (const pos of fromFormation.positions) {
      const endPos = toFormation.positions.find(p => p.dancerId === pos.dancerId);
      const startPosition = { x: pos.position.x, y: pos.position.y };
      const startInExit = isInExitZone(startPosition.x, project.stageWidth);

      if (!endPos) {
        // Dancer is exiting - create horizontal path to exit zone
        const exitPosition = calculateOptimalExitPosition(startPosition, project.stageWidth, project.stageHeight);
        exitPaths.push({
          dancerId: pos.dancerId,
          path: generateHorizontalPath(startPosition, exitPosition, fromFormation.duration),
        });
      } else {
        const endPosition = { x: endPos.position.x, y: endPos.position.y };
        const endInExit = isInExitZone(endPosition.x, project.stageWidth);

        if (startInExit && endInExit) {
          // Both in exit zone - no path needed (stationary)
          exitPaths.push({
            dancerId: pos.dancerId,
            path: [
              { x: endPosition.x, y: endPosition.y, t: 0 },
              { x: endPosition.x, y: endPosition.y, t: fromFormation.duration },
            ],
          });
        } else if (startInExit) {
          // Entering from exit zone - start from ideal Y position (matching target Y) for smooth horizontal entry
          const EXIT_ZONE_CENTER = 0.75;
          const idealStartX = startPosition.x < project.stageWidth / 2 ? EXIT_ZONE_CENTER : project.stageWidth - EXIT_ZONE_CENTER;
          const idealStartY = endPosition.y; // Start at same Y as target for horizontal entry
          const idealStartPos = { x: idealStartX, y: idealStartY };

          // Generate smooth path from ideal position to target
          entryPaths.push({
            dancerId: pos.dancerId,
            path: generateHorizontalPath(idealStartPos, endPosition, fromFormation.duration),
          });
        } else if (endInExit) {
          // Exiting to exit zone - horizontal exit
          exitPaths.push({
            dancerId: pos.dancerId,
            path: generateHorizontalPath(startPosition, endPosition, fromFormation.duration),
          });
        } else {
          // Regular movement - use algorithm
          const dx = endPosition.x - startPosition.x;
          const dy = endPosition.y - startPosition.y;
          regularAssignments.push({
            dancerId: pos.dancerId,
            startPosition,
            endPosition,
            distance: Math.sqrt(dx * dx + dy * dy),
          });
        }
      }
    }

    // Handle new dancers entering (not in fromFormation)
    const newDancers = toFormation.positions.filter(
      pos => !fromFormation.positions.some(p => p.dancerId === pos.dancerId)
    );
    for (const newDancer of newDancers) {
      const targetPosition = { x: newDancer.position.x, y: newDancer.position.y };
      const targetInExit = isInExitZone(targetPosition.x, project.stageWidth);

      if (targetInExit) {
        // New dancer going directly to exit zone - just place them there
        entryPaths.push({
          dancerId: newDancer.dancerId,
          path: [
            { x: targetPosition.x, y: targetPosition.y, t: 0 },
            { x: targetPosition.x, y: targetPosition.y, t: fromFormation.duration },
          ],
        });
      } else {
        // New dancer entering to stage - start from ideal position (same Y as target)
        const EXIT_ZONE_CENTER = 0.75;
        // Choose entry side based on which is closer to target X
        const useLeftSide = targetPosition.x < project.stageWidth / 2;
        const idealStartX = useLeftSide ? EXIT_ZONE_CENTER : project.stageWidth - EXIT_ZONE_CENTER;
        const idealStartPos = { x: idealStartX, y: targetPosition.y };

        // Generate smooth horizontal path from ideal position to target
        entryPaths.push({
          dancerId: newDancer.dancerId,
          path: generateHorizontalPath(idealStartPos, targetPosition, fromFormation.duration),
        });
      }
    }

    // Generate paths for regular movements using algorithm
    let algorithmResults: GeneratedPath[] = [];
    if (regularAssignments.length > 0) {
      const config = {
        totalCounts: fromFormation.duration,
        numPoints: 32,
        collisionRadius: 0.5,
      };

      let results: { dancerId: number; path: { x: number; y: number; t: number }[] }[];

      switch (algorithm) {
        case 'clean_flow':
          results = computePathsCleanFlow(regularAssignments, config);
          break;
        case 'natural_curves':
          results = computePathsNaturalCurves(regularAssignments, config);
          break;
        case 'wave_sync':
          results = computePathsWaveSync(regularAssignments, config);
          break;
        case 'perfect_sync':
          results = computePathsPerfectSync(regularAssignments, config);
          break;
        case 'balanced_direct':
          results = computePathsBalancedDirect(regularAssignments, config);
          break;
        case 'harmonized_flow':
        default:
          results = computePathsHarmonizedFlow(regularAssignments, config);
          break;
      }

      algorithmResults = results.map(r => ({ dancerId: r.dancerId, path: r.path }));
    }

    // Merge all paths
    return [...algorithmResults, ...exitPaths, ...entryPaths];
  }, [calculateOptimalEntryPosition, calculateOptimalExitPosition, isInExitZone, generateHorizontalPath, project.stageWidth, project.stageHeight]);

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
      const allAlgorithms = Array.from(allPaths.keys()).sort((a, b) => {
        const priorityA = ALGORITHM_PRIORITY.indexOf(a);
        const priorityB = ALGORITHM_PRIORITY.indexOf(b);
        return priorityA - priorityB;
      });

      // Filter to unique algorithms only (same logic as getUniqueAlgorithms)
      // This ensures Gemini only evaluates algorithms that will be available in UI
      const algorithms: PathAlgorithm[] = [];
      const processedPathGroups: GeneratedPath[][] = [];
      for (const algo of allAlgorithms) {
        const paths = allPaths.get(algo);
        if (!paths) continue;

        let isDuplicate = false;
        for (const existingPaths of processedPathGroups) {
          if (arePathsIdentical(paths, existingPaths)) {
            isDuplicate = true;
            break;
          }
        }

        if (!isDuplicate) {
          algorithms.push(algo);
          processedPathGroups.push(paths);
        }
      }

      // If no unique algorithms found, use all algorithms
      if (algorithms.length === 0) {
        algorithms.push(...allAlgorithms);
      }

      const firstPaths = allPaths.get(algorithms[0])!;

      // Check if all remaining paths are identical - skip Gemini if so
      let allIdentical = true;
      for (let i = 1; i < algorithms.length; i++) {
        const otherPaths = allPaths.get(algorithms[i])!;
        if (!arePathsIdentical(firstPaths, otherPaths)) {
          allIdentical = false;
          break;
        }
      }

      // If all paths are identical (or only one unique), use priority-based selection
      if (allIdentical || algorithms.length === 1) {
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
      showToast('Select a formation that has a next formation to generate paths.', 'error');
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
        setPathGenerationProgress({ current: i + 1, total: allAlgorithms.length, algorithm: PATH_ALGORITHM_LABELS[algo] });
        setPathGenerationStatus(`${PATH_ALGORITHM_LABELS[algo]}`);

        const paths = await generatePathsForTransition(currentFormation, nextFormation, algo);
        algorithmPaths.set(algo, paths);
      }
      setPathGenerationProgress(null);

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

        const algorithmPaths = new Map<PathAlgorithm, GeneratedPath[]>();
        for (let j = 0; j < allAlgorithms.length; j++) {
          const algo = allAlgorithms[j];
          setPathGenerationProgress({
            current: j + 1,
            total: allAlgorithms.length,
            algorithm: PATH_ALGORITHM_LABELS[algo]
          });
          setPathGenerationStatus(`Transition ${i + 1}→${i + 2}: ${PATH_ALGORITHM_LABELS[algo]}`);
          const paths = await generatePathsForTransition(current, next, algo);
          algorithmPaths.set(algo, paths);
        }
        newAllPaths.set(pathKey, algorithmPaths);
      }

      setAllAlgorithmPaths(newAllPaths);
      setPathGenerationProgress(null);
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

      // ============================================
      // PHASE 1: Generate ALL paths first (fast, math-based)
      // ============================================
      const generatedPathsMap = new Map<string, Map<PathAlgorithm, GeneratedPath[]>>();
      const transitionsToRank: Array<{ pathKey: string; algorithmPaths: Map<PathAlgorithm, GeneratedPath[]>; duration: number }> = [];

      for (let i = 0; i < totalTransitions; i++) {
        const current = project.formations[i];
        const next = project.formations[i + 1];
        const pathKey = `${current.id}->${next.id}`;

        // Check if already generated
        const existingPaths = allAlgorithmPaths.get(pathKey);
        const alreadyGenerated = existingPaths && existingPaths.size > 0;
        const alreadyRanked = geminiResults.has(pathKey);

        let algorithmPaths: Map<PathAlgorithm, GeneratedPath[]>;

        if (alreadyGenerated) {
          algorithmPaths = existingPaths;
        } else {
          // Generate paths for this transition
          algorithmPaths = new Map<PathAlgorithm, GeneratedPath[]>();
          for (let j = 0; j < allAlgorithms.length; j++) {
            const algo = allAlgorithms[j];
            setPathGenerationProgress({
              current: j + 1,
              total: allAlgorithms.length,
              algorithm: PATH_ALGORITHM_LABELS[algo]
            });
            setPathGenerationStatus(`Transition ${i + 1}/${totalTransitions}: ${PATH_ALGORITHM_LABELS[algo]}`);
            const paths = await generatePathsForTransition(current, next, algo);
            algorithmPaths.set(algo, paths);
          }
          setPathGenerationProgress(null);

          // Update state immediately so UI shows progress
          setAllAlgorithmPaths(prev => {
            const updated = new Map(prev);
            updated.set(pathKey, algorithmPaths);
            return updated;
          });

          // Yield to event loop to allow React to re-render
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        generatedPathsMap.set(pathKey, algorithmPaths);

        // Queue for Gemini ranking if not already ranked
        if (!alreadyRanked) {
          transitionsToRank.push({ pathKey, algorithmPaths, duration: current.duration });
        }
      }

      // ============================================
      // PHASE 2: Gemini evaluation (slower, API-based)
      // ============================================
      if (transitionsToRank.length > 0) {
        for (let i = 0; i < transitionsToRank.length; i++) {
          const { pathKey, algorithmPaths, duration } = transitionsToRank[i];
          setPathGenerationStatus(`Ranking with Gemini (${i + 1}/${transitionsToRank.length})...`);
          await rankPathsWithGemini(algorithmPaths, project.stageWidth, project.stageHeight, duration, pathKey);

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
  // Smart regeneration: only regenerates transitions that changed or are new
  const generateAllCueSheets = useCallback(async () => {
    if (project.formations.length < 2) {
      showToast('Need at least 2 formations to generate cue sheets', 'error');
      return;
    }

    // Check if paths exist and identify which transitions need regeneration
    const totalTransitions = project.formations.length - 1;
    const transitionsToRegenerate: Array<{
      index: number;
      pathKey: string;
      reason: 'new' | 'changed';
    }> = [];

    for (let i = 0; i < totalTransitions; i++) {
      const current = project.formations[i];
      const next = project.formations[i + 1];
      const pathKey = `${current.id}->${next.id}`;

      // Check if paths exist for this transition
      if (!allAlgorithmPaths.has(pathKey) || (allAlgorithmPaths.get(pathKey)?.size || 0) === 0) {
        showToast('Please generate paths first', 'error');
        return;
      }

      // Determine which algorithm would be used
      const userSelected = userSelectedAlgorithms.get(pathKey);
      const geminiPick = geminiResults.get(pathKey)?.pick;
      const selectedAlgo = userSelected || geminiPick || 'natural_curves';

      // Check if this transition needs regeneration
      const previouslyGeneratedWith = cueSheetGeneratedWith.get(pathKey);

      if (!previouslyGeneratedWith) {
        // Never generated
        transitionsToRegenerate.push({ index: i, pathKey, reason: 'new' });
      } else if (previouslyGeneratedWith !== selectedAlgo) {
        // Algorithm changed
        transitionsToRegenerate.push({ index: i, pathKey, reason: 'changed' });
      }
    }

    // If all cue sheets are up to date, show message and return
    if (transitionsToRegenerate.length === 0 && cueSheet) {
      showToast('✓ Cue sheet is already up to date', 'success');
      return;
    }

    // If no cue sheet exists at all, regenerate everything
    const needsFullRegeneration = !cueSheet || transitionsToRegenerate.length === totalTransitions;

    setIsGeneratingCueSheet(true);

    if (needsFullRegeneration) {
      setPathGenerationStatus(`Generating cue sheets (0/${totalTransitions})...`);
    } else {
      const changedCount = transitionsToRegenerate.filter(t => t.reason === 'changed').length;
      const newCount = transitionsToRegenerate.filter(t => t.reason === 'new').length;
      const parts = [];
      if (changedCount > 0) parts.push(`${changedCount} changed`);
      if (newCount > 0) parts.push(`${newCount} new`);
      setPathGenerationStatus(`Updating cue sheets (${parts.join(', ')})...`);
    }

    try {
      // Collect all paths for cue sheet generation
      const allDancerPaths: Array<{
        dancerId: number;
        path: { x: number; y: number; t: number }[];
        startTime: number;
        speed: number;
        totalDistance: number;
      }> = [];

      // Track which algorithms we're using for each transition
      const newGeneratedWith = new Map<string, PathAlgorithm>();

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

          // Track which algorithm we're using
          newGeneratedWith.set(pathKey, selectedAlgo);

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

        // Update progress
        setPathGenerationStatus(`Generating cue sheets (${i + 1}/${totalTransitions})...`);
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
          formations: project.formations.map((f, i) => ({
            index: i,
            name: f.label || `Formation ${i + 1}`,
            startCount: f.startCount,
            duration: f.duration,
          })),
          dancerNames: project.dancerNames,
        }
      );

      setCueSheet(cueSheetResult);
      setCueSheetGeneratedWith(newGeneratedWith);

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

      // Show appropriate success message
      if (needsFullRegeneration) {
        showToast(`✓ Generated ${totalTransitions} cue sheet${totalTransitions > 1 ? 's' : ''}`, 'success', 5000);
      } else {
        const changedCount = transitionsToRegenerate.filter(t => t.reason === 'changed').length;
        const newCount = transitionsToRegenerate.filter(t => t.reason === 'new').length;
        const parts = [];
        if (changedCount > 0) parts.push(`updated ${changedCount}`);
        if (newCount > 0) parts.push(`added ${newCount}`);
        showToast(`✓ Cue sheets ${parts.join(', ')}`, 'success', 5000);
      }

    } catch (error) {
      console.error('Cue sheet generation failed:', error);
      setPathGenerationStatus('Cue sheet generation failed');
      showToast('Cue sheet generation failed. Check console for details.', 'error');
      setTimeout(() => setPathGenerationStatus(null), 3000);
    } finally {
      setIsGeneratingCueSheet(false);
    }
  }, [project.formations, project.stageWidth, project.stageHeight, allAlgorithmPaths, userSelectedAlgorithms, geminiResults, cueSheet, cueSheetGeneratedWith, showToast]);

  // Get paths for current formation using selected algorithm
  const getCurrentPaths = useCallback(() => {
    if (!selectedFormation) return null;

    const currentIndex = project.formations.findIndex(f => f.id === selectedFormationId);
    if (currentIndex === -1 || currentIndex >= project.formations.length - 1) return null;

    const nextFormation = project.formations[currentIndex + 1];
    const pathKey = `${selectedFormation.id}->${nextFormation.id}`;

    return getPathsForAlgorithm(pathKey, pathAlgorithm);
  }, [selectedFormation, selectedFormationId, project.formations, getPathsForAlgorithm, pathAlgorithm]);

  // Get paths based on current playback position (for use during playback)
  const getPlaybackPaths = useCallback(() => {
    if (project.formations.length < 2) return null;

    // Find current formation based on currentCount
    for (let i = 0; i < project.formations.length; i++) {
      const f = project.formations[i];
      if (currentCount >= f.startCount && currentCount < f.startCount + f.duration) {
        // Found current formation, check if there's a next one
        const nextFormation = project.formations[i + 1];
        if (!nextFormation) return null;

        const pathKey = `${f.id}->${nextFormation.id}`;
        return getPathsForAlgorithm(pathKey, pathAlgorithm);
      }
    }
    return null;
  }, [currentCount, project.formations, getPathsForAlgorithm, pathAlgorithm]);

  const currentPaths = getCurrentPaths();
  const playbackPaths = getPlaybackPaths();
  // Use playbackPaths when playing, otherwise use currentPaths (selected formation)
  const displayPaths = isPlaying ? playbackPaths : currentPaths;
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

    // Auto-generate paths if not all paths are generated (skip if already generating)
    if (!allPathsGenerated && project.formations.length >= 2 && !isGeneratingPaths) {
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

    // Calculate transition timing - account for holdCounts
    const transitionStart = currentFormation.startCount;
    const holdCounts = currentFormation.holdCounts || 0;
    const effectiveTransitionDuration = currentFormation.duration - holdCounts;
    const transitionEnd = transitionStart + effectiveTransitionDuration;

    if (currentCount < transitionStart) {
      return currentFormation.positions;
    }

    // During hold time (after transition complete), show next formation positions
    if (currentCount >= transitionEnd) {
      return nextFormation.positions;
    }

    // Calculate normalized time within transition (0 to 1)
    const t = effectiveTransitionDuration > 0
      ? (currentCount - transitionStart) / effectiveTransitionDuration
      : 1;

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
        const pathTime = t * effectiveTransitionDuration;
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
            <button
              className="settings-btn"
              onClick={() => setShowSettingsModal(true)}
              title="Project Settings"
            >
              <span className="settings-icon">⚙</span>
              Settings
            </button>
          </div>
          <div className="header-right">
          <button
            onClick={generateAllPathsWithRanking}
            className={`header-btn generate-all-btn ${isGeneratingPaths ? 'generating' : ''}`}
            disabled={isGeneratingPaths || isGeneratingCueSheet || project.formations.length < 2}
            title={
              project.formations.length < 2
                ? "Add at least 2 formations to generate paths"
                : isGeneratingPaths
                ? "Path generation in progress..."
                : isGeneratingCueSheet
                ? "Wait for cue sheet generation to complete"
                : "Generate all movement paths"
            }
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
            title={
              project.formations.length < 2
                ? "Add at least 2 formations to generate cue sheets"
                : isGeneratingCueSheet
                ? "Cue sheet generation in progress..."
                : isGeneratingPaths
                ? "Wait for path generation to complete"
                : "Generate cue sheets for all transitions"
            }
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
          <div className="header-divider" />
          <button
            className="mode-toggle-btn rehearsal-btn"
            onClick={() => {
              setUiMode('rehearsal');
              showToast('Entering Rehearsal Mode - Press ESC to return', 'info', 3000);
            }}
            title="Switch to Rehearsal Mode"
          >
            Rehearsal
          </button>
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
            <label className="metronome-toggle">
              <span className="metronome-label">Metronome</span>
              <div className={`toggle-switch ${metronomeEnabled ? 'active' : ''}`} onClick={() => setMetronomeEnabled(!metronomeEnabled)}>
                <div className="toggle-slider" />
              </div>
            </label>
            <span className="count-badge">Count: {Math.floor(currentCount)}</span>
            <button
              className="mode-toggle-btn"
              onClick={() => {
                setUiMode('edit');
                showToast('Switched to Edit Mode', 'info', 2000);
              }}
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
            <CustomSelect
              value={String(presetFilter)}
              onChange={(val) => setPresetFilter(val === 'all' ? 'all' : parseInt(val, 10))}
              className="preset-filter-select"
              options={[
                { value: 'all', label: `All (${ALL_PRESETS.length})` },
                ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(count => {
                  const countPresets = FORMATION_PRESETS.get(count) || [];
                  return { value: String(count), label: `${count}P (${countPresets.length})` };
                })
              ]}
            />
          </div>
          <div className="preset-grid-container">
            {presetFilter === 'all' ? (
              // Grouped view by dancer count
              [4, 5, 6, 7, 8, 9, 10, 11, 12].map(count => {
                const countPresets = ALL_PRESETS.filter(p => p.dancerCount === count);
                if (countPresets.length === 0) return null;
                return (
                  <div key={count} className="preset-group">
                    <div className="preset-group-header">{count}P</div>
                    <div className="preset-grid">
                      {countPresets.map((preset, idx) => (
                        <PresetPreview
                          key={`${preset.dancerCount}-${preset.name}-${idx}`}
                          preset={preset}
                          onClick={() => handleApplyPreset(preset)}
                          audienceAtTop={audienceAtTop}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              // Flat view for single dancer count
              <div className="preset-grid">
                {ALL_PRESETS
                  .filter(preset => preset.dancerCount === presetFilter)
                  .map((preset, idx) => (
                    <PresetPreview
                      key={`${preset.dancerCount}-${preset.name}-${idx}`}
                      preset={preset}
                      onClick={() => handleApplyPreset(preset)}
                      audienceAtTop={audienceAtTop}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Center - Stage view */}
        <div className={`stage-panel ${uiMode === 'rehearsal' ? 'stage-panel-fullwidth' : ''}`}>
          <div className="stage-header">
            <div className="stage-header-left">
              <h3>{selectedFormation?.label || `Formation ${selectedFormation ? project.formations.indexOf(selectedFormation) + 1 : '-'}`}</h3>
              <span className="count-display">Count: {Math.floor(currentCount)}</span>
            </div>
            {/* Selection Actions - Edit mode only, show when dancers selected */}
            {uiMode === 'edit' && selectedDancers.size >= 2 && (
              <div className="selection-actions">
                <span className="selection-count">{selectedDancers.size} selected</span>
                <button
                  className="rotate-btn"
                  onClick={() => rotateSelectedPositions('ccw')}
                  title="Rotate positions counter-clockwise"
                >
                  ↺
                </button>
                <button
                  className="rotate-btn"
                  onClick={() => rotateSelectedPositions('cw')}
                  title="Rotate positions clockwise"
                >
                  ↻
                </button>
              </div>
            )}
            {/* Formation Rotation - Edit mode only, when formation is selected */}
            {uiMode === 'edit' && selectedFormation && (
              <div className="formation-rotation-controls">
                <span className="rotation-label">Rotate:</span>
                {isRotating ? (
                  <>
                    <input
                      type="range"
                      className="rotation-slider"
                      min="-180"
                      max="180"
                      step="1"
                      value={rotationAngle}
                      onChange={(e) => applyRotationPreview(Number(e.target.value))}
                      onMouseUp={commitRotation}
                      onTouchEnd={commitRotation}
                    />
                    <span className="rotation-angle-display">{Math.round(rotationAngle)}°</span>
                    <button
                      className="rotation-cancel-btn"
                      onClick={cancelRotation}
                      title="Cancel rotation"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    className="rotation-start-btn"
                    onClick={startRotation}
                    title={selectedDancers.size > 0 ? `Rotate ${selectedDancers.size} selected dancers` : 'Rotate formation'}
                  >
                    {selectedDancers.size > 0 ? `↻ ${selectedDancers.size}` : '↻ All'}
                  </button>
                )}
              </div>
            )}
            {/* POV (Point of View) Selector - Rehearsal mode only */}
            {uiMode === 'rehearsal' && (
              <div className="stage-header-right">
                <div className="pov-selector">
                  <label>POV:</label>
                  <CustomSelect
                    value={typeof povMode === 'number' ? `dancer-${povMode}` : povMode}
                    onChange={(value) => {
                      if (value === 'choreographer') {
                        setPovMode('choreographer');
                      } else if (value.startsWith('dancer-')) {
                        setPovMode(parseInt(value.replace('dancer-', ''), 10));
                      }
                    }}
                    className="pov-select"
                    options={[
                      { value: 'choreographer', label: 'Choreographer' },
                      ...(selectedFormation?.positions.map((pos) => ({
                        value: `dancer-${pos.dancerId}`,
                        label: project.dancerNames?.[pos.dancerId] || `Dancer ${pos.dancerId}`
                      })) || [])
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Choreographer POV: Formation-specific notes above stage (Rehearsal mode only) */}
          {uiMode === 'rehearsal' && povMode === 'choreographer' && cueSheet && (
            (() => {
              // Find current formation's notes based on currentCount
              const currentFormationNote = cueSheet.formationNotes?.find(
                fn => currentCount >= fn.startCount && currentCount < fn.endCount
              );
              const currentFormation = project.formations.find(
                f => currentCount >= f.startCount && currentCount < f.startCount + f.duration
              );

              if (!currentFormationNote || currentFormationNote.notes.length === 0) {
                return null;
              }

              return (
                <div className={`pov-cue-sheet pov-general-notes ${isCueSheetCollapsed ? 'collapsed' : ''}`}>
                  <div className="pov-cue-card">
                    <div className="pov-cue-header">
                      <span className="pov-dancer-label">
                        👁️ {currentFormation?.label || `Formation ${currentFormationNote.formationIndex + 1}`}
                      </span>
                      {isCueSheetCollapsed && currentFormationNote.notes[0] && (
                        <span className="pov-cue-compact-info">{currentFormationNote.notes[0]}</span>
                      )}
                      <button
                        className="pov-cue-toggle"
                        onClick={() => setIsCueSheetCollapsed(!isCueSheetCollapsed)}
                        title={isCueSheetCollapsed ? 'Expand (C)' : 'Collapse (C)'}
                      >
                        {isCueSheetCollapsed ? '▼' : '▲'}
                      </button>
                    </div>
                    {!isCueSheetCollapsed && (
                      <div className="pov-cue-current">
                        <div className="pov-cue-time-badge">
                          {currentFormationNote.startCount}~{currentFormationNote.endCount}
                        </div>
                        {currentFormationNote.notes.map((note, i) => (
                          <div key={i} className="pov-cue-instruction-main" style={{ marginBottom: i < currentFormationNote.notes.length - 1 ? '8px' : 0 }}>
                            {note}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}

          {/* Individual Dancer Cue Sheet (POV mode) - Shows above stage (Rehearsal mode only) */}
          {uiMode === 'rehearsal' && typeof povMode === 'number' && cueSheet && (
            <div className={`pov-cue-sheet ${isCueSheetCollapsed ? 'collapsed' : ''}`}>
              {cueSheet.dancers
                .filter((dancer: DancerCueSheet) => dancer.dancerId === povMode)
                .map((dancer: DancerCueSheet) => {
                  // Find current cue for collapsed mode - flexible regex for various formats
                  const currentCueData = dancer.cues.find(cue => {
                    // Match patterns like "0~8", "0-8", "0~8 counts", "counts 0~8", etc.
                    const timeMatch = cue.timeRange.match(/(\d+)\s*[~\-]\s*(\d+)/);
                    if (!timeMatch) return false;
                    const startCount = parseInt(timeMatch[1]);
                    const endCount = parseInt(timeMatch[2]);
                    return currentCount >= startCount && currentCount < endCount;
                  });

                  return (
                    <div key={dancer.dancerId} className="pov-cue-card">
                      <div className="pov-cue-header">
                        <span className="pov-dancer-label">🎯 {project.dancerNames?.[dancer.dancerId] || dancer.dancerLabel}</span>
                        {!isCueSheetCollapsed && <span className="pov-dancer-summary">{dancer.summary}</span>}
                        {isCueSheetCollapsed && currentCueData && (
                          <span className="pov-cue-compact-info">{currentCueData.instruction}</span>
                        )}
                        <button
                          className="pov-cue-toggle"
                          onClick={() => setIsCueSheetCollapsed(!isCueSheetCollapsed)}
                          title={isCueSheetCollapsed ? 'Expand (C)' : 'Collapse (C)'}
                        >
                          {isCueSheetCollapsed ? '▼' : '▲'}
                        </button>
                      </div>
                      {!isCueSheetCollapsed && currentCueData && (
                        <div className="pov-cue-current">
                          <div className="pov-cue-time-badge">{currentCueData.timeRange}</div>
                          <div className="pov-cue-instruction-main">{currentCueData.instruction}</div>
                          {currentCueData.notes && (
                            <div className="pov-cue-notes">{currentCueData.notes}</div>
                          )}
                        </div>
                      )}
                      {!isCueSheetCollapsed && !currentCueData && (
                        <div className="pov-cue-current pov-cue-waiting">
                          <div className="pov-cue-instruction-main">Ready for next cue...</div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
            {showPaths && displayPaths && displayPaths.map((pathData) => {
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
              const isSwapTarget = swapSourceDancerId === dancer.dancerId;
              const dancerName = project.dancerNames?.[dancer.dancerId];
              return (
                <DancerCircle
                  key={dancer.dancerId}
                  id={dancer.dancerId}
                  x={screenPos.x}
                  y={screenPos.y}
                  radius={0.4 * scale}
                  color={dancer.color}
                  name={dancerName}
                  isSelected={uiMode === 'edit' && selectedDancers.has(dancer.dancerId)}
                  isSwapTarget={isSwapTarget}
                  isPovHighlight={isPovDancer}
                  isDimmed={isDimmed}
                  onMouseDown={uiMode === 'edit' ? (e) => handleDancerMouseDown(dancer.dancerId, e) : undefined}
                  onDoubleClick={uiMode === 'edit' ? () => handleDancerDoubleClick(dancer.dancerId) : undefined}
                  onContextMenu={uiMode === 'edit' ? (e) => handleDancerRightClick(dancer.dancerId, e.clientX, e.clientY) : undefined}
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
              {/* Formation Selection Header - Clear indicator of what's being edited */}
              <div className="formation-selection-header">
                <div className="formation-selection-badge">
                  <span className="formation-number">#{project.formations.findIndex(f => f.id === selectedFormation.id) + 1}</span>
                </div>
                <div className="formation-selection-info">
                  <span className="formation-selection-label">Editing:</span>
                  <span className="formation-selection-name">
                    {selectedFormation.label || `Formation ${project.formations.findIndex(f => f.id === selectedFormation.id) + 1}`}
                  </span>
                </div>
              </div>

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
                <CustomSelect
                  value={String(selectedFormation.duration)}
                  onChange={(val) => updateFormation(selectedFormation.id, { duration: parseInt(val, 10) })}
                  options={[
                    { value: '1', label: '1 count' },
                    { value: '2', label: '2 counts' },
                    { value: '3', label: '3 counts' },
                    { value: '4', label: '4 counts' },
                    { value: '5', label: '5 counts' },
                    { value: '6', label: '6 counts' },
                    { value: '7', label: '7 counts' },
                    { value: '8', label: '8 counts' },
                  ]}
                />
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
                  Exit All
                </button>
              </div>

              {/* Path generation section - Collapsible */}
              <div className={`path-section collapsible-section ${collapsedSections.has('paths') ? 'collapsed' : ''}`}>
                <h4
                  className="collapsible-header"
                  onClick={() => toggleSection('paths')}
                >
                  <span className="collapse-icon">{collapsedSections.has('paths') ? '▶' : '▼'}</span>
                  Movement Paths
                  {currentPaths && <span className="section-badge">✓</span>}
                </h4>
                {!collapsedSections.has('paths') && (
                <>
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
                            className={`algorithm-card ${isSelected ? 'selected' : ''} ${isGeminiPick ? 'gemini-pick' : ''} ${pathGenerationProgress ? 'disabled' : ''}`}
                            title={`Overview: ${PATH_ALGORITHM_DESCRIPTIONS[algo]}`}
                            onClick={() => {
                              // Only block during actual path computation, allow during Gemini ranking
                              if (!pathGenerationProgress) {
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
                      {/* Best pick reason - show only if pick is in available algorithms */}
                      {currentGeminiResult.pickReason && currentUniqueAlgorithms.includes(currentGeminiResult.pick) && (
                        <div className="gemini-pick-reason">
                          <div className="pick-header">
                            <span className="pick-label">⭐ Gemini's Pick:</span>
                            <span className="pick-algorithm">{PATH_ALGORITHM_LABELS[currentGeminiResult.pick]}</span>
                          </div>
                          <div className="pick-reason">
                            <span className="reason-label">Why for this transition:</span> {currentGeminiResult.pickReason}
                          </div>
                        </div>
                      )}
                      <div className="score-list">
                        {Array.from(currentGeminiResult.scores.entries())
                          .filter(([algo]) => currentUniqueAlgorithms.includes(algo))
                          .sort((a, b) => b[1] - a[1])
                          .map(([algo, score]) => (
                            <div
                              key={algo}
                              className={`score-item ${algo === currentGeminiResult.pick ? 'pick' : ''} ${algo === pathAlgorithm ? 'selected' : ''} ${pathGenerationProgress ? 'disabled' : ''}`}
                              title={`Overview: ${PATH_ALGORITHM_DESCRIPTIONS[algo]}`}
                              onClick={() => !pathGenerationProgress && setPathAlgorithm(algo)}
                            >
                              <div className="score-item-header">
                                <span className="algo-name">{PATH_ALGORITHM_LABELS[algo]}</span>
                                <span className="algo-score">{score}</span>
                                {algo === currentGeminiResult.pick && <span className="pick-star">★</span>}
                              </div>
                              {/* Gemini insight - context-specific */}
                              {currentGeminiResult.insights?.get(algo) && (
                                <div className="algo-insight">
                                  <span className="insight-label">→</span> {currentGeminiResult.insights.get(algo)}
                                </div>
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
                      title={isGeneratingPaths ? "Path generation in progress..." : "Generate movement paths for this transition"}
                    >
                      {isGeneratingPaths ? 'Generating...' : 'Generate Paths'}
                    </button>

                    {/* Status display with progress bar */}
                    {isGeneratingPaths && pathGenerationProgress && (
                      <div className="path-generation-status loading">
                        <div className="generation-progress-container">
                          <div className="generation-progress-header">
                            <span className="loading-spinner" />
                            <span className="generation-progress-text">
                              Computing algorithms ({pathGenerationProgress.current}/{pathGenerationProgress.total})
                            </span>
                          </div>
                          <div className="generation-progress-bar">
                            <div
                              className="generation-progress-fill"
                              style={{ width: `${(pathGenerationProgress.current / pathGenerationProgress.total) * 100}%` }}
                            />
                          </div>
                          <div className="generation-progress-algorithm">
                            {pathGenerationProgress.algorithm}
                          </div>
                        </div>
                      </div>
                    )}
                    {pathGenerationStatus && !isGeneratingPaths && (
                      <div className="path-generation-status success">
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
                            title={isGeneratingCueSheet ? "Cue sheet generation in progress..." : "Generate cue sheets for dancers"}
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
                </>
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
        <button onClick={handleStop} className="playback-btn" title="Stop" disabled={!!pathGenerationProgress}>⏹</button>
        {isPlaying ? (
          <button onClick={handlePause} className="playback-btn" title="Pause">⏸</button>
        ) : pathGenerationProgress ? (
          <button className="playback-btn primary generating" disabled title="Generating paths...">
            <span className="loading-spinner small" />
          </button>
        ) : (
          <button onClick={handlePlay} className="playback-btn primary" title="Play">▶</button>
        )}
        {isGeneratingPaths && (
          <span className="playback-status">
            {pathGenerationProgress
              ? `${pathGenerationProgress.algorithm} (${pathGenerationProgress.current}/${pathGenerationProgress.total})`
              : pathGenerationStatus || 'Ranking with Gemini...'}
          </span>
        )}
        <label className="metronome-toggle">
          <span className="metronome-label">Metronome</span>
          <div className={`toggle-switch ${metronomeEnabled ? 'active' : ''}`} onClick={() => setMetronomeEnabled(!metronomeEnabled)}>
            <div className="toggle-slider" />
          </div>
        </label>
        <div className="speed-control">
          <label>Speed:</label>
          <CustomSelect
            value={String(playbackSpeed)}
            onChange={(val) => setPlaybackSpeed(parseFloat(val))}
            options={[
              { value: '0.25', label: '0.25x' },
              { value: '0.5', label: '0.5x' },
              { value: '1', label: '1x' },
              { value: '1.5', label: '1.5x' },
              { value: '2', label: '2x' },
              { value: '3', label: '3x' },
              { value: '4', label: '4x' },
            ]}
          />
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
          onDuplicateFormation={duplicateFormation}
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
          onReorderFormation={reorderFormation}
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
                    <span className="dancer-label">{project.dancerNames?.[dancer.dancerId] || dancer.dancerLabel}</span>
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

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        dancerCount={project.dancerCount}
        dancerNames={project.dancerNames || {}}
        dancerColors={
          selectedFormation
            ? Object.fromEntries(selectedFormation.positions.map(p => [p.dancerId, p.color]))
            : {}
        }
        swapSourceDancerId={swapSourceDancerId}
        onUpdateDancerName={updateDancerName}
        onUpdateDancerCount={handleDancerCountChange}
        onDeleteSpecificDancer={deleteSpecificDancer}
        stageWidth={project.stageWidth}
        stageHeight={project.stageHeight}
        onUpdateStageSize={handleStageSizeChange}
        audienceAtTop={audienceAtTop}
        onUpdateAudienceDirection={setAudienceAtTop}
      />

      {/* New Project Confirm Dialog */}
      <ConfirmDialog
        isOpen={showConfirmNew}
        title="Create New Project"
        message="Create a new project? All unsaved changes will be lost."
        onConfirm={confirmNewProject}
        onCancel={() => setShowConfirmNew(false)}
        confirmText="Create New"
        cancelText="Cancel"
        isDangerous
      />

      {/* Quick Swap Popup */}
      {quickSwapPopup && selectedFormation && (
        <div
          className="quick-swap-overlay"
          onClick={closeQuickSwapPopup}
        >
          <div
            className="quick-swap-popup"
            style={{
              left: quickSwapPopup.screenX,
              top: quickSwapPopup.screenY,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="quick-swap-header">
              <span>Swap #{quickSwapPopup.sourceDancerId} with:</span>
              <button className="quick-swap-close" onClick={closeQuickSwapPopup}>×</button>
            </div>
            <div className="quick-swap-list">
              {selectedFormation.positions
                .filter(p => p.dancerId !== quickSwapPopup.sourceDancerId)
                .map(p => (
                  <button
                    key={p.dancerId}
                    className="quick-swap-item"
                    onClick={() => handleQuickSwapSelect(p.dancerId)}
                  >
                    <span
                      className="quick-swap-badge"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.dancerId}
                    </span>
                    <span className="quick-swap-name">
                      {project.dancerNames?.[p.dancerId] || `Dancer ${p.dancerId}`}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Stack */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast-notification ${t.type}`}
              onClick={() => {
                if (t.type === 'success' && cueSheet) {
                  setShowCueSheet(true);
                }
                removeToast(t.id);
              }}
            >
              <span>{t.message}</span>
              <button className="toast-close" onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}>×</button>
              <div
                className="toast-progress"
                style={{ animationDuration: `${t.duration}ms` }}
              />
            </div>
          ))}
        </div>
      )}

      {/* First-time User Onboarding */}
      {showOnboarding && (
        <div className="onboarding-overlay" onClick={dismissOnboarding}>
          <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
            <div className="onboarding-header">
              <h2>Welcome to Dance Choreography Editor! 💃</h2>
            </div>
            <div className="onboarding-content">
              <div className="onboarding-steps">
                <div className="onboarding-step">
                  <span className="step-number">1</span>
                  <div className="step-content">
                    <h4>Create Formations</h4>
                    <p>Add formations with the + button and drag dancers on stage to position them.</p>
                  </div>
                </div>
                <div className="onboarding-step">
                  <span className="step-number">2</span>
                  <div className="step-content">
                    <h4>Generate Paths</h4>
                    <p>Generate movement paths and let AI help you choose the best option.</p>
                  </div>
                </div>
                <div className="onboarding-step">
                  <span className="step-number">3</span>
                  <div className="step-content">
                    <h4>Export Cue Sheet</h4>
                    <p>Use Gemini to generate cue sheets with step-by-step instructions for each dancer.</p>
                  </div>
                </div>
              </div>
              <div className="onboarding-tips">
                <h4>Quick Tips</h4>
                <ul>
                  <li><kbd>Space</kbd> Play/Pause</li>
                  <li><kbd>Ctrl+Z</kbd> Undo</li>
                  <li><kbd>Ctrl+S</kbd> Save project</li>
                  <li>Double-click dancers to swap positions</li>
                </ul>
              </div>
            </div>
            <div className="onboarding-footer">
              <button className="onboarding-dismiss" onClick={dismissOnboarding}>
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineEditor;
