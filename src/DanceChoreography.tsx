import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  generateChoreographyFromText,
  generateChoreographyDirect,
  generateWithProgressiveEnhancement,
  generateChoreographyWithCandidates,
  generateFormation,
  type ChoreographyResult,
  type SmoothPath,
  type FormationType,
  type Position,
  type CandidateResult,
  type GeminiPipelineMode,
  type AssignmentMode,
  type MultiCandidateResult,
} from './algorithms';
import { isApiKeyConfigured, type AestheticScore, type RankingResult, type GeminiPreConstraint } from './gemini';

// Visualization constants
const DEFAULT_STAGE_WIDTH = 15;  // Large: 49ft ≈ 15m
const DEFAULT_STAGE_HEIGHT = 12; // Large: 39ft ≈ 12m
const BASE_SCALE = 50; // Base scale (adjusts based on stage size)
const PADDING = 40;
const BASE_DANCER_RADIUS = 0.4; // Dancer radius in meters (based on human shoulder width)
const GRID_COLOR = '#2a2a3e';
const BACKGROUND_COLOR = '#1a1a2e';

// Stage presets
const STAGE_PRESETS = {
  'small': { width: 8, height: 6, label: 'Small (26×20ft)' },
  'medium': { width: 10, height: 8, label: 'Medium (33×26ft)' },
  'large': { width: 15, height: 12, label: 'Large (49×39ft)' },
  'custom': { width: 15, height: 12, label: 'Custom' },
};

// Dancer colors
const DANCER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFD93D', '#6C5CE7', '#A8E6CF', '#FF8C42',
  '#E056FD', '#686DE0', '#BADC58', '#F9CA24',
  '#30336B', '#22A6B3', '#BE2EDD', '#F79F1F',
];

interface PathPoint {
  x: number;
  y: number;
}

interface DancerData {
  id: number;
  color: string;
  startPosition: PathPoint;
  endPosition: PathPoint;
  path: { x: number; y: number; t: number }[];
  startTime: number;
  speed: number;
  distance: number;
}

// Get dancer position at specific count (time-based interpolation)
function getDancerPositionAtCount(dancer: DancerData, count: number, _totalCounts: number): PathPoint {
  const path = dancer.path;

  // Return start position if path is empty or missing
  if (!path || path.length === 0) {
    return dancer.startPosition;
  }

  // Return start position if before start time
  const pathStartTime = path[0].t;
  const pathEndTime = path[path.length - 1].t;

  if (count <= pathStartTime) {
    return { x: path[0].x, y: path[0].y };
  }

  // Return end position if after end time
  if (count >= pathEndTime) {
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }

  // Find position on path based on time
  for (let i = 0; i < path.length - 1; i++) {
    if (count >= path[i].t && count <= path[i + 1].t) {
      const t1 = path[i].t;
      const t2 = path[i + 1].t;
      const ratio = (count - t1) / (t2 - t1);

      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * ratio,
        y: path[i].y + (path[i + 1].y - path[i].y) * ratio,
      };
    }
  }

  // Fallback: last position
  return { x: path[path.length - 1].x, y: path[path.length - 1].y };
}

interface DancerProps {
  dancer: DancerData;
  position: PathPoint;
  showPath: boolean;
  isSelected: boolean;
  onSelect: () => void;
  scale: number;
  stageHeight: number;
  dancerRadius: number;
}

function Dancer({ dancer, position, showPath, isSelected, onSelect, scale, stageHeight, dancerRadius }: DancerProps) {
  const x = PADDING + position.x * scale;
  const y = PADDING + (stageHeight - position.y) * scale;

  const pathD = useMemo(() => {
    return dancer.path
      .map((p, i) => {
        const px = PADDING + p.x * scale;
        const py = PADDING + (stageHeight - p.y) * scale;
        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
      })
      .join(' ');
  }, [dancer.path, scale, stageHeight]);

  return (
    <g onClick={onSelect} style={{ cursor: 'pointer' }}>
      {showPath && (
        <motion.path
          d={pathD}
          fill="none"
          stroke={dancer.color}
          strokeWidth={isSelected ? 4 : 2}
          strokeDasharray="8,4"
          opacity={isSelected ? 0.9 : 0.5}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      )}

      {showPath && (
        <circle
          cx={PADDING + dancer.startPosition.x * scale}
          cy={PADDING + (stageHeight - dancer.startPosition.y) * scale}
          r={dancerRadius * 0.4}
          fill="none"
          stroke={dancer.color}
          strokeWidth={2}
          opacity={0.6}
        />
      )}

      {showPath && (
        <rect
          x={PADDING + dancer.endPosition.x * scale - dancerRadius * 0.4}
          y={PADDING + (stageHeight - dancer.endPosition.y) * scale - dancerRadius * 0.4}
          width={dancerRadius * 0.8}
          height={dancerRadius * 0.8}
          fill="none"
          stroke={dancer.color}
          strokeWidth={2}
          opacity={0.6}
          transform={`rotate(45 ${PADDING + dancer.endPosition.x * scale} ${PADDING + (stageHeight - dancer.endPosition.y) * scale})`}
        />
      )}

      <motion.circle
        cx={x}
        cy={y}
        r={dancerRadius}
        fill={dancer.color}
        stroke={isSelected ? '#fff' : 'rgba(255,255,255,0.3)'}
        strokeWidth={isSelected ? 3 : 2}
        initial={false}
        animate={{ cx: x, cy: y }}
        transition={{ type: 'tween', duration: 0.05 }}
        style={{
          filter: isSelected ? 'drop-shadow(0 0 10px rgba(255,255,255,0.5))' : 'none',
        }}
      />

      {/* Dancer number with shadow for visibility */}
      <motion.text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#000"
        fontSize={Math.max(12, dancerRadius * 0.9)}
        fontWeight="bold"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        initial={false}
        animate={{ x, y }}
        transition={{ type: 'tween', duration: 0.05 }}
      >
        {dancer.id}
      </motion.text>
      <motion.text
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
        initial={false}
        animate={{ x, y }}
        transition={{ type: 'tween', duration: 0.05 }}
      >
        {dancer.id}
      </motion.text>
    </g>
  );
}

interface StageProps {
  children: React.ReactNode;
  stageWidth: number;
  stageHeight: number;
  scale: number;
}

function Stage({ children, stageWidth, stageHeight, scale }: StageProps) {
  const width = stageWidth * scale + PADDING * 2;
  const height = stageHeight * scale + PADDING * 2;

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

  const labels = useMemo(() => {
    const result = [];
    // X-axis labels (2m intervals)
    for (let x = 0; x <= stageWidth; x += 2) {
      result.push(
        <text key={`lx-${x}`} x={PADDING + x * scale} y={height - 10} textAnchor="middle" fill="#666" fontSize="11">
          {x}m
        </text>
      );
    }
    // Y-axis labels (2m intervals)
    for (let y = 0; y <= stageHeight; y += 2) {
      result.push(
        <text key={`ly-${y}`} x={10} y={PADDING + (stageHeight - y) * scale + 4} textAnchor="start" fill="#666" fontSize="11">
          {y}m
        </text>
      );
    }
    return result;
  }, [stageWidth, stageHeight, scale, height]);

  return (
    <svg width={width} height={height} style={{ background: BACKGROUND_COLOR, borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
      <rect x={PADDING} y={PADDING} width={stageWidth * scale} height={stageHeight * scale} fill="rgba(40, 40, 60, 0.5)" stroke="#444" strokeWidth={2} rx={4} />
      {gridLines}
      {labels}
      <line x1={PADDING + (stageWidth / 2) * scale} y1={PADDING} x2={PADDING + (stageWidth / 2) * scale} y2={PADDING + stageHeight * scale} stroke="#444" strokeWidth={2} strokeDasharray="10,5" />
      {children}
    </svg>
  );
}

interface NaturalLanguageInputProps {
  onGenerate: (input: string) => void;
  isLoading: boolean;
}

function NaturalLanguageInput({ onGenerate, isLoading }: NaturalLanguageInputProps) {
  const [input, setInput] = useState('');
  const [apiConfigured, setApiConfigured] = useState(false);

  useEffect(() => {
    isApiKeyConfigured().then(setApiConfigured);
  }, []);

  const examples = [
    '8 dancers line to V-shape, wide spread',
    'Circle to heart shape, emphasize dancer 4',
    'Diagonal to circle, maintain symmetry',
    'Two lines to diamond, smooth movement',
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onGenerate(input.trim());
    }
  };

  return (
    <div className="nlp-input-section">
      <h3>Generate Choreography with Natural Language</h3>
      {!apiConfigured && (
        <div className="api-warning">
          Gemini API key not configured. Using default parser.
          <br />
          Set <code>VITE_GEMINI_API_KEY</code> in <code>.env</code> file.
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g., 8 dancers move from line to V-shape, emphasize center dancer, wide spread"
          rows={3}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()} className="generate-btn">
          {isLoading ? 'Generating...' : 'Generate'}
        </button>
      </form>
      <div className="examples">
        <span>Examples:</span>
        {examples.map((ex, i) => (
          <button key={i} onClick={() => setInput(ex)} className="example-btn" disabled={isLoading}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

interface FormationSelectorProps {
  startFormation: FormationType;
  endFormation: FormationType;
  dancerCount: number;
  onStartChange: (f: FormationType) => void;
  onEndChange: (f: FormationType) => void;
  onDancerCountChange: (count: number) => void;
  onGenerate: () => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  isLoading: boolean;
}

function FormationSelector({
  startFormation,
  endFormation,
  dancerCount,
  onStartChange,
  onEndChange,
  onDancerCountChange,
  onGenerate,
  onEditStart,
  onEditEnd,
  isLoading
}: FormationSelectorProps) {
  const formations: FormationType[] = ['line', 'circle', 'v_shape', 'diagonal', 'diamond', 'triangle', 'two_lines', 'scatter'];
  
  // Local state to preserve intermediate input
  const [inputValue, setInputValue] = useState<string>(dancerCount.toString());
  
  // Update inputValue when dancerCount changes externally
  useEffect(() => {
    setInputValue(dancerCount.toString());
  }, [dancerCount]);

  const formatName = (f: FormationType) => {
    const names: Record<FormationType, string> = {
      line: 'Line',
      circle: 'Circle',
      v_shape: 'V-Shape',
      diagonal: 'Diagonal',
      scatter: 'Scatter',
      heart: 'Heart',
      diamond: 'Diamond',
      triangle: 'Triangle',
      two_lines: 'Two Lines',
      custom: 'Custom',
    };
    return names[f] || f;
  };

  return (
    <div className="formation-selector">
      <h3>Formation Settings</h3>

      <div className="dancer-count-row">
        <label>Dancer Count:</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={(e) => {
            // Allow only numbers and preserve input value
            const val = e.target.value.replace(/[^0-9]/g, '');
            setInputValue(val);
          }}
          onBlur={(e) => {
            // Validate and apply only when focus is lost
            const val = e.target.value.trim();
            if (val === '') {
              // Restore default value if empty
              setInputValue(dancerCount.toString());
              return;
            }
            
            const num = parseInt(val, 10);
            if (isNaN(num) || num < 2) {
              setInputValue('2');
              onDancerCountChange(2);
            } else if (num > 24) {
              setInputValue('24');
              onDancerCountChange(24);
            } else {
              // Apply if valid
              setInputValue(num.toString());
              onDancerCountChange(num);
            }
          }}
          onKeyDown={(e) => {
            // Handle Enter key same as blur
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          className="dancer-count-input"
        />
        <span className="dancer-count-label">dancers</span>
      </div>

      <div className="formation-row">
        <div className="formation-select">
          <label>Start Formation:</label>
          <div className="formation-select-row">
            <select value={startFormation} onChange={(e) => onStartChange(e.target.value as FormationType)}>
              {formations.map((f) => (
                <option key={f} value={f}>{formatName(f)}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <button onClick={onEditStart} className="edit-btn" title="Edit custom">
              ✏️
            </button>
          </div>
        </div>
        <span className="arrow">→</span>
        <div className="formation-select">
          <label>End Formation:</label>
          <div className="formation-select-row">
            <select value={endFormation} onChange={(e) => onEndChange(e.target.value as FormationType)}>
              {formations.map((f) => (
                <option key={f} value={f}>{formatName(f)}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <button onClick={onEditEnd} className="edit-btn" title="Edit custom">
              ✏️
            </button>
          </div>
        </div>
        <button onClick={onGenerate} disabled={isLoading} className="generate-btn small">
          {isLoading ? '...' : 'Generate'}
        </button>
      </div>
    </div>
  );
}

// Stage Size Selector Component
interface StageSizeSelectorProps {
  preset: keyof typeof STAGE_PRESETS;
  width: number;
  height: number;
  onPresetChange: (preset: keyof typeof STAGE_PRESETS) => void;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
}

function StageSizeSelector({ preset, width, height, onPresetChange, onWidthChange, onHeightChange }: StageSizeSelectorProps) {
  return (
    <div className="stage-size-selector">
      <h4>Stage Size</h4>
      <div className="stage-preset-row">
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as keyof typeof STAGE_PRESETS)}
        >
          {Object.entries(STAGE_PRESETS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </div>
      {preset === 'custom' && (
        <div className="stage-custom-inputs">
          <label>
            Width:
            <input
              type="number"
              min={4}
              max={30}
              step={0.5}
              value={width}
              onChange={(e) => onWidthChange(Math.max(4, Math.min(30, parseFloat(e.target.value) || 12)))}
            />
            m
          </label>
          <label>
            Height:
            <input
              type="number"
              min={4}
              max={25}
              step={0.5}
              value={height}
              onChange={(e) => onHeightChange(Math.max(4, Math.min(25, parseFloat(e.target.value) || 10)))}
            />
            m
          </label>
        </div>
      )}
      <div className="stage-info">
        Current: {width}m × {height}m ({(width * 3.28).toFixed(0)}×{(height * 3.28).toFixed(0)} ft)
      </div>
    </div>
  );
}

// Formation Editor Component
interface FormationEditorProps {
  positions: Position[];
  dancerCount: number;
  title: string;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  dancerRadius: number;
  initialFormation: FormationType; // Initial formation type
  onPositionsChange: (positions: Position[]) => void;
  onClose: () => void;
  onApplyPreset: (formation: FormationType, spread: number) => void;
  // End formation specific props
  isEndFormation?: boolean;
  assignmentMode?: AssignmentMode;
  lockedDancers?: Set<number>; // Dancer IDs with fixed end positions
  onAssignmentModeChange?: (mode: AssignmentMode) => void;
  onLockedDancersChange?: (locked: Set<number>) => void;
}

function FormationEditor({
  positions,
  dancerCount,
  title,
  stageWidth,
  stageHeight,
  scale,
  dancerRadius,
  initialFormation,
  onPositionsChange,
  onClose,
  onApplyPreset,
  isEndFormation = false,
  assignmentMode = 'fixed',
  lockedDancers = new Set(),
  onAssignmentModeChange,
  onLockedDancersChange,
}: FormationEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [localPositions, setLocalPositions] = useState<Position[]>(positions);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize, setSnapSize] = useState(0.5); // 0.5m grid snap
  const [spread, setSpread] = useState(1.0); // Formation size (0.5 ~ 1.5)
  // Set currentPreset from initial formation type (unless custom)
  const [currentPreset, setCurrentPreset] = useState<FormationType | null>(
    initialFormation !== 'custom' ? initialFormation : null
  );
  // Local state for locked dancers (for partial assignment)
  const [localLockedDancers, setLocalLockedDancers] = useState<Set<number>>(lockedDancers);

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Selection box drag state
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  // Drag start position (for offset calculation)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const initialPositionsRef = useRef<Position[]>([]);

  // Undo/Redo history
  const [history, setHistory] = useState<Position[][]>([]);
  const [future, setFuture] = useState<Position[][]>([]);
  const maxHistory = 50; // Maximum history count
  const isInternalChange = useRef(false); // Track internal changes

  // When positions prop changes (editor opens / external change)
  useEffect(() => {
    // Keep history if prop change is from internal change (drag, undo, etc.)
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    // External positions change (editor first opens, etc.)
    setLocalPositions(positions);
    setHistory([]);
    setFuture([]);
  }, [positions]);

  // Save current state to history
  const saveToHistory = useCallback((currentPos: Position[]) => {
    setHistory(prev => {
      const newHistory = [...prev, currentPos];
      if (newHistory.length > maxHistory) {
        return newHistory.slice(-maxHistory);
      }
      return newHistory;
    });
    setFuture([]); // Reset redo history on new change
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (history.length === 0) return;

    const previousState = history[history.length - 1];
    const newHistory = history.slice(0, -1);

    setFuture(prev => [...prev, localPositions]);
    setHistory(newHistory);
    setLocalPositions(previousState);
    isInternalChange.current = true;
    onPositionsChange(previousState);
  }, [history, localPositions, onPositionsChange]);

  // Redo
  const redo = useCallback(() => {
    if (future.length === 0) return;

    const nextState = future[future.length - 1];
    const newFuture = future.slice(0, -1);

    setHistory(prev => [...prev, localPositions]);
    setFuture(newFuture);
    setLocalPositions(nextState);
    isInternalChange.current = true;
    onPositionsChange(nextState);
  }, [future, localPositions, onPositionsChange]);

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      // Ctrl+Y for redo (Windows style)
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Update current preset in real-time when spread changes
  const handleSpreadChange = useCallback((newSpread: number) => {
    setSpread(newSpread);
    if (currentPreset) {
      saveToHistory(localPositions);
      const newPositions = generateFormation(currentPreset, dancerCount, {
        stageWidth,
        stageHeight,
        spread: newSpread
      });
      setLocalPositions(newPositions);
      isInternalChange.current = true;
      onPositionsChange(newPositions);
    }
  }, [currentPreset, dancerCount, stageWidth, stageHeight, onPositionsChange, localPositions, saveToHistory]);

  // Apply preset
  const handlePresetClick = useCallback((preset: FormationType) => {
    setCurrentPreset(preset);
    setSelectedIds(new Set()); // Clear selection
    onApplyPreset(preset, spread);
  }, [spread, onApplyPreset]);

  // Select all
  const selectAll = useCallback(() => {
    const allIds = new Set<number>();
    for (let i = 0; i < dancerCount; i++) {
      allIds.add(i);
    }
    setSelectedIds(allIds);
  }, [dancerCount]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Move all formation
  const moveAll = useCallback((dx: number, dy: number) => {
    saveToHistory(localPositions);
    const newPositions = localPositions.slice(0, dancerCount).map(pos => ({
      x: Math.max(0.5, Math.min(stageWidth - 0.5, pos.x + dx)),
      y: Math.max(0.5, Math.min(stageHeight - 0.5, pos.y + dy)),
    }));
    // Keep remaining positions
    const fullPositions = [...newPositions, ...localPositions.slice(dancerCount)];
    setLocalPositions(fullPositions);
    isInternalChange.current = true;
    onPositionsChange(fullPositions);
  }, [localPositions, dancerCount, stageWidth, stageHeight, onPositionsChange, saveToHistory]);

  // Center alignment
  const centerAll = useCallback(() => {
    const activePositions = localPositions.slice(0, dancerCount);
    if (activePositions.length === 0) return;

    saveToHistory(localPositions);

    // Calculate current formation center
    const centerX = activePositions.reduce((sum, p) => sum + p.x, 0) / activePositions.length;
    const centerY = activePositions.reduce((sum, p) => sum + p.y, 0) / activePositions.length;

    // Move to stage center
    const targetCenterX = stageWidth / 2;
    const targetCenterY = stageHeight / 2;
    const dx = targetCenterX - centerX;
    const dy = targetCenterY - centerY;

    const newPositions = activePositions.map(pos => ({
      x: Math.max(0.5, Math.min(stageWidth - 0.5, pos.x + dx)),
      y: Math.max(0.5, Math.min(stageHeight - 0.5, pos.y + dy)),
    }));
    const fullPositions = [...newPositions, ...localPositions.slice(dancerCount)];
    setLocalPositions(fullPositions);
    isInternalChange.current = true;
    onPositionsChange(fullPositions);
  }, [localPositions, dancerCount, stageWidth, stageHeight, onPositionsChange, saveToHistory]);

  const svgWidth = stageWidth * scale + PADDING * 2;
  const svgHeight = stageHeight * scale + PADDING * 2;

  const snapToGrid = (value: number, gridSize: number): number => {
    return Math.round(value / gridSize) * gridSize;
  };

  // Dancer click handler
  const handleDancerMouseDown = (id: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - PADDING) / scale;
    const mouseY = stageHeight - ((e.clientY - rect.top - PADDING) / scale);

    if (e.shiftKey) {
      // Shift+click: Add/remove from selection
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      });
    } else {
      // Normal click: Single selection or drag selected group
      if (!selectedIds.has(id)) {
        // Click unselected dancer → Select only that dancer
        setSelectedIds(new Set([id]));
      }
      // Clicking already selected dancer starts group drag
    }

    saveToHistory(localPositions); // Save to history before drag starts
    setDraggingId(id);
    dragStartRef.current = { x: mouseX, y: mouseY };
    initialPositionsRef.current = [...localPositions];
  };

  // Empty space click handler (start selection box)
  const handleSvgMouseDown = (e: React.MouseEvent) => {
    // Only when not clicking a dancer
    if ((e.target as HTMLElement).tagName !== 'svg' &&
        !(e.target as HTMLElement).classList.contains('stage-background')) {
      return;
    }

    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Empty space click → Clear selection and start selection box
    if (!e.shiftKey) {
      setSelectedIds(new Set());
    }

    setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
    setIsDraggingSelection(true);
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
    if (draggingId === null || !dragStartRef.current) return;

    const mouseX = (e.clientX - rect.left - PADDING) / scale;
    const mouseY = stageHeight - ((e.clientY - rect.top - PADDING) / scale);

    // Calculate movement delta
    let deltaX = mouseX - dragStartRef.current.x;
    let deltaY = mouseY - dragStartRef.current.y;

    // Move selected dancers together
    const idsToMove = selectedIds.has(draggingId) ? selectedIds : new Set([draggingId]);
    const isGroupMove = idsToMove.size > 1;

    // Group move: snap the delta itself (maintain formation)
    // Single move: snap individual position
    if (snapEnabled && isGroupMove) {
      deltaX = snapToGrid(deltaX, snapSize);
      deltaY = snapToGrid(deltaY, snapSize);
    }

    setLocalPositions(prev => prev.map((pos, i) => {
      if (!idsToMove.has(i)) return pos;

      const initialPos = initialPositionsRef.current[i];
      let newX = initialPos.x + deltaX;
      let newY = initialPos.y + deltaY;

      // Only snap individual position for single dancer move
      if (snapEnabled && !isGroupMove) {
        newX = snapToGrid(newX, snapSize);
        newY = snapToGrid(newY, snapSize);
      }

      // Clamp to stage bounds
      const clampedX = Math.max(0.5, Math.min(stageWidth - 0.5, newX));
      const clampedY = Math.max(0.5, Math.min(stageHeight - 0.5, newY));

      return { x: clampedX, y: clampedY };
    }));
  }, [draggingId, isDraggingSelection, selectionBox, selectedIds, snapEnabled, snapSize, scale, stageWidth, stageHeight]);

  const handleMouseUp = useCallback(() => {
    // Selection box complete
    if (isDraggingSelection && selectionBox) {
      const svg = svgRef.current;
      if (svg) {
        // Calculate selection box area (pixels → world coordinates)
        const minX = Math.min(selectionBox.startX, selectionBox.endX);
        const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY);
        const maxY = Math.max(selectionBox.startY, selectionBox.endY);

        // Find dancers inside selection box
        const newSelected = new Set<number>();
        localPositions.slice(0, dancerCount).forEach((pos, i) => {
          const px = PADDING + pos.x * scale;
          const py = PADDING + (stageHeight - pos.y) * scale;

          if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
            newSelected.add(i);
          }
        });

        setSelectedIds(newSelected);
      }
      setSelectionBox(null);
      setIsDraggingSelection(false);
      return;
    }

    // Dancer drag complete
    if (draggingId !== null) {
      isInternalChange.current = true;
      onPositionsChange(localPositions);
    }
    setDraggingId(null);
    dragStartRef.current = null;
  }, [draggingId, isDraggingSelection, selectionBox, localPositions, dancerCount, scale, stageHeight, onPositionsChange]);

  const presets: FormationType[] = ['line', 'circle', 'v_shape', 'diagonal', 'diamond', 'triangle', 'two_lines', 'scatter'];

  return (
    <div className="formation-editor-overlay">
      <div className="formation-editor">
        <div className="editor-header">
          <h3>{title}</h3>
          <div className="header-actions">
            <div className="undo-redo-btns">
              <button
                onClick={undo}
                disabled={history.length === 0}
                className="undo-btn"
                title="Undo (Ctrl+Z)"
              >
                ↶
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                className="redo-btn"
                title="Redo (Ctrl+Shift+Z)"
              >
                ↷
              </button>
            </div>
            <button onClick={onClose} className="close-btn">✕</button>
          </div>
        </div>

        <div className="editor-toolbar">
          <div className="preset-buttons">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => handlePresetClick(p)}
                className={`preset-btn ${currentPreset === p ? 'active' : ''}`}
              >
                {p === 'line' ? 'Line' : p === 'circle' ? 'Circle' : p === 'v_shape' ? 'V' :
                 p === 'diagonal' ? 'Diag' : p === 'diamond' ? 'Dia' : p === 'triangle' ? 'Tri' :
                 p === 'two_lines' ? '2Line' : 'Scatter'}
              </button>
            ))}
          </div>
          <div className="spread-control">
            <label>Formation Size:</label>
            <input
              type="range"
              min={0.5}
              max={1.7}
              step={0.05}
              value={spread}
              onChange={(e) => handleSpreadChange(parseFloat(e.target.value))}
            />
            <span className="spread-value">{Math.round(Math.min(spread * 60, 100))}%</span>
            {!currentPreset && <span className="spread-hint">(Select preset first)</span>}
          </div>
          <div className="position-control">
            <label>Move Position:</label>
            <div className="position-pad">
              <button className="pos-btn" onClick={() => moveAll(-0.5, 0.5)}>↖</button>
              <button className="pos-btn" onClick={() => moveAll(0, 0.5)}>↑</button>
              <button className="pos-btn" onClick={() => moveAll(0.5, 0.5)}>↗</button>
              <button className="pos-btn" onClick={() => moveAll(-0.5, 0)}>←</button>
              <button className="pos-btn center" onClick={centerAll}>◎</button>
              <button className="pos-btn" onClick={() => moveAll(0.5, 0)}>→</button>
              <button className="pos-btn" onClick={() => moveAll(-0.5, -0.5)}>↙</button>
              <button className="pos-btn" onClick={() => moveAll(0, -0.5)}>↓</button>
              <button className="pos-btn" onClick={() => moveAll(0.5, -0.5)}>↘</button>
            </div>
          </div>
          <div className="snap-controls">
            <label className="snap-toggle">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              <span>Grid Snap</span>
            </label>
            {snapEnabled && (
              <div className="snap-size-buttons">
                {[0.5, 1].map(size => (
                  <button
                    key={size}
                    onClick={() => setSnapSize(size)}
                    className={`snap-size-btn ${snapSize === size ? 'active' : ''}`}
                  >
                    {size}m
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="selection-controls">
            <span className="selection-info">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Drag to select'}
            </span>
            <button onClick={selectAll} className="selection-btn">Select All</button>
            <button onClick={clearSelection} className="selection-btn" disabled={selectedIds.size === 0}>Clear</button>
          </div>
        </div>

        {/* Assignment Mode (End Formation Only) */}
        {isEndFormation && onAssignmentModeChange && (
          <div className="assignment-mode-section">
            <div className="assignment-mode-header">
              <span className="section-label">End Position Assignment:</span>
            </div>
            <div className="assignment-mode-options">
              <label className={`assignment-option ${assignmentMode === 'fixed' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="editorAssignmentMode"
                  checked={assignmentMode === 'fixed'}
                  onChange={() => onAssignmentModeChange('fixed')}
                />
                <span className="option-label">Fixed</span>
                <span className="option-desc">All dancers have fixed end positions</span>
              </label>
              <label className={`assignment-option ${assignmentMode === 'partial' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="editorAssignmentMode"
                  checked={assignmentMode === 'partial'}
                  onChange={() => onAssignmentModeChange('partial')}
                />
                <span className="option-label">Partial</span>
                <span className="option-desc">Lock some, auto-assign others</span>
              </label>
              <label className={`assignment-option ${assignmentMode === 'optimal' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="editorAssignmentMode"
                  checked={assignmentMode === 'optimal'}
                  onChange={() => onAssignmentModeChange('optimal')}
                />
                <span className="option-label">Auto</span>
                <span className="option-desc">Optimize all assignments</span>
              </label>
            </div>
            {assignmentMode === 'partial' && (
              <div className="partial-assignment-hint">
                <span>🔒 <strong>Ctrl + Click</strong> on dancers to lock/unlock their end positions</span>
                <span className="locked-count">Locked: {localLockedDancers.size} / {dancerCount}</span>
              </div>
            )}
          </div>
        )}

        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          style={{
            background: BACKGROUND_COLOR,
            borderRadius: '8px',
            cursor: isDraggingSelection ? 'crosshair' : draggingId !== null ? 'grabbing' : 'default'
          }}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <rect
            className="stage-background"
            x={PADDING}
            y={PADDING}
            width={stageWidth * scale}
            height={stageHeight * scale}
            fill="rgba(40, 40, 60, 0.5)"
            stroke="#444"
            strokeWidth={2}
          />

          {/* Grid */}
          {Array.from({ length: Math.floor(stageWidth) + 1 }).map((_, x) => (
            <line
              key={`v-${x}`}
              x1={PADDING + x * scale}
              y1={PADDING}
              x2={PADDING + x * scale}
              y2={PADDING + stageHeight * scale}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: Math.floor(stageHeight) + 1 }).map((_, y) => (
            <line
              key={`h-${y}`}
              x1={PADDING}
              y1={PADDING + y * scale}
              x2={PADDING + stageWidth * scale}
              y2={PADDING + y * scale}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
          ))}

          {/* Center line */}
          <line
            x1={PADDING + (stageWidth / 2) * scale}
            y1={PADDING}
            x2={PADDING + (stageWidth / 2) * scale}
            y2={PADDING + stageHeight * scale}
            stroke="#666"
            strokeWidth={2}
            strokeDasharray="10,5"
          />

          {/* Dancers */}
          {localPositions.slice(0, dancerCount).map((pos, i) => {
            const cx = PADDING + pos.x * scale;
            const cy = PADDING + (stageHeight - pos.y) * scale;
            const color = DANCER_COLORS[i % DANCER_COLORS.length];
            const isSelected = selectedIds.has(i);
            const isDragging = draggingId === i;
            const isLocked = localLockedDancers.has(i);
            const showLockIndicator = isEndFormation && assignmentMode === 'partial';

            const handleDancerClick = (e: React.MouseEvent) => {
              // In partial mode, right-click or ctrl+click toggles lock
              if (showLockIndicator && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                const newLocked = new Set(localLockedDancers);
                if (newLocked.has(i)) {
                  newLocked.delete(i);
                } else {
                  newLocked.add(i);
                }
                setLocalLockedDancers(newLocked);
                onLockedDancersChange?.(newLocked);
              }
            };

            return (
              <g
                key={i}
                onMouseDown={handleDancerMouseDown(i)}
                onClick={handleDancerClick}
                style={{ cursor: showLockIndicator ? 'pointer' : 'grab' }}
              >
                {/* Locked dancer indicator */}
                {showLockIndicator && isLocked && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={dancerRadius + 10}
                    fill="none"
                    stroke="#FFD93D"
                    strokeWidth={3}
                    strokeDasharray="none"
                  />
                )}
                {/* Selected dancer background highlight */}
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={dancerRadius + 8}
                    fill="rgba(78, 205, 196, 0.2)"
                    stroke="#4ECDC4"
                    strokeWidth={2}
                    strokeDasharray="4,2"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={dancerRadius + 4}
                  fill="transparent"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={dancerRadius}
                  fill={color}
                  stroke={isDragging ? '#fff' : isSelected ? '#4ECDC4' : isLocked && showLockIndicator ? '#FFD93D' : 'rgba(255,255,255,0.3)'}
                  strokeWidth={isDragging ? 3 : isSelected ? 3 : isLocked && showLockIndicator ? 3 : 2}
                  style={{
                    filter: isSelected ? 'drop-shadow(0 0 6px rgba(78, 205, 196, 0.6))' : isLocked && showLockIndicator ? 'drop-shadow(0 0 6px rgba(255, 217, 61, 0.6))' : 'none',
                  }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize={Math.max(10, dancerRadius * 0.8)}
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {i + 1}
                </text>
                {/* Lock icon */}
                {showLockIndicator && isLocked && (
                  <text
                    x={cx + dancerRadius}
                    y={cy - dancerRadius}
                    fontSize={10}
                    fill="#FFD93D"
                    style={{ pointerEvents: 'none' }}
                  >
                    🔒
                  </text>
                )}
              </g>
            );
          })}

          {/* Selection box */}
          {selectionBox && (
            <rect
              x={Math.min(selectionBox.startX, selectionBox.endX)}
              y={Math.min(selectionBox.startY, selectionBox.endY)}
              width={Math.abs(selectionBox.endX - selectionBox.startX)}
              height={Math.abs(selectionBox.endY - selectionBox.startY)}
              fill="rgba(78, 205, 196, 0.1)"
              stroke="#4ECDC4"
              strokeWidth={1}
              strokeDasharray="5,3"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>

        <div className="position-list">
          {localPositions.slice(0, dancerCount).map((pos, i) => (
            <div key={i} className="position-item">
              <span style={{ color: DANCER_COLORS[i % DANCER_COLORS.length] }}>●</span>
              <span>D{i + 1}:</span>
              <input
                type="number"
                step="0.1"
                value={pos.x.toFixed(1)}
                onChange={(e) => {
                  saveToHistory(localPositions);
                  const newPos = [...localPositions];
                  newPos[i] = { ...newPos[i], x: parseFloat(e.target.value) || 0 };
                  setLocalPositions(newPos);
                  isInternalChange.current = true;
                  onPositionsChange(newPos);
                }}
                className="coord-input"
              />
              <span>,</span>
              <input
                type="number"
                step="0.1"
                value={pos.y.toFixed(1)}
                onChange={(e) => {
                  saveToHistory(localPositions);
                  const newPos = [...localPositions];
                  newPos[i] = { ...newPos[i], y: parseFloat(e.target.value) || 0 };
                  setLocalPositions(newPos);
                  isInternalChange.current = true;
                  onPositionsChange(newPos);
                }}
                className="coord-input"
              />
            </div>
          ))}
        </div>

        <div className="editor-footer">
          <button onClick={onClose} className="done-btn">Done</button>
        </div>
      </div>
    </div>
  );
}

// Collapsible panel
interface CollapsiblePanelProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsiblePanel({ title, defaultOpen = true, children }: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="collapsible-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-icon">{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

interface AestheticScorePanelProps {
  score: AestheticScore;
}

function AestheticScorePanel({ score }: AestheticScorePanelProps) {
  const getScoreColor = (value: number) => {
    if (value >= 80) return '#4ECDC4';
    if (value >= 60) return '#FFD93D';
    return '#FF6B6B';
  };

  return (
    <div className="aesthetic-panel compact">
      <div className="overall-score" style={{ borderColor: getScoreColor(score.overall) }}>
        <span className="score-value">{score.overall}</span>
        <span className="score-label">Overall Score</span>
      </div>
      <div className="score-details">
        {[
          { label: 'Symmetry', value: score.symmetry },
          { label: 'Center Focus', value: score.centerFocus },
          { label: 'Crossing', value: score.crossingPenalty },
          { label: 'Flow', value: score.flowSmoothness },
          { label: 'Main Emphasis', value: score.mainDancerEmphasis },
        ].map(({ label, value }) => (
          <div key={label} className="score-row">
            <span className="score-label">{label}</span>
            <div className="score-bar">
              <div className="score-fill" style={{ width: `${value}%`, background: getScoreColor(value) }} />
            </div>
            <span className="score-num">{value}</span>
          </div>
        ))}
      </div>
      {score.feedback.length > 0 && (
        <div className="feedback-section">
          <h4>Feedback</h4>
          <ul>
            {score.feedback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Candidate comparison panel
interface CandidateComparisonPanelProps {
  candidates: CandidateResult[];
  ranking: RankingResult | null;
  selectedId: string;
  onSelectCandidate: (id: string) => void;
  usedGeminiRanking: boolean;
  preConstraint: GeminiPreConstraint | null;
  usedGeminiPreConstraint: boolean;
  pipelineMode: GeminiPipelineMode;
  geminiStatus: 'idle' | 'pending' | 'success' | 'failed' | 'timeout';
  pendingGeminiResult: MultiCandidateResult | null;
  onApplyGeminiResult: () => void;
}

function CandidateComparisonPanel({
  candidates,
  ranking,
  selectedId,
  onSelectCandidate,
  usedGeminiRanking,
  preConstraint,
  usedGeminiPreConstraint,
  pipelineMode,
  geminiStatus,
  pendingGeminiResult,
  onApplyGeminiResult,
}: CandidateComparisonPanelProps) {
  const getStrategyLabel = (strategy: string) => {
    const labels: Record<string, string> = {
      'distance_longest_first': 'Longest First',
      'distance_shortest_first': 'Shortest First',
      'timing_priority': 'Timing Priority',
      'curve_allowed': 'Curve Allowed',
      'center_priority': 'Center Priority',
      'candidate_gemini_constrained': 'Gemini Constrained',
      'candidate_constrained_curve_0.2': 'Constrained + Curve 0.2',
      'candidate_constrained_curve_0.5': 'Constrained + Curve 0.5',
      'candidate_constrained_curve_0.8': 'Constrained + Curve 0.8',
      'candidate_baseline_distance_longest_first': 'Baseline: Longest',
      'candidate_baseline_timing_priority': 'Baseline: Timing',
    };
    return labels[strategy] || strategy;
  };

  const getMetricColor = (value: number, isLowerBetter: boolean = false) => {
    const normalized = isLowerBetter ? 100 - value : value;
    if (normalized >= 80) return '#4ECDC4';
    if (normalized >= 60) return '#FFD93D';
    return '#FF6B6B';
  };

  const getRankInfo = (candidateId: string) => {
    if (!ranking) return null;
    return ranking.rankings.find(r => r.id === candidateId);
  };

  return (
    <div className="candidate-panel">
      <div className="candidate-panel-header">
        <h3>Candidate Comparison</h3>
        <div className="header-badges">
          <span className={`pipeline-badge ${pipelineMode}`}>
            {pipelineMode === 'without_gemini' ? '⚡ Algorithm Only' : pipelineMode === 'pre_and_ranking' ? '🧠 Pre+Ranking' : '📊 Ranking Only'}
          </span>
          <span className={`ranking-badge ${usedGeminiRanking ? 'gemini' : 'local'}`}>
            {usedGeminiRanking ? '🤖 Gemini' : '📊 Local'}
          </span>
          {geminiStatus === 'pending' && (
            <span className="gemini-status pending">
              <span className="spinner"></span> AI 분석중...
            </span>
          )}
        </div>
      </div>

      {/* Gemini Enhancement Banner */}
      {pendingGeminiResult && geminiStatus === 'success' && (
        <div className="gemini-enhancement-banner">
          <div className="banner-content">
            <span className="banner-icon">✨</span>
            <span className="banner-text">
              AI가 더 나은 후보를 찾았습니다: <strong>{pendingGeminiResult.metadata.selectedStrategy}</strong>
            </span>
          </div>
          <button className="apply-gemini-btn" onClick={onApplyGeminiResult}>
            AI 결과 적용
          </button>
        </div>
      )}

      {geminiStatus === 'timeout' && (
        <div className="gemini-status-banner timeout">
          <span>⏱️ AI 응답 시간 초과 - 로컬 결과 사용중</span>
        </div>
      )}

      {geminiStatus === 'failed' && (
        <div className="gemini-status-banner failed">
          <span>⚠️ AI 연결 실패 - 로컬 결과 사용중</span>
        </div>
      )}

      {pipelineMode === 'pre_and_ranking' && preConstraint && (
        <div className="pre-constraint-info">
          <div className="constraint-header">
            <span className="constraint-label">Gemini Pre-Constraint</span>
            {usedGeminiPreConstraint && <span className="gemini-badge">✓ Gemini</span>}
          </div>
          <p className="constraint-strategy">{preConstraint.overallStrategy}</p>
          <div className="constraint-details">
            <span>Order: {preConstraint.movementOrder}</span>
            <span>Curve: {(preConstraint.suggestedCurveAmount * 100).toFixed(0)}%</span>
            <span>Confidence: {(preConstraint.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {ranking && (
        <div className="ranking-explanation">
          <p>{ranking.explanation}</p>
        </div>
      )}

      <div className="candidate-list">
        {candidates.map((candidate) => {
          const rankInfo = getRankInfo(candidate.id);
          const isSelected = candidate.id === selectedId;
          const { metrics } = candidate;

          return (
            <div
              key={candidate.id}
              className={`candidate-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectCandidate(candidate.id)}
            >
              <div className="candidate-header">
                <span className="candidate-strategy">{getStrategyLabel(candidate.strategy)}</span>
                {rankInfo && (
                  <span className={`candidate-rank rank-${rankInfo.rank}`}>
                    #{rankInfo.rank}
                  </span>
                )}
                {isSelected && <span className="selected-badge">✓ Selected</span>}
              </div>

              <div className="candidate-metrics">
                <div className="metric-row">
                  <span className="metric-label">Collision</span>
                  <span
                    className="metric-value"
                    style={{ color: metrics.collisionCount === 0 ? '#4ECDC4' : '#FF6B6B' }}
                  >
                    {metrics.collisionCount === 0 ? 'None ✓' : `${metrics.collisionCount}`}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Symmetry</span>
                  <div className="metric-bar">
                    <div
                      className="metric-fill"
                      style={{
                        width: `${metrics.symmetryScore}%`,
                        background: getMetricColor(metrics.symmetryScore)
                      }}
                    />
                  </div>
                  <span className="metric-num">{metrics.symmetryScore}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Smoothness</span>
                  <div className="metric-bar">
                    <div
                      className="metric-fill"
                      style={{
                        width: `${metrics.pathSmoothness}%`,
                        background: getMetricColor(metrics.pathSmoothness)
                      }}
                    />
                  </div>
                  <span className="metric-num">{metrics.pathSmoothness}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Crossing</span>
                  <span
                    className="metric-value"
                    style={{ color: metrics.crossingCount <= 2 ? '#4ECDC4' : '#FFD93D' }}
                  >
                    {metrics.crossingCount}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Sync Arrival</span>
                  <div className="metric-bar">
                    <div
                      className="metric-fill"
                      style={{
                        width: `${metrics.simultaneousArrival}%`,
                        background: getMetricColor(metrics.simultaneousArrival)
                      }}
                    />
                  </div>
                  <span className="metric-num">{metrics.simultaneousArrival}</span>
                </div>
              </div>

              {rankInfo && rankInfo.reason && (
                <div className="candidate-reason">
                  {rankInfo.reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentCount: number;
  totalCounts: number;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSeek: (count: number) => void;
  onSpeedChange: (speed: number) => void;
}

function PlaybackControls({ isPlaying, currentCount, totalCounts, playbackSpeed, onPlay, onPause, onReset, onSeek, onSpeedChange }: PlaybackControlsProps) {
  return (
    <div className="controls">
      <div className="timeline-section">
        <label>
          Timeline: <strong>{currentCount.toFixed(2)}</strong> / {totalCounts} counts
        </label>
        <input type="range" min={0} max={totalCounts} step={0.01} value={currentCount} onChange={(e) => onSeek(parseFloat(e.target.value))} className="timeline-slider" />
      </div>
      <div className="button-section">
        <button onClick={onReset} className="control-btn reset">⏮ Reset</button>
        {isPlaying ? (
          <button onClick={onPause} className="control-btn pause">⏸ Pause</button>
        ) : (
          <button onClick={onPlay} className="control-btn play">▶ Play</button>
        )}
      </div>
      <div className="speed-section">
        <label>Speed:</label>
        <div className="speed-buttons">
          {[0.5, 1, 2].map((speed) => (
            <button key={speed} onClick={() => onSpeedChange(speed)} className={`speed-btn ${playbackSpeed === speed ? 'active' : ''}`}>
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DancerInfoPanelProps {
  dancers: DancerData[];
  currentCount: number;
  totalCounts: number;
  selectedDancer: number | null;
  onSelectDancer: (id: number | null) => void;
  showPaths: boolean;
  onTogglePaths: () => void;
}

function DancerInfoPanel({ dancers, currentCount, totalCounts, selectedDancer, onSelectDancer, showPaths, onTogglePaths }: DancerInfoPanelProps) {
  return (
    <div className="info-panel">
      <div className="panel-header">
        <h3>Dancers</h3>
        <label className="toggle-paths">
          <input type="checkbox" checked={showPaths} onChange={onTogglePaths} />
          Show Paths
        </label>
      </div>
      <div className="dancer-list">
        {dancers.map((dancer) => {
          const position = getDancerPositionAtCount(dancer, currentCount, totalCounts);
          const isMoving = currentCount > dancer.startTime;
          const progress = Math.min(100, Math.max(0, ((currentCount - dancer.startTime) / (totalCounts - dancer.startTime)) * 100));

          return (
            <div key={dancer.id} className={`dancer-info ${selectedDancer === dancer.id ? 'selected' : ''}`} onClick={() => onSelectDancer(selectedDancer === dancer.id ? null : dancer.id)}>
              <div className="dancer-header">
                <div className="dancer-color" style={{ background: dancer.color }} />
                <span className="dancer-name">Dancer {dancer.id}</span>
                <span className={`dancer-status ${isMoving ? 'moving' : 'waiting'}`}>
                  {isMoving ? 'Moving' : `Starts at ${dancer.startTime}`}
                </span>
              </div>
              <div className="dancer-details">
                <div className="detail-row">
                  <span>Position:</span>
                  <span>({position.x.toFixed(2)}, {position.y.toFixed(2)})</span>
                </div>
                <div className="detail-row">
                  <span>Speed:</span>
                  <span>{dancer.speed.toFixed(2)}x</span>
                </div>
                <div className="detail-row">
                  <span>Distance:</span>
                  <span>{dancer.distance.toFixed(2)}m</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%`, background: dancer.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Convert ChoreographyResult to DancerData array
function resultToDancerData(result: ChoreographyResult): DancerData[] {
  return result.smoothPaths.map((sp: SmoothPath, index: number) => ({
    id: sp.dancerId,
    color: sp.color,
    startPosition: result.startPositions[index],
    endPosition: result.endPositions[index],
    path: sp.points,
    startTime: sp.startTime,
    speed: sp.speed,
    distance: sp.distance,
  }));
}

type StagePreset = keyof typeof STAGE_PRESETS;

export default function DanceChoreography() {
  const [currentCount, setCurrentCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedDancer, setSelectedDancer] = useState<number | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stage size state
  const [stagePreset, setStagePreset] = useState<StagePreset>('large');
  const [stageWidth, setStageWidth] = useState(DEFAULT_STAGE_WIDTH);
  const [stageHeight, setStageHeight] = useState(DEFAULT_STAGE_HEIGHT);

  // Calculate scale based on stage size (keep visualization within reasonable bounds)
  const scale = useMemo(() => {
    const maxWidth = 700; // max SVG width
    const maxHeight = 550; // max SVG height
    const scaleX = (maxWidth - PADDING * 2) / stageWidth;
    const scaleY = (maxHeight - PADDING * 2) / stageHeight;
    return Math.min(scaleX, scaleY, BASE_SCALE);
  }, [stageWidth, stageHeight]);

  // Dancer radius in pixels (relative to stage)
  const dancerRadius = useMemo(() => {
    return BASE_DANCER_RADIUS * scale;
  }, [scale]);

  // Formation state
  const [startFormation, setStartFormation] = useState<FormationType>('line');
  const [endFormation, setEndFormation] = useState<FormationType>('v_shape');
  const [dancerCount, setDancerCount] = useState(8);

  // Custom positions
  const [customStartPositions, setCustomStartPositions] = useState<Position[]>([]);
  const [customEndPositions, setCustomEndPositions] = useState<Position[]>([]);
  const [editingFormation, setEditingFormation] = useState<'start' | 'end' | null>(null);

  // Choreography result
  const [result, setResult] = useState<ChoreographyResult | null>(null);
  const [dancers, setDancers] = useState<DancerData[]>([]);
  const [totalCounts, setTotalCounts] = useState(8);

  // Multi-candidate state
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [ranking, setRanking] = useState<RankingResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [usedGeminiRanking, setUsedGeminiRanking] = useState(false);
  const [useMultiCandidate, setUseMultiCandidate] = useState(true); // Multi-candidate mode toggle
  const [apiConfigured, setApiConfigured] = useState(false);
  const [pipelineMode, setPipelineMode] = useState<GeminiPipelineMode>('ranking_only');
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('fixed');
  const [lockedDancers, setLockedDancers] = useState<Set<number>>(new Set());
  const [preConstraint, setPreConstraint] = useState<GeminiPreConstraint | null>(null);
  const [usedGeminiPreConstraint, setUsedGeminiPreConstraint] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'pending' | 'success' | 'failed' | 'timeout'>('idle');
  const [pendingGeminiResult, setPendingGeminiResult] = useState<MultiCandidateResult | null>(null);

  // Check API configuration on mount
  useEffect(() => {
    isApiKeyConfigured().then(setApiConfigured);
  }, []);

  // Initialize custom positions when dancer count or stage size changes
  useEffect(() => {
    const startPos = generateFormation(startFormation === 'custom' ? 'line' : startFormation, dancerCount, { stageWidth, stageHeight });
    const endPos = generateFormation(endFormation === 'custom' ? 'v_shape' : endFormation, dancerCount, { stageWidth, stageHeight });
    setCustomStartPositions(startPos);
    setCustomEndPositions(endPos);
  }, [dancerCount, stageWidth, stageHeight]);

  // Do not generate formation initially (user clicks generate button)

  // Animation loop
  useEffect(() => {
    if (!isPlaying) return;

    const startTime = performance.now();
    const startCount = currentCount;
    const countDuration = 1000 / playbackSpeed;

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const newCount = startCount + (elapsed / countDuration);

      if (newCount >= totalCounts) {
        setCurrentCount(totalCounts);
        setIsPlaying(false);
        return;
      }

      setCurrentCount(newCount);
      requestAnimationFrame(animate);
    };

    const frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, playbackSpeed, currentCount, totalCounts]);

  const handleNLPGenerate = useCallback(async (input: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const isConfigured = await isApiKeyConfigured();
      const choreographyResult = await generateChoreographyFromText(input, {
        useGeminiParser: isConfigured,
        useGeminiEvaluator: false,
        dancerCount: dancerCount,
        stageWidth: stageWidth,
        stageHeight: stageHeight,
      });

      setResult(choreographyResult);
      setDancers(resultToDancerData(choreographyResult));
      setTotalCounts(choreographyResult.request.totalCounts);
      setCurrentCount(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate choreography');
    } finally {
      setIsLoading(false);
    }
  }, [dancerCount, stageWidth, stageHeight]);

  const handleDirectGenerate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setGeminiStatus('idle');
    setPendingGeminiResult(null);

    try {
      if (useMultiCandidate) {
        // Special case: Gemini Only mode - no progressive enhancement needed
        if (pipelineMode === 'gemini_only') {
          setGeminiStatus('pending');

          const multiResult = await generateChoreographyWithCandidates(
            startFormation,
            endFormation,
            {
              dancerCount: dancerCount,
              spread: 1.0,
              totalCounts: 8,
              customStartPositions: customStartPositions.slice(0, dancerCount),
              customEndPositions: customEndPositions.slice(0, dancerCount),
              stageWidth: stageWidth,
              stageHeight: stageHeight,
              pipelineMode: 'gemini_only',
              useGeminiRanking: false, // No ranking in gemini_only mode
            }
          );

          setCandidates([]); // No candidates in gemini_only mode
          setRanking(null);
          setSelectedCandidateId('');
          setUsedGeminiRanking(false);
          setPreConstraint(null);
          setUsedGeminiPreConstraint(false);
          setResult(multiResult.selectedResult);
          setDancers(resultToDancerData(multiResult.selectedResult));
          setTotalCounts(multiResult.selectedResult.request.totalCounts);
          setGeminiStatus('success');

          // Log Gemini choreography info
          if (multiResult.geminiChoreography) {
            console.log('[Gemini Only] Strategy:', multiResult.geminiChoreography.strategy);
            console.log('[Gemini Only] Reasoning:', multiResult.geminiChoreography.reasoning);
            console.log('[Gemini Only] Confidence:', multiResult.geminiChoreography.confidence);
          }
        } else {
          // Progressive Enhancement: Local result first, Gemini in background
          const shouldUseGemini = pipelineMode !== 'without_gemini';

          const multiResult = await generateWithProgressiveEnhancement(
            startFormation,
            endFormation,
            {
              dancerCount: dancerCount,
              spread: 1.0,
              totalCounts: 8,
              customStartPositions: customStartPositions.slice(0, dancerCount),
              customEndPositions: customEndPositions.slice(0, dancerCount),
              stageWidth: stageWidth,
              stageHeight: stageHeight,
              pipelineMode: pipelineMode,
              assignmentMode: assignmentMode,
              lockedDancers: assignmentMode === 'partial' ? lockedDancers : undefined,
              // Callback when Gemini result arrives
              onGeminiResult: shouldUseGemini ? (geminiResult) => {
                console.log('[UI] Gemini result received:', geminiResult.geminiEnhancement?.status);
                const status = geminiResult.geminiEnhancement?.status || 'failed';
                setGeminiStatus(status);

                if (status === 'success' && geminiResult.geminiEnhancement?.enhancedResult) {
                  // Gemini selected different candidate - offer to user
                  setPendingGeminiResult(geminiResult);
                } else if (status === 'success') {
                  // Gemini agreed with local - just update ranking info
                  setRanking(geminiResult.ranking);
                  setUsedGeminiRanking(true);
                }
              } : undefined,
            }
          );

          // Immediately show local result
          setCandidates(multiResult.candidates);
          setRanking(multiResult.ranking);
          setSelectedCandidateId(multiResult.ranking?.selectedId || multiResult.candidates[0]?.id);
          setUsedGeminiRanking(multiResult.metadata.usedGeminiRanking);
          setPreConstraint(multiResult.preConstraint || null);
          setUsedGeminiPreConstraint(multiResult.metadata.usedGeminiPreConstraint);
          setResult(multiResult.selectedResult);
          setDancers(resultToDancerData(multiResult.selectedResult));
          setTotalCounts(multiResult.selectedResult.request.totalCounts);

          // Set pending status if Gemini is being called
          if (shouldUseGemini) {
            setGeminiStatus('pending');
          }
        }
      } else {
        // Single result mode (legacy)
        const choreographyResult = generateChoreographyDirect(
          startFormation,
          endFormation,
          {
            dancerCount: dancerCount,
            spread: 1.0,
            totalCounts: 8,
            customStartPositions: customStartPositions.slice(0, dancerCount),
            customEndPositions: customEndPositions.slice(0, dancerCount),
            stageWidth: stageWidth,
            stageHeight: stageHeight,
          }
        );

        setCandidates([]);
        setRanking(null);
        setResult(choreographyResult);
        setDancers(resultToDancerData(choreographyResult));
        setTotalCounts(choreographyResult.request.totalCounts);
      }

      setCurrentCount(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate choreography');
    } finally {
      setIsLoading(false);
    }
  }, [startFormation, endFormation, dancerCount, customStartPositions, customEndPositions, stageWidth, stageHeight, useMultiCandidate, pipelineMode]);

  // Candidate selection handler
  const handleSelectCandidate = useCallback((candidateId: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    setSelectedCandidateId(candidateId);

    // Update result with selected candidate
    const smoothPaths = candidate.paths.map(p => ({
      dancerId: p.dancerId,
      color: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFD93D', '#6C5CE7', '#A8E6CF', '#FF8C42'][(p.dancerId - 1) % 8],
      points: p.path,
      startTime: p.startTime,
      speed: p.speed,
      distance: p.totalDistance,
    }));

    if (result) {
      const newResult: ChoreographyResult = {
        ...result,
        paths: candidate.paths,
        smoothPaths,
        assignments: candidate.assignments,
      };
      setResult(newResult);
      setDancers(resultToDancerData(newResult));
    }
  }, [candidates, result]);

  // Apply Gemini enhanced result
  const handleApplyGeminiResult = useCallback(() => {
    if (!pendingGeminiResult) return;

    const geminiResult = pendingGeminiResult;
    setCandidates(geminiResult.candidates);
    setRanking(geminiResult.ranking);
    setSelectedCandidateId(geminiResult.ranking?.selectedId || geminiResult.candidates[0]?.id);
    setUsedGeminiRanking(true);
    setResult(geminiResult.selectedResult);
    setDancers(resultToDancerData(geminiResult.selectedResult));
    setPendingGeminiResult(null);
    setGeminiStatus('success');
  }, [pendingGeminiResult]);

  // Handle formation preset in editor
  const handleApplyPreset = useCallback((formation: FormationType, target: 'start' | 'end', spread: number = 1.0) => {
    const positions = generateFormation(formation, dancerCount, { stageWidth, stageHeight, spread });
    if (target === 'start') {
      setCustomStartPositions(positions);
      setStartFormation('custom');
    } else {
      setCustomEndPositions(positions);
      setEndFormation('custom');
    }
  }, [dancerCount, stageWidth, stageHeight]);

  // Handle dancer count change
  const handleDancerCountChange = useCallback((count: number) => {
    setDancerCount(count);
    // Regenerate positions for new count
    const startPos = generateFormation(startFormation === 'custom' ? 'line' : startFormation, count, { stageWidth, stageHeight });
    const endPos = generateFormation(endFormation === 'custom' ? 'v_shape' : endFormation, count, { stageWidth, stageHeight });
    setCustomStartPositions(startPos);
    setCustomEndPositions(endPos);
  }, [startFormation, endFormation, stageWidth, stageHeight]);

  // Handle stage preset change
  const handleStagePresetChange = useCallback((preset: StagePreset) => {
    setStagePreset(preset);
    if (preset !== 'custom') {
      setStageWidth(STAGE_PRESETS[preset].width);
      setStageHeight(STAGE_PRESETS[preset].height);
    }
  }, []);

  const handlePlay = useCallback(() => {
    if (currentCount >= totalCounts) {
      setCurrentCount(0);
    }
    setIsPlaying(true);
  }, [currentCount, totalCounts]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setCurrentCount(0);
  }, []);

  const handleSeek = useCallback((count: number) => {
    setCurrentCount(count);
    setIsPlaying(false);
  }, []);

  const dancerPositions = useMemo(() => {
    return dancers.map((dancer) => ({
      dancer,
      position: getDancerPositionAtCount(dancer, currentCount, totalCounts),
    }));
  }, [dancers, currentCount, totalCounts]);

  const formationText = result
    ? `${result.request.startFormation.type} → ${result.request.endFormation.type}`
    : 'Line → V-Shape';

  return (
    <div className="choreography-container">
      <header className="header">
        <h1>Dance Formation Choreography</h1>
        <p>{formationText} | {dancerCount} Dancers | {totalCounts} Counts</p>
      </header>

      <div className="input-section">
        <NaturalLanguageInput onGenerate={handleNLPGenerate} isLoading={isLoading} />
        <div className="divider">or</div>
        <StageSizeSelector
          preset={stagePreset}
          width={stageWidth}
          height={stageHeight}
          onPresetChange={handleStagePresetChange}
          onWidthChange={(w) => { setStageWidth(w); setStagePreset('custom'); }}
          onHeightChange={(h) => { setStageHeight(h); setStagePreset('custom'); }}
        />
        <FormationSelector
          startFormation={startFormation}
          endFormation={endFormation}
          dancerCount={dancerCount}
          onStartChange={(f) => {
            setStartFormation(f);
            if (f !== 'custom') {
              setCustomStartPositions(generateFormation(f, dancerCount, { stageWidth, stageHeight }));
            }
          }}
          onEndChange={(f) => {
            setEndFormation(f);
            if (f !== 'custom') {
              setCustomEndPositions(generateFormation(f, dancerCount, { stageWidth, stageHeight }));
            }
          }}
          onDancerCountChange={handleDancerCountChange}
          onGenerate={handleDirectGenerate}
          onEditStart={() => setEditingFormation('start')}
          onEditEnd={() => setEditingFormation('end')}
          isLoading={isLoading}
        />

        <div className="multi-candidate-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={useMultiCandidate}
              onChange={(e) => setUseMultiCandidate(e.target.checked)}
            />
            <span>🤖 Multi-Candidate Mode</span>
          </label>
          {useMultiCandidate && (
            <div className="pipeline-mode-selector">
              <label className={`mode-option ${pipelineMode === 'without_gemini' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="pipelineMode"
                  value="without_gemini"
                  checked={pipelineMode === 'without_gemini'}
                  onChange={() => setPipelineMode('without_gemini')}
                />
                <span className="mode-label">Without Gemini</span>
                <span className="mode-desc">Algorithm only, local ranking</span>
              </label>
              <label className={`mode-option ${pipelineMode === 'ranking_only' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="pipelineMode"
                  value="ranking_only"
                  checked={pipelineMode === 'ranking_only'}
                  onChange={() => setPipelineMode('ranking_only')}
                />
                <span className="mode-label">Ranking Only</span>
                <span className="mode-desc">Algorithm → Gemini ranking</span>
              </label>
              <label className={`mode-option ${pipelineMode === 'pre_and_ranking' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="pipelineMode"
                  value="pre_and_ranking"
                  checked={pipelineMode === 'pre_and_ranking'}
                  onChange={() => setPipelineMode('pre_and_ranking')}
                />
                <span className="mode-label">Pre + Ranking</span>
                <span className="mode-desc">Gemini constraints → Algorithm → Gemini ranking</span>
              </label>
              <label className={`mode-option gemini-only ${pipelineMode === 'gemini_only' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="pipelineMode"
                  value="gemini_only"
                  checked={pipelineMode === 'gemini_only'}
                  onChange={() => setPipelineMode('gemini_only')}
                />
                <span className="mode-label">🧪 Gemini Only</span>
                <span className="mode-desc">Gemini computes all paths directly (experimental)</span>
              </label>
            </div>
          )}
          {useMultiCandidate && (
            <span className="toggle-hint">
              {pipelineMode === 'without_gemini'
                ? '5 strategies → Local ranking'
                : pipelineMode === 'ranking_only'
                  ? `5 strategies → ${apiConfigured ? 'Gemini' : 'Local'} ranking`
                  : pipelineMode === 'gemini_only'
                    ? '🧪 Gemini computes all paths directly (no algorithm)'
                    : `Gemini constraints → ${apiConfigured ? 'Gemini' : 'Local'} ranking`}
            </span>
          )}
        </div>
      </div>

      {/* Formation Editor Modal */}
      {editingFormation && (
        <FormationEditor
          positions={editingFormation === 'start' ? customStartPositions : customEndPositions}
          dancerCount={dancerCount}
          title={editingFormation === 'start' ? 'Edit Start Formation' : 'Edit End Formation'}
          stageWidth={stageWidth}
          stageHeight={stageHeight}
          scale={scale}
          dancerRadius={dancerRadius}
          initialFormation={editingFormation === 'start' ? startFormation : endFormation}
          onPositionsChange={(pos) => {
            if (editingFormation === 'start') {
              setCustomStartPositions(pos);
              setStartFormation('custom');
            } else {
              setCustomEndPositions(pos);
              setEndFormation('custom');
            }
          }}
          onClose={() => setEditingFormation(null)}
          onApplyPreset={(f, spread) => handleApplyPreset(f, editingFormation, spread)}
          // End formation specific props
          isEndFormation={editingFormation === 'end'}
          assignmentMode={assignmentMode}
          lockedDancers={lockedDancers}
          onAssignmentModeChange={editingFormation === 'end' ? setAssignmentMode : undefined}
          onLockedDancersChange={editingFormation === 'end' ? setLockedDancers : undefined}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="main-content">
        <div className="stage-wrapper">
          <Stage stageWidth={stageWidth} stageHeight={stageHeight} scale={scale}>
            <AnimatePresence>
              {dancerPositions.map(({ dancer, position }) => (
                <Dancer
                  key={dancer.id}
                  dancer={dancer}
                  position={position}
                  showPath={showPaths}
                  isSelected={selectedDancer === dancer.id}
                  onSelect={() => setSelectedDancer(selectedDancer === dancer.id ? null : dancer.id)}
                  scale={scale}
                  stageHeight={stageHeight}
                  dancerRadius={dancerRadius}
                />
              ))}
            </AnimatePresence>
          </Stage>

          <PlaybackControls
            isPlaying={isPlaying}
            currentCount={currentCount}
            totalCounts={totalCounts}
            playbackSpeed={playbackSpeed}
            onPlay={handlePlay}
            onPause={handlePause}
            onReset={handleReset}
            onSeek={handleSeek}
            onSpeedChange={setPlaybackSpeed}
          />
        </div>

        <div className="side-panels">
          {/* Candidate comparison panel - most important position */}
          {useMultiCandidate && candidates.length > 0 && (
            <CandidateComparisonPanel
              candidates={candidates}
              ranking={ranking}
              selectedId={selectedCandidateId}
              onSelectCandidate={handleSelectCandidate}
              usedGeminiRanking={usedGeminiRanking}
              preConstraint={preConstraint}
              usedGeminiPreConstraint={usedGeminiPreConstraint}
              pipelineMode={pipelineMode}
              geminiStatus={geminiStatus}
              pendingGeminiResult={pendingGeminiResult}
              onApplyGeminiResult={handleApplyGeminiResult}
            />
          )}

          {/* Aesthetic evaluation - collapsible */}
          {result?.aestheticScore && (
            <CollapsiblePanel title="Aesthetic Score" defaultOpen={false}>
              <AestheticScorePanel score={result.aestheticScore} />
            </CollapsiblePanel>
          )}

          {/* Dancer info - collapsible */}
          <CollapsiblePanel title="Dancers Live Info" defaultOpen={false}>
            <DancerInfoPanel
              dancers={dancers}
              currentCount={currentCount}
              totalCounts={totalCounts}
              selectedDancer={selectedDancer}
              onSelectDancer={setSelectedDancer}
              showPaths={showPaths}
              onTogglePaths={() => setShowPaths(!showPaths)}
            />
          </CollapsiblePanel>
        </div>
      </div>

      {result && (
        <div className="metadata-section">
          <div className="metadata-item">
            <span>Total Distance:</span>
            <strong>{result.metadata.totalDistance.toFixed(2)}m</strong>
          </div>
          <div className="metadata-item">
            <span>Avg Distance:</span>
            <strong>{result.metadata.averageDistance.toFixed(2)}m</strong>
          </div>
          <div className="metadata-item">
            <span>Compute Time:</span>
            <strong>{result.metadata.computeTimeMs.toFixed(0)}ms</strong>
          </div>
          <div className="metadata-item">
            <span>Collision:</span>
            <strong style={{ color: result.validation.valid ? '#4ECDC4' : '#FF6B6B' }}>
              {result.validation.valid ? 'None' : `${result.validation.collisions.length}`}
            </strong>
          </div>
        </div>
      )}

      <div className="legend">
        <div className="legend-item">
          <span className="legend-symbol circle">○</span>
          <span>Start Position</span>
        </div>
        <div className="legend-item">
          <span className="legend-symbol diamond">◇</span>
          <span>End Position</span>
        </div>
        <div className="legend-item">
          <span className="legend-symbol line">---</span>
          <span>Movement Path</span>
        </div>
      </div>
    </div>
  );
}
