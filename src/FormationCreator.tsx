import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { generateFormation } from './algorithms';
import type { FormationType, Position, SavedFormation, FormationCollection } from './types';
import {
  DEFAULT_STAGE_WIDTH,
  DEFAULT_STAGE_HEIGHT,
  BASE_SCALE,
  PADDING,
  BASE_DANCER_RADIUS,
  GRID_COLOR,
  BACKGROUND_COLOR,
  DANCER_COLORS,
  STAGE_PRESETS,
  type StagePresetKey,
} from './constants';

// Re-export types for backward compatibility
export type { SavedFormation, FormationCollection } from './types';

function FormationCreator() {
  // Stage settings
  const [stagePreset, setStagePreset] = useState<StagePresetKey>('large');
  const [stageWidth, setStageWidth] = useState(DEFAULT_STAGE_WIDTH);
  const [stageHeight, setStageHeight] = useState(DEFAULT_STAGE_HEIGHT);

  // Formation settings
  const [dancerCount, setDancerCount] = useState(8);
  const [positions, setPositions] = useState<Position[]>(() =>
    generateFormation('scatter', 8, { stageWidth: DEFAULT_STAGE_WIDTH, stageHeight: DEFAULT_STAGE_HEIGHT })
  );
  const [formationName, setFormationName] = useState('');
  const [formationDescription, setFormationDescription] = useState('');

  // Saved formations list
  const [savedFormations, setSavedFormations] = useState<SavedFormation[]>([]);

  // UI states
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize] = useState(0.5);
  const [currentPreset, setCurrentPreset] = useState<FormationType | null>('scatter');

  // Multi-selection drag
  const [selectionBox, setSelectionBox] = useState<{
    startX: number; startY: number; endX: number; endY: number;
  } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const initialPositionsRef = useRef<Position[]>([]);

  // Undo/Redo
  const [history, setHistory] = useState<Position[][]>([]);
  const [future, setFuture] = useState<Position[][]>([]);

  const svgRef = useRef<SVGSVGElement>(null);

  // Calculate scale based on stage size
  const scale = useMemo(() => {
    const maxWidth = 800;
    const maxHeight = 600;
    const scaleX = (maxWidth - PADDING * 2) / stageWidth;
    const scaleY = (maxHeight - PADDING * 2) / stageHeight;
    return Math.min(scaleX, scaleY, BASE_SCALE);
  }, [stageWidth, stageHeight]);

  const dancerRadius = BASE_DANCER_RADIUS * scale;

  // Load saved formations from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('savedFormations');
    if (saved) {
      try {
        const data: FormationCollection = JSON.parse(saved);
        setSavedFormations(data.formations || []);
      } catch (e) {
        console.error('Failed to load saved formations:', e);
      }
    }
  }, []);

  // Save to localStorage
  const saveToLocalStorage = useCallback((formations: SavedFormation[]) => {
    const data: FormationCollection = {
      formations,
      version: '1.0',
    };
    localStorage.setItem('savedFormations', JSON.stringify(data));
  }, []);

  // Apply stage preset
  const handlePresetChange = useCallback((preset: StagePresetKey) => {
    setStagePreset(preset);
    if (preset !== 'custom') {
      setStageWidth(STAGE_PRESETS[preset].width);
      setStageHeight(STAGE_PRESETS[preset].height);
      // Regenerate positions for new stage size
      if (currentPreset) {
        setPositions(generateFormation(currentPreset, dancerCount, {
          stageWidth: STAGE_PRESETS[preset].width,
          stageHeight: STAGE_PRESETS[preset].height,
        }));
      }
    }
  }, [currentPreset, dancerCount]);

  // Apply formation preset
  const applyFormationPreset = useCallback((type: FormationType) => {
    const newPositions = generateFormation(type, dancerCount, { stageWidth, stageHeight });
    saveToHistory(positions);
    setPositions(newPositions);
    setCurrentPreset(type);
  }, [dancerCount, stageWidth, stageHeight, positions]);

  // Change dancer count
  const handleDancerCountChange = useCallback((count: number) => {
    const newCount = Math.max(1, Math.min(16, count));
    setDancerCount(newCount);
    if (currentPreset) {
      setPositions(generateFormation(currentPreset, newCount, { stageWidth, stageHeight }));
    } else {
      // Adjust positions array
      if (newCount > positions.length) {
        const additionalPositions = generateFormation('scatter', newCount - positions.length, { stageWidth, stageHeight });
        setPositions([...positions, ...additionalPositions]);
      } else {
        setPositions(positions.slice(0, newCount));
      }
    }
    setSelectedIds(new Set());
  }, [currentPreset, positions, stageWidth, stageHeight]);

  // History management
  const saveToHistory = useCallback((currentPos: Position[]) => {
    setHistory(prev => {
      const newHistory = [...prev, currentPos];
      return newHistory.length > 50 ? newHistory.slice(-50) : newHistory;
    });
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setFuture(prev => [...prev, positions]);
    setHistory(prev => prev.slice(0, -1));
    setPositions(previousState);
  }, [history, positions]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const nextState = future[future.length - 1];
    setHistory(prev => [...prev, positions]);
    setFuture(prev => prev.slice(0, -1));
    setPositions(nextState);
  }, [future, positions]);

  // Snap to grid
  const snapToGrid = useCallback((value: number): number => {
    if (!snapEnabled) return value;
    return Math.round(value / snapSize) * snapSize;
  }, [snapEnabled, snapSize]);

  // Convert screen coords to stage coords
  const screenToStage = useCallback((clientX: number, clientY: number): Position => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - PADDING) / scale;
    const y = stageHeight - (clientY - rect.top - PADDING) / scale;
    return { x, y };
  }, [scale, stageHeight]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent, dancerId: number) => {
    e.stopPropagation();

    if (e.shiftKey) {
      // Toggle selection with shift
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(dancerId)) {
          newSet.delete(dancerId);
        } else {
          newSet.add(dancerId);
        }
        return newSet;
      });
    } else if (!selectedIds.has(dancerId)) {
      setSelectedIds(new Set([dancerId]));
    }

    setDraggingId(dancerId);
    const stagePos = screenToStage(e.clientX, e.clientY);
    dragStartRef.current = stagePos;
    initialPositionsRef.current = [...positions];
  }, [selectedIds, screenToStage, positions]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (selectionBox) {
      const stagePos = screenToStage(e.clientX, e.clientY);
      setSelectionBox(prev => prev ? { ...prev, endX: stagePos.x, endY: stagePos.y } : null);
      return;
    }

    if (draggingId === null || !dragStartRef.current) return;

    const currentPos = screenToStage(e.clientX, e.clientY);
    const dx = currentPos.x - dragStartRef.current.x;
    const dy = currentPos.y - dragStartRef.current.y;

    const idsToMove = selectedIds.has(draggingId) ? selectedIds : new Set([draggingId]);

    setPositions(initialPositionsRef.current.map((pos, idx) => {
      if (idsToMove.has(idx)) {
        return {
          x: Math.max(0.5, Math.min(stageWidth - 0.5, snapToGrid(pos.x + dx))),
          y: Math.max(0.5, Math.min(stageHeight - 0.5, snapToGrid(pos.y + dy))),
        };
      }
      return pos;
    }));
    setCurrentPreset(null);
  }, [draggingId, selectedIds, screenToStage, snapToGrid, stageWidth, stageHeight, selectionBox]);

  const handleMouseUp = useCallback(() => {
    if (draggingId !== null) {
      saveToHistory(initialPositionsRef.current);
    }

    if (selectionBox) {
      // Select dancers in box
      const minX = Math.min(selectionBox.startX, selectionBox.endX);
      const maxX = Math.max(selectionBox.startX, selectionBox.endX);
      const minY = Math.min(selectionBox.startY, selectionBox.endY);
      const maxY = Math.max(selectionBox.startY, selectionBox.endY);

      const selected = new Set<number>();
      positions.forEach((pos, idx) => {
        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
          selected.add(idx);
        }
      });
      setSelectedIds(selected);
      setSelectionBox(null);
    }

    setDraggingId(null);
    dragStartRef.current = null;
  }, [draggingId, selectionBox, positions, saveToHistory]);

  const handleStageMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).tagName === 'rect') {
      const stagePos = screenToStage(e.clientX, e.clientY);
      setSelectionBox({ startX: stagePos.x, startY: stagePos.y, endX: stagePos.x, endY: stagePos.y });
      setSelectedIds(new Set());
    }
  }, [screenToStage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        setSelectedIds(new Set(positions.map((_, i) => i)));
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, positions]);

  // Save current formation
  const saveFormation = useCallback(() => {
    if (!formationName.trim()) {
      alert('Please enter a formation name');
      return;
    }

    const newFormation: SavedFormation = {
      name: formationName.trim(),
      dancerCount,
      positions: [...positions],
      stageWidth,
      stageHeight,
      createdAt: new Date().toISOString(),
      description: formationDescription.trim() || undefined,
    };

    const updated = [...savedFormations, newFormation];
    setSavedFormations(updated);
    saveToLocalStorage(updated);
    setFormationName('');
    setFormationDescription('');
    alert(`Formation "${newFormation.name}" saved!`);
  }, [formationName, formationDescription, dancerCount, positions, stageWidth, stageHeight, savedFormations, saveToLocalStorage]);

  // Load a saved formation
  const loadFormation = useCallback((formation: SavedFormation) => {
    setDancerCount(formation.dancerCount);
    setPositions([...formation.positions]);
    setStageWidth(formation.stageWidth);
    setStageHeight(formation.stageHeight);
    setCurrentPreset(null);
    setSelectedIds(new Set());
  }, []);

  // Delete a saved formation
  const deleteFormation = useCallback((index: number) => {
    if (!confirm('Are you sure you want to delete this formation?')) return;
    const updated = savedFormations.filter((_, i) => i !== index);
    setSavedFormations(updated);
    saveToLocalStorage(updated);
  }, [savedFormations, saveToLocalStorage]);

  // Export formations to JSON file
  const exportFormations = useCallback(() => {
    const data: FormationCollection = {
      formations: savedFormations,
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formations_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [savedFormations]);

  // Export current formation only
  const exportCurrentFormation = useCallback(() => {
    if (!formationName.trim()) {
      alert('Please enter a formation name first');
      return;
    }
    const formation: SavedFormation = {
      name: formationName.trim(),
      dancerCount,
      positions: [...positions],
      stageWidth,
      stageHeight,
      createdAt: new Date().toISOString(),
      description: formationDescription.trim() || undefined,
    };
    const data: FormationCollection = {
      formations: [formation],
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formationName.trim().replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [formationName, formationDescription, dancerCount, positions, stageWidth, stageHeight]);

  // Import formations from JSON file
  const importFormations = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data: FormationCollection = JSON.parse(event.target?.result as string);
        if (data.formations && Array.isArray(data.formations)) {
          const updated = [...savedFormations, ...data.formations];
          setSavedFormations(updated);
          saveToLocalStorage(updated);
          alert(`Imported ${data.formations.length} formation(s)`);
        }
      } catch (err) {
        alert('Failed to import file: Invalid JSON format');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [savedFormations, saveToLocalStorage]);

  // SVG dimensions
  const svgWidth = stageWidth * scale + PADDING * 2;
  const svgHeight = stageHeight * scale + PADDING * 2;

  // Grid lines
  const gridLines = useMemo(() => {
    const lines = [];
    for (let x = 0; x <= stageWidth; x++) {
      lines.push(
        <line
          key={`v-${x}`}
          x1={PADDING + x * scale}
          y1={PADDING}
          x2={PADDING + x * scale}
          y2={PADDING + stageHeight * scale}
          stroke={GRID_COLOR}
          strokeWidth={x % 5 === 0 ? 2 : 1}
        />
      );
    }
    for (let y = 0; y <= stageHeight; y++) {
      lines.push(
        <line
          key={`h-${y}`}
          x1={PADDING}
          y1={PADDING + y * scale}
          x2={PADDING + stageWidth * scale}
          y2={PADDING + y * scale}
          stroke={GRID_COLOR}
          strokeWidth={y % 5 === 0 ? 2 : 1}
        />
      );
    }
    return lines;
  }, [stageWidth, stageHeight, scale]);

  // Axis labels
  const labels = useMemo(() => {
    const result = [];
    for (let x = 0; x <= stageWidth; x += 2) {
      result.push(
        <text key={`lx-${x}`} x={PADDING + x * scale} y={svgHeight - 10} textAnchor="middle" fill="#666" fontSize="11">
          {x}m
        </text>
      );
    }
    for (let y = 0; y <= stageHeight; y += 2) {
      result.push(
        <text key={`ly-${y}`} x={10} y={PADDING + (stageHeight - y) * scale + 4} textAnchor="start" fill="#666" fontSize="11">
          {y}m
        </text>
      );
    }
    return result;
  }, [stageWidth, stageHeight, scale, svgHeight]);

  const formationTypes: FormationType[] = ['line', 'circle', 'v_shape', 'diagonal', 'scatter', 'heart', 'diamond', 'triangle', 'two_lines'];

  return (
    <div className="choreography-container">
      <div className="header">
        <h1>Formation Creator</h1>
        <p>Create and save custom formations for choreography</p>
        <Link to="/" style={{ color: '#4ECDC4', textDecoration: 'none', fontSize: '14px' }}>
          &larr; Back to Choreography
        </Link>
      </div>

      <div className="main-content" style={{ alignItems: 'flex-start' }}>
        {/* Left Panel - Controls */}
        <div className="info-panel" style={{ width: '280px' }}>
          {/* Stage Settings */}
          <div className="panel-section">
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>Stage Settings</h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '13px', color: '#aaa' }}>Stage Size</label>
              <select
                value={stagePreset}
                onChange={(e) => handlePresetChange(e.target.value as StagePresetKey)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '4px',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: '#fff',
                }}
              >
                {Object.entries(STAGE_PRESETS).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>

            {stagePreset === 'custom' && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#888' }}>Width (m)</label>
                  <input
                    type="number"
                    value={stageWidth}
                    onChange={(e) => setStageWidth(Number(e.target.value))}
                    min={5}
                    max={30}
                    style={{
                      width: '100%',
                      padding: '6px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#888' }}>Height (m)</label>
                  <input
                    type="number"
                    value={stageHeight}
                    onChange={(e) => setStageHeight(Number(e.target.value))}
                    min={5}
                    max={25}
                    style={{
                      width: '100%',
                      padding: '6px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      color: '#fff',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Dancer Count */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>Dancers</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => handleDancerCountChange(dancerCount - 1)}
                disabled={dancerCount <= 1}
                style={{
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                -
              </button>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#4ECDC4' }}>{dancerCount}</span>
              <button
                onClick={() => handleDancerCountChange(dancerCount + 1)}
                disabled={dancerCount >= 16}
                style={{
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Formation Presets */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>Formation Presets</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {formationTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => applyFormationPreset(type)}
                  style={{
                    padding: '6px 10px',
                    background: currentPreset === type ? 'linear-gradient(135deg, #4ECDC4, #45B7D1)' : 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {type.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Grid Snap */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="snap"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              <label htmlFor="snap" style={{ fontSize: '13px', color: '#aaa' }}>
                Snap to grid ({snapSize}m)
              </label>
            </div>
          </div>

          {/* Undo/Redo */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={undo}
                disabled={history.length === 0}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: history.length === 0 ? '#666' : '#fff',
                  cursor: history.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Undo
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: future.length === 0 ? '#666' : '#fff',
                  cursor: future.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Redo
              </button>
            </div>
          </div>
        </div>

        {/* Center - Stage */}
        <div className="stage-wrapper">
          <svg
            ref={svgRef}
            width={svgWidth}
            height={svgHeight}
            style={{
              background: BACKGROUND_COLOR,
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              cursor: selectionBox ? 'crosshair' : 'default',
            }}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Stage background */}
            <rect
              x={PADDING}
              y={PADDING}
              width={stageWidth * scale}
              height={stageHeight * scale}
              fill="rgba(40, 40, 60, 0.5)"
              stroke="#444"
              strokeWidth={2}
              rx={4}
            />

            {/* Grid */}
            {gridLines}
            {labels}

            {/* Center line */}
            <line
              x1={PADDING + (stageWidth / 2) * scale}
              y1={PADDING}
              x2={PADDING + (stageWidth / 2) * scale}
              y2={PADDING + stageHeight * scale}
              stroke="#444"
              strokeWidth={2}
              strokeDasharray="10,5"
            />

            {/* Selection box */}
            {selectionBox && (
              <rect
                x={PADDING + Math.min(selectionBox.startX, selectionBox.endX) * scale}
                y={PADDING + (stageHeight - Math.max(selectionBox.startY, selectionBox.endY)) * scale}
                width={Math.abs(selectionBox.endX - selectionBox.startX) * scale}
                height={Math.abs(selectionBox.endY - selectionBox.startY) * scale}
                fill="rgba(78, 205, 196, 0.2)"
                stroke="#4ECDC4"
                strokeWidth={1}
                strokeDasharray="4,2"
              />
            )}

            {/* Dancers */}
            {positions.map((pos, idx) => {
              const x = PADDING + pos.x * scale;
              const y = PADDING + (stageHeight - pos.y) * scale;
              const isSelected = selectedIds.has(idx);

              return (
                <g
                  key={idx}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => handleMouseDown(e, idx)}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={dancerRadius}
                    fill={DANCER_COLORS[idx % DANCER_COLORS.length]}
                    stroke={isSelected ? '#fff' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={isSelected ? 3 : 2}
                    style={{
                      filter: isSelected ? 'drop-shadow(0 0 10px rgba(255,255,255,0.5))' : 'none',
                    }}
                  />
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize={Math.max(12, dancerRadius * 0.9)}
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth={0.5}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {idx + 1}
                  </text>
                </g>
              );
            })}
          </svg>

          <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
            Tip: Drag dancers to move. Shift+click to multi-select. Drag on empty space to box-select.
          </div>
        </div>

        {/* Right Panel - Save/Load */}
        <div className="info-panel" style={{ width: '300px' }}>
          {/* Save Formation */}
          <div className="panel-section">
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>Save Formation</h3>
            <input
              type="text"
              value={formationName}
              onChange={(e) => setFormationName(e.target.value)}
              placeholder="Formation name"
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: '8px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                color: '#fff',
              }}
            />
            <textarea
              value={formationDescription}
              onChange={(e) => setFormationDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: '12px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                color: '#fff',
                resize: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={saveFormation}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'linear-gradient(135deg, #4ECDC4, #45B7D1)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
              <button
                onClick={exportCurrentFormation}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Export
              </button>
            </div>
          </div>

          {/* Import/Export All */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>Import/Export</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <label
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: '#fff',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
              >
                Import
                <input
                  type="file"
                  accept=".json"
                  onChange={importFormations}
                  style={{ display: 'none' }}
                />
              </label>
              <button
                onClick={exportFormations}
                disabled={savedFormations.length === 0}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: savedFormations.length === 0 ? '#666' : '#fff',
                  cursor: savedFormations.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Export All
              </button>
            </div>
          </div>

          {/* Saved Formations List */}
          <div className="panel-section" style={{ marginTop: '16px' }}>
            <h3 style={{ marginBottom: '12px', color: '#fff' }}>
              Saved Formations ({savedFormations.length})
            </h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {savedFormations.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#666', fontStyle: 'italic' }}>
                  No saved formations yet
                </div>
              ) : (
                savedFormations.map((formation, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px',
                      marginBottom: '8px',
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>
                      {formation.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                      {formation.dancerCount} dancers | {formation.stageWidth}x{formation.stageHeight}m
                      {formation.description && <div style={{ marginTop: '4px' }}>{formation.description}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => loadFormation(formation)}
                        style={{
                          flex: 1,
                          padding: '6px',
                          background: 'rgba(78, 205, 196, 0.2)',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#4ECDC4',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => deleteFormation(idx)}
                        style={{
                          padding: '6px 10px',
                          background: 'rgba(255, 107, 107, 0.2)',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#FF6B6B',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FormationCreator;
