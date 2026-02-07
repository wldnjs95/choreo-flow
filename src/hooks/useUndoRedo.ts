/**
 * useUndoRedo Hook
 * Manages undo/redo history for state changes
 */

import { useState, useCallback, useRef } from 'react';
import { MAX_UNDO_HISTORY } from '../constants/editor';

interface UseUndoRedoOptions {
  maxHistory?: number;
  onUndo?: () => void;
  onRedo?: () => void;
}

interface UseUndoRedoReturn<T> {
  saveToHistory: () => void;
  handleUndo: () => T | null;
  handleRedo: () => T | null;
  canUndo: boolean;
  canRedo: boolean;
  isUndoing: boolean;
}

export function useUndoRedo<T>(
  currentState: T,
  options: UseUndoRedoOptions = {}
): UseUndoRedoReturn<T> {
  const { maxHistory = MAX_UNDO_HISTORY, onUndo, onRedo } = options;

  const [undoHistory, setUndoHistory] = useState<T[]>([]);
  const [redoHistory, setRedoHistory] = useState<T[]>([]);
  const isUndoingRef = useRef(false);

  const saveToHistory = useCallback(() => {
    if (isUndoingRef.current) return;
    setUndoHistory(prev => {
      const newHistory = [...prev, currentState];
      if (newHistory.length > maxHistory) {
        return newHistory.slice(-maxHistory);
      }
      return newHistory;
    });
    setRedoHistory([]);
  }, [currentState, maxHistory]);

  const handleUndo = useCallback((): T | null => {
    if (undoHistory.length === 0) return null;

    isUndoingRef.current = true;
    const previousState = undoHistory[undoHistory.length - 1];

    setRedoHistory(prev => [...prev, currentState]);
    setUndoHistory(prev => prev.slice(0, -1));

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    onUndo?.();
    return previousState;
  }, [undoHistory, currentState, onUndo]);

  const handleRedo = useCallback((): T | null => {
    if (redoHistory.length === 0) return null;

    isUndoingRef.current = true;
    const nextState = redoHistory[redoHistory.length - 1];

    setUndoHistory(prev => [...prev, currentState]);
    setRedoHistory(prev => prev.slice(0, -1));

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    onRedo?.();
    return nextState;
  }, [redoHistory, currentState, onRedo]);

  return {
    saveToHistory,
    handleUndo,
    handleRedo,
    canUndo: undoHistory.length > 0,
    canRedo: redoHistory.length > 0,
    isUndoing: isUndoingRef.current,
  };
}
