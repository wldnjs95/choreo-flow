/**
 * useFormationEditor Hook
 * Custom hook for managing formation editing state with undo/redo support
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Position } from '../types';

export interface UseFormationEditorOptions {
  initialPositions: Position[];
  maxHistory?: number;
}

export interface UseFormationEditorReturn {
  // State
  positions: Position[];
  selectedIds: Set<number>;
  history: Position[][];
  future: Position[][];

  // Actions
  setPositions: (positions: Position[]) => void;
  updatePosition: (index: number, position: Position) => void;
  updatePositions: (updates: { index: number; position: Position }[]) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectAll: () => void;
  clearSelection: () => void;
  toggleSelection: (id: number) => void;

  // History
  saveToHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Custom hook for formation editing with history support
 */
export function useFormationEditor({
  initialPositions,
  maxHistory = 50,
}: UseFormationEditorOptions): UseFormationEditorReturn {
  const [positions, setPositionsInternal] = useState<Position[]>(initialPositions);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<Position[][]>([]);
  const [future, setFuture] = useState<Position[][]>([]);

  // Track if we should save to history on next position change
  const shouldSaveToHistory = useRef(false);
  const lastSavedPositions = useRef<Position[]>(initialPositions);

  // Update positions from external source
  useEffect(() => {
    if (JSON.stringify(initialPositions) !== JSON.stringify(lastSavedPositions.current)) {
      setPositionsInternal(initialPositions);
      lastSavedPositions.current = initialPositions;
    }
  }, [initialPositions]);

  // Save current state to history
  const saveToHistory = useCallback(() => {
    setHistory(prev => {
      const newHistory = [...prev, [...positions]];
      return newHistory.length > maxHistory ? newHistory.slice(-maxHistory) : newHistory;
    });
    setFuture([]);
    lastSavedPositions.current = positions;
  }, [positions, maxHistory]);

  // Set positions with optional history save
  const setPositions = useCallback((newPositions: Position[]) => {
    if (shouldSaveToHistory.current) {
      saveToHistory();
      shouldSaveToHistory.current = false;
    }
    setPositionsInternal(newPositions);
  }, [saveToHistory]);

  // Update single position
  const updatePosition = useCallback((index: number, position: Position) => {
    setPositionsInternal(prev => {
      const newPositions = [...prev];
      newPositions[index] = position;
      return newPositions;
    });
  }, []);

  // Update multiple positions
  const updatePositions = useCallback((updates: { index: number; position: Position }[]) => {
    setPositionsInternal(prev => {
      const newPositions = [...prev];
      updates.forEach(({ index, position }) => {
        newPositions[index] = position;
      });
      return newPositions;
    });
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (history.length === 0) return;

    const previousState = history[history.length - 1];
    setFuture(prev => [...prev, positions]);
    setHistory(prev => prev.slice(0, -1));
    setPositionsInternal(previousState);
  }, [history, positions]);

  // Redo
  const redo = useCallback(() => {
    if (future.length === 0) return;

    const nextState = future[future.length - 1];
    setHistory(prev => [...prev, positions]);
    setFuture(prev => prev.slice(0, -1));
    setPositionsInternal(nextState);
  }, [future, positions]);

  // Selection helpers
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(positions.map((_, i) => i)));
  }, [positions]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  return {
    positions,
    selectedIds,
    history,
    future,
    setPositions,
    updatePosition,
    updatePositions,
    setSelectedIds,
    selectAll,
    clearSelection,
    toggleSelection,
    saveToHistory,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  };
}

/**
 * Hook for keyboard shortcuts in formation editor
 */
export function useFormationKeyboardShortcuts({
  undo,
  redo,
  selectAll,
  clearSelection,
}: {
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  clearSelection: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      }
      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectAll, clearSelection]);
}
