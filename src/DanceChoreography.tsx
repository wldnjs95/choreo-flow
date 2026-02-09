import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  // generateChoreographyFromText,  // Hidden - NLP input disabled
  generateChoreographyDirect,
  generateWithProgressiveEnhancement,
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
import { type AestheticScore, type RankingResult } from './gemini';
import { generateFormationFromText, generateFormationFromSketch, FORMATION_EXAMPLES } from './gemini/formationGenerator';
import { generateCueSheet, type CueSheetResult } from './gemini/cueSheetGenerator';
import { CueSheetModal } from './components/CueSheetModal';
import preFormationData from '../formation_data/pre-formation.json';
import {
  DEFAULT_STAGE_WIDTH,
  DEFAULT_STAGE_HEIGHT,
  BASE_SCALE,
  PADDING,
  BASE_DANCER_RADIUS,
  GRID_COLOR,
  BACKGROUND_COLOR,
  STAGE_PRESETS,
  DANCER_COLORS,
  type StagePresetKey,
} from './constants';

// Collision test case presets - from pre-formation.json (4~12 dancers)
type TestCasePreset = 'none' | '4_dancers' | '5_dancers' | '6_dancers' | '7_dancers' | '8_dancers' | '9_dancers' | '10_dancers' | '11_dancers' | '12_dancers';

interface TestCase {
  label: string;
  description: string;
  dancerCount: number;
  stageWidth: number;
  stageHeight: number;
  getPositions: () => { start: Position[]; end: Position[] };
}

// Helper function to get formation positions from pre-formation.json
function getFormationByName(name: string): Position[] {
  const formation = preFormationData.formations.find(f => f.name === name);
  if (!formation) return [];
  return formation.positions.map(p => ({ x: p.x, y: p.y }));
}

const COLLISION_TEST_CASES: Record<TestCasePreset, TestCase | null> = {
  'none': null,
  '4_dancers': {
    label: '4 Dancers',
    description: '4_2line_1 → 4_2line_2',
    dancerCount: 4,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('4_2line_1'),
      end: getFormationByName('4_2line_2'),
    }),
  },
  '5_dancers': {
    label: '5 Dancers',
    description: '5_2line_1 → 5_2line_2',
    dancerCount: 5,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('5_2line_1'),
      end: getFormationByName('5_2line_2'),
    }),
  },
  '6_dancers': {
    label: '6 Dancers',
    description: '6_2line_1 → 6_vshape_2',
    dancerCount: 6,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('6_2line_1'),
      end: getFormationByName('6_vshape_2'),
    }),
  },
  '7_dancers': {
    label: '7 Dancers',
    description: '7_round_1 → 7_vvshape_2',
    dancerCount: 7,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('7_round_1'),
      end: getFormationByName('7_vvshape_2'),
    }),
  },
  '8_dancers': {
    label: '8 Dancers',
    description: '8_2line_1 → 8_v2line_2',
    dancerCount: 8,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('8_2line_1'),
      end: getFormationByName('8_v2line_2'),
    }),
  },
  '9_dancers': {
    label: '9 Dancers',
    description: '9_v2line_1 → 9_4line_2',
    dancerCount: 9,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('9_v2line_1'),
      end: getFormationByName('9_4line_2'),
    }),
  },
  '10_dancers': {
    label: '10 Dancers',
    description: '10_rvline_1 → 10_4line_2',
    dancerCount: 10,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('10_rvline_1'),
      end: getFormationByName('10_4line_2'),
    }),
  },
  '11_dancers': {
    label: '11 Dancers',
    description: '11_3vline_1 → 11_2dline_2',
    dancerCount: 11,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('11_3vline_1'),
      end: getFormationByName('11_2dline_2'),
    }),
  },
  '12_dancers': {
    label: '12 Dancers',
    description: '12_2dline_1 → 12_heart_2',
    dancerCount: 12,
    stageWidth: 15,
    stageHeight: 12,
    getPositions: () => ({
      start: getFormationByName('12_2dline_1'),
      end: getFormationByName('12_heart_2'),
    }),
  },
};

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

      {/* Group circle and text together for synchronized animation */}
      <motion.g
        initial={false}
        animate={{ x, y }}
        transition={{ type: 'tween', duration: 0.05 }}
      >
        <circle
          cx={0}
          cy={0}
          r={dancerRadius}
          fill={dancer.color}
          stroke={isSelected ? '#fff' : 'rgba(255,255,255,0.3)'}
          strokeWidth={isSelected ? 3 : 2}
          style={{
            filter: isSelected ? 'drop-shadow(0 0 10px rgba(255,255,255,0.5))' : 'none',
          }}
        />
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={Math.max(12, dancerRadius * 0.9)}
          fontWeight="bold"
          stroke="#000"
          strokeWidth={0.5}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {dancer.id}
        </text>
      </motion.g>
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

/* NaturalLanguageInput - Hidden but code preserved for future use
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
*/

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
            } else if (num > 35) {
              setInputValue('35');
              onDancerCountChange(35);
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
  preset: StagePresetKey;
  width: number;
  height: number;
  onPresetChange: (preset: StagePresetKey) => void;
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
          onChange={(e) => onPresetChange(e.target.value as StagePresetKey)}
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

  // AI Formation Generation State
  const [aiMode, setAiMode] = useState<'none' | 'text' | 'draw'>('none');
  const [textPrompt, setTextPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generationTime, setGenerationTime] = useState<number | null>(null);
  const [lastTextPrompt, setLastTextPrompt] = useState('');
  const [lastGenerationType, setLastGenerationType] = useState<'text' | 'sketch' | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);

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

  // AI Formation Generation - Text to Formation
  const handleTextGenerate = useCallback(async () => {
    if (!textPrompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setAiError(null);
    setGenerationTime(null);
    const startTime = performance.now();

    try {
      const result = await generateFormationFromText(
        textPrompt,
        dancerCount,
        stageWidth,
        stageHeight
      );

      const endTime = performance.now();
      setGenerationTime(endTime - startTime);
      setLastTextPrompt(textPrompt);
      setLastGenerationType('text');

      if (result.success && result.positions) {
        saveToHistory(localPositions);
        setLocalPositions(result.positions);
        isInternalChange.current = true;
        onPositionsChange(result.positions);
        setCurrentPreset(null);
        // Keep input visible - don't clear aiMode or textPrompt
      } else {
        setAiError(result.error || 'Failed to generate formation');
      }
    } catch (error) {
      const endTime = performance.now();
      setGenerationTime(endTime - startTime);
      setAiError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  }, [textPrompt, isGenerating, dancerCount, stageWidth, stageHeight, localPositions, saveToHistory, onPositionsChange]);

  // AI Formation Generation - Sketch to Formation
  const handleSketchGenerate = useCallback(async () => {
    if (!canvasRef.current || isGenerating || !hasDrawing) return;

    setIsGenerating(true);
    setAiError(null);
    setGenerationTime(null);
    const startTime = performance.now();

    try {
      const imageBase64 = canvasRef.current.toDataURL('image/png');

      const result = await generateFormationFromSketch(
        imageBase64,
        dancerCount,
        stageWidth,
        stageHeight
      );

      const endTime = performance.now();
      setGenerationTime(endTime - startTime);
      setLastGenerationType('sketch');

      if (result.success && result.positions) {
        saveToHistory(localPositions);
        setLocalPositions(result.positions);
        isInternalChange.current = true;
        onPositionsChange(result.positions);
        setCurrentPreset(null);
        // Keep sketch visible - don't clear aiMode or canvas
      } else {
        setAiError(result.error || 'Failed to generate formation');
      }
    } catch (error) {
      const endTime = performance.now();
      setGenerationTime(endTime - startTime);
      setAiError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, hasDrawing, dancerCount, stageWidth, stageHeight, localPositions, saveToHistory, onPositionsChange]);

  // Canvas drawing functions
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw stage background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw stage border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    // Draw grid
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    const gridSize = 30;
    for (let x = 10; x < canvas.width - 10; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, canvas.height - 10);
      ctx.stroke();
    }
    for (let y = 10; y < canvas.height - 10; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(canvas.width - 10, y);
      ctx.stroke();
    }

    // Add label
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.fillText('← Back of Stage', 15, canvas.height - 20);
    ctx.fillText('Front (Audience) →', canvas.width - 120, 25);

    setHasDrawing(false);
  }, []);

  const clearCanvas = useCallback(() => {
    initCanvas();
    setHasDrawing(false);
  }, [initCanvas]);

  // Initialize canvas when switching to draw mode
  useEffect(() => {
    if (aiMode === 'draw') {
      setTimeout(initCanvas, 50);  // Wait for canvas to be mounted
    }
  }, [aiMode, initCanvas]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDrawing(true);
    setHasDrawing(true);

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = '#4ECDC4';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
    }
  }, []);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }, [isDrawing]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // Add point on click (for placing dancer positions)
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Draw a point/circle to indicate dancer position
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#FF6B6B';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      setHasDrawing(true);
    }
  }, []);

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
    const deltaX = mouseX - dragStartRef.current.x;
    const deltaY = mouseY - dragStartRef.current.y;

    // Move selected dancers together
    const idsToMove = selectedIds.has(draggingId) ? selectedIds : new Set([draggingId]);

    // Smooth movement during drag (no snap)
    setLocalPositions(prev => prev.map((pos, i) => {
      if (!idsToMove.has(i)) return pos;

      const initialPos = initialPositionsRef.current[i];
      const newX = initialPos.x + deltaX;
      const newY = initialPos.y + deltaY;

      // Clamp to stage bounds
      const clampedX = Math.max(0.5, Math.min(stageWidth - 0.5, newX));
      const clampedY = Math.max(0.5, Math.min(stageHeight - 0.5, newY));

      return { x: clampedX, y: clampedY };
    }));
  }, [draggingId, isDraggingSelection, selectionBox, selectedIds, scale, stageWidth, stageHeight]);

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

    // Dancer drag complete - apply snap on release
    if (draggingId !== null) {
      const idsToMove = selectedIds.has(draggingId) ? selectedIds : new Set([draggingId]);

      // Snap positions to grid on release
      const snappedPositions = localPositions.map((pos, i) => {
        if (!snapEnabled || !idsToMove.has(i)) return pos;

        return {
          x: Math.max(0.5, Math.min(stageWidth - 0.5, snapToGrid(pos.x, snapSize))),
          y: Math.max(0.5, Math.min(stageHeight - 0.5, snapToGrid(pos.y, snapSize))),
        };
      });

      setLocalPositions(snappedPositions);
      isInternalChange.current = true;
      onPositionsChange(snappedPositions);
    }
    setDraggingId(null);
    dragStartRef.current = null;
  }, [draggingId, isDraggingSelection, selectionBox, localPositions, dancerCount, scale, stageHeight, onPositionsChange, selectedIds, snapEnabled, snapSize, stageWidth]);

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
                title={history.length === 0 ? "No actions to undo" : `Undo (${history.length} available) — Ctrl+Z`}
              >
                ↶{history.length > 0 && <span className="history-badge">{history.length}</span>}
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                className="redo-btn"
                title={future.length === 0 ? "No actions to redo" : `Redo (${future.length} available) — Ctrl+Shift+Z`}
              >
                ↷{future.length > 0 && <span className="history-badge">{future.length}</span>}
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

        {/* AI Formation Generation Section */}
        <div className="ai-formation-section">
          <div className="ai-mode-tabs">
            <button
              className={`ai-tab ${aiMode === 'none' ? 'active' : ''}`}
              onClick={() => setAiMode('none')}
            >
              Manual
            </button>
            <button
              className={`ai-tab ${aiMode === 'text' ? 'active' : ''}`}
              onClick={() => setAiMode('text')}
            >
              ✨ AI Text
            </button>
            <button
              className={`ai-tab ${aiMode === 'draw' ? 'active' : ''}`}
              onClick={() => setAiMode('draw')}
            >
              🎨 AI Sketch
            </button>
          </div>

          {aiMode === 'text' && (
            <div className="ai-text-section">
              <div className="ai-input-group">
                <input
                  type="text"
                  className="ai-text-input"
                  placeholder="예: V자 대형으로 배치해줘, 원형으로 만들어줘..."
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTextGenerate()}
                  disabled={isGenerating}
                />
                <button
                  className="ai-generate-btn"
                  onClick={handleTextGenerate}
                  disabled={isGenerating || !textPrompt.trim()}
                >
                  {isGenerating ? '생성중...' : '생성'}
                </button>
              </div>
              <div className="ai-examples">
                <span className="examples-label">예시:</span>
                {FORMATION_EXAMPLES.slice(0, 4).map((ex, i) => (
                  <button
                    key={i}
                    className="example-chip"
                    onClick={() => setTextPrompt(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {generationTime !== null && lastGenerationType === 'text' && lastTextPrompt && (
                <div className="ai-generation-info">
                  <span className="generation-prompt">"{lastTextPrompt}"</span>
                  <span className="generation-time">
                    {generationTime >= 1000
                      ? `${(generationTime / 1000).toFixed(2)}초`
                      : `${Math.round(generationTime)}ms`}
                  </span>
                </div>
              )}
              {aiError && <div className="ai-error">{aiError}</div>}
            </div>
          )}

          {aiMode === 'draw' && (
            <div className="ai-draw-section">
              <p className="draw-instruction">
                아래 캔버스에 원하는 대형을 그려주세요. 점을 찍거나 선을 그려서 댄서 위치를 표시하세요.
              </p>
              <div className="canvas-container">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={280}
                  className="drawing-canvas"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  onClick={handleCanvasClick}
                />
              </div>
              <div className="canvas-controls">
                <button className="canvas-btn" onClick={clearCanvas}>
                  지우기
                </button>
                <button
                  className="ai-generate-btn"
                  onClick={handleSketchGenerate}
                  disabled={isGenerating || !hasDrawing}
                >
                  {isGenerating ? '분석중...' : 'AI로 대형 생성'}
                </button>
              </div>
              {generationTime !== null && lastGenerationType === 'sketch' && (
                <div className="ai-generation-info">
                  <span className="generation-prompt">스케치에서 생성됨</span>
                  <span className="generation-time">
                    {generationTime >= 1000
                      ? `${(generationTime / 1000).toFixed(2)}초`
                      : `${Math.round(generationTime)}ms`}
                  </span>
                </div>
              )}
              {aiError && <div className="ai-error">{aiError}</div>}
            </div>
          )}
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

          {/* Exit zones (1.5m on each side) */}
          <rect
            className="exit-zone exit-zone-left"
            x={PADDING}
            y={PADDING}
            width={1.5 * scale}
            height={stageHeight * scale}
            fill="rgba(255, 107, 107, 0.15)"
            stroke="rgba(255, 107, 107, 0.4)"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          <rect
            className="exit-zone exit-zone-right"
            x={PADDING + (stageWidth - 1.5) * scale}
            y={PADDING}
            width={1.5 * scale}
            height={stageHeight * scale}
            fill="rgba(255, 107, 107, 0.15)"
            stroke="rgba(255, 107, 107, 0.4)"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          {/* Exit zone labels */}
          <text
            x={PADDING + 0.75 * scale}
            y={PADDING + 20}
            textAnchor="middle"
            fill="rgba(255, 107, 107, 0.6)"
            fontSize="10"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            EXIT
          </text>
          <text
            x={PADDING + (stageWidth - 0.75) * scale}
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
            x={PADDING + (stageWidth / 2) * scale}
            y={PADDING - 8}
            textAnchor="middle"
            fill="rgba(255, 255, 255, 0.4)"
            fontSize="10"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            FRONT (Audience)
          </text>
          <text
            x={PADDING + (stageWidth / 2) * scale}
            y={PADDING + stageHeight * scale + 16}
            textAnchor="middle"
            fill="rgba(255, 255, 255, 0.3)"
            fontSize="10"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            BACK
          </text>

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
  pipelineMode,
  geminiStatus,
  pendingGeminiResult,
  onApplyGeminiResult,
}: CandidateComparisonPanelProps) {
  const getStrategyLabel = (strategy: string) => {
    const labels: Record<string, string> = {
      'harmonized_flow': 'Harmonized Flow',
      'balanced_direct': 'Balanced Direct',
      'wave_sync': 'Wave Sync',
      'clean_flow': 'Clean Flow',
      'natural_curves': 'Natural Curves',
      'perfect_sync': 'Perfect Sync',
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
            🧪 Testing
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
  return result.smoothPaths.map((sp: SmoothPath) => {
    // Use path's actual start/end points (handles optimal assignment correctly)
    const pathStart = sp.points[0];
    const pathEnd = sp.points[sp.points.length - 1];

    return {
      id: sp.dancerId,
      color: sp.color,
      startPosition: { x: pathStart.x, y: pathStart.y },
      endPosition: { x: pathEnd.x, y: pathEnd.y },
      path: sp.points,
      startTime: sp.startTime,
      speed: sp.speed,
      distance: sp.distance,
    };
  });
}

export default function DanceChoreography() {
  const [currentCount, setCurrentCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedDancer, setSelectedDancer] = useState<number | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stage size state
  const [stagePreset, setStagePreset] = useState<StagePresetKey>('large');
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

  // Collision test case preset
  const [testCasePreset, setTestCasePreset] = useState<TestCasePreset>('none');
  const skipPositionUpdateRef = useRef(false);

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
  const pipelineMode: GeminiPipelineMode = 'testing_algorithm';
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('fixed');
  const [lockedDancers, setLockedDancers] = useState<Set<number>>(new Set());
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'pending' | 'success' | 'failed' | 'timeout'>('idle');
  const [pendingGeminiResult, setPendingGeminiResult] = useState<MultiCandidateResult | null>(null);

  // Cue Sheet state
  const [cueSheetModalOpen, setCueSheetModalOpen] = useState(false);
  const [cueSheet, setCueSheet] = useState<CueSheetResult | null>(null);
  const [cueSheetLoading, setCueSheetLoading] = useState(false);
  const [cueSheetError, setCueSheetError] = useState<string | null>(null);

  // Initialize custom positions when dancer count or stage size changes
  // Skip if test case preset just updated (to preserve test case positions)
  useEffect(() => {
    if (skipPositionUpdateRef.current) {
      skipPositionUpdateRef.current = false;
      return;
    }
    const startPos = generateFormation(startFormation === 'custom' ? 'line' : startFormation, dancerCount, { stageWidth, stageHeight });
    const endPos = generateFormation(endFormation === 'custom' ? 'v_shape' : endFormation, dancerCount, { stageWidth, stageHeight });
    setCustomStartPositions(startPos);
    setCustomEndPositions(endPos);
  }, [dancerCount, stageWidth, stageHeight]);

  // Do not generate formation initially (user clicks generate button)

  // Animation refs to avoid re-triggering effect on every frame
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const startCountRef = useRef<number>(0);

  // Animation loop - only depends on isPlaying and playbackSpeed
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    // Capture start values when animation begins
    startTimeRef.current = performance.now();
    startCountRef.current = currentCount;
    const countDuration = 1000 / playbackSpeed;

    const animate = (time: number) => {
      const elapsed = time - startTimeRef.current;
      const newCount = startCountRef.current + (elapsed / countDuration);

      if (newCount >= totalCounts) {
        setCurrentCount(totalCounts);
        setIsPlaying(false);
        animationRef.current = null;
        return;
      }

      setCurrentCount(newCount);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackSpeed, totalCounts]); // currentCount intentionally excluded

  /* handleNLPGenerate - Hidden but code preserved for future use
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
  */

  const handleDirectGenerate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setGeminiStatus('idle');
    setPendingGeminiResult(null);

    try {
      if (useMultiCandidate) {
        // Generate candidates with local ranking
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
          }
        );

        // Show result
        setCandidates(multiResult.candidates);
        setRanking(multiResult.ranking);
        setSelectedCandidateId(multiResult.ranking?.selectedId || multiResult.candidates[0]?.id);
        setUsedGeminiRanking(multiResult.metadata.usedGeminiRanking);
        setResult(multiResult.selectedResult);
        setDancers(resultToDancerData(multiResult.selectedResult));
        setTotalCounts(multiResult.selectedResult.request.totalCounts);
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

  // Generate cue sheet from current paths
  const handleGenerateCueSheet = useCallback(async () => {
    if (!result || dancers.length === 0) {
      setCueSheetError('No choreography data available. Generate paths first.');
      return;
    }

    setCueSheetLoading(true);
    setCueSheetError(null);

    try {
      // Convert dancers to DancerPath format for the cue sheet generator
      const paths = dancers.map(dancer => ({
        dancerId: dancer.id,
        path: dancer.path,
        totalDistance: dancer.distance,
        startTime: 0,
        speed: 1,
      }));

      const cueSheetResult = await generateCueSheet(paths, {
        language: 'en',
        stageWidth,
        stageHeight,
        totalCounts,
        includeRelativePositioning: true,
        includeArtisticNuance: true,
      });

      setCueSheet(cueSheetResult);
    } catch (err) {
      setCueSheetError(err instanceof Error ? err.message : 'Failed to generate cue sheet');
    } finally {
      setCueSheetLoading(false);
    }
  }, [result, dancers, stageWidth, stageHeight, totalCounts]);

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
    setTestCasePreset('none');
  }, [startFormation, endFormation, stageWidth, stageHeight]);

  // Handle test case preset change
  const handleTestCaseChange = useCallback((preset: TestCasePreset) => {
    setTestCasePreset(preset);
    const testCase = COLLISION_TEST_CASES[preset];
    if (!testCase) return;

    // Skip the position update in the useEffect
    skipPositionUpdateRef.current = true;

    const { start, end } = testCase.getPositions();
    setDancerCount(testCase.dancerCount);
    setStageWidth(testCase.stageWidth);
    setStageHeight(testCase.stageHeight);
    setCustomStartPositions(start);
    setCustomEndPositions(end);
    setStartFormation('custom');
    setEndFormation('custom');
    setStagePreset('custom');
  }, []);

  // Handle stage preset change
  const handleStagePresetChange = useCallback((preset: StagePresetKey) => {
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
        {/* NaturalLanguageInput hidden - code preserved for future use
        <NaturalLanguageInput onGenerate={handleNLPGenerate} isLoading={isLoading} />
        <div className="divider">or</div>
        */}
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

        {/* Collision Test Case Presets */}
        <div className="test-case-selector">
          <label className="test-case-label">
            <span>🧪 Collision Test Cases</span>
            <select
              value={testCasePreset}
              onChange={(e) => handleTestCaseChange(e.target.value as TestCasePreset)}
            >
              <option value="none">-- Select Test Case --</option>
              {Object.entries(COLLISION_TEST_CASES)
                .filter(([key]) => key !== 'none')
                .map(([key, testCase]) => (
                  <option key={key} value={key}>
                    {testCase?.label}
                  </option>
                ))}
            </select>
          </label>
          {testCasePreset !== 'none' && COLLISION_TEST_CASES[testCasePreset] && (
            <div className="test-case-info">
              <span className="test-case-desc">
                {COLLISION_TEST_CASES[testCasePreset]?.description}
              </span>
            </div>
          )}
        </div>

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
            <span className="toggle-hint">
              All strategies, select best by collision/crossing metrics
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
          <button
            className="cue-sheet-button"
            onClick={() => setCueSheetModalOpen(true)}
            title="Generate Cue Sheet for Dancers"
          >
            📋 Cue Sheet
          </button>
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

      {/* Cue Sheet Modal */}
      <CueSheetModal
        isOpen={cueSheetModalOpen}
        onClose={() => setCueSheetModalOpen(false)}
        cueSheet={cueSheet}
        isLoading={cueSheetLoading}
        error={cueSheetError}
        onGenerate={handleGenerateCueSheet}
      />
    </div>
  );
}
