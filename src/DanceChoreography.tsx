import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  generateChoreographyFromText,
  generateChoreographyDirect,
  generateFormation,
  type ChoreographyResult,
  type SmoothPath,
  type FormationType,
  type Position,
} from './algorithms';
import { isApiKeyConfigured, type AestheticScore } from './gemini';

// Visualization constants
const DEFAULT_STAGE_WIDTH = 12;  // World of Dance: 40ft ≈ 12m
const DEFAULT_STAGE_HEIGHT = 10; // World of Dance: 32ft ≈ 10m
const BASE_SCALE = 50; // 기본 스케일 (스테이지 크기에 따라 조정)
const PADDING = 40;
const BASE_DANCER_RADIUS = 0.4; // 미터 단위 dancer 반지름 (실제 사람 어깨 폭 기준)
const GRID_COLOR = '#2a2a3e';
const BACKGROUND_COLOR = '#1a1a2e';

// 스테이지 프리셋
const STAGE_PRESETS = {
  'world_of_dance': { width: 12, height: 10, label: 'World of Dance (40×32ft)' },
  'small': { width: 8, height: 6, label: 'Small (26×20ft)' },
  'medium': { width: 10, height: 8, label: 'Medium (33×26ft)' },
  'large': { width: 15, height: 12, label: 'Large (49×39ft)' },
  'custom': { width: 12, height: 10, label: 'Custom' },
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

// Get dancer position at specific count (시간 기반 보간)
function getDancerPositionAtCount(dancer: DancerData, count: number, _totalCounts: number): PathPoint {
  const path = dancer.path;

  // 경로가 없거나 비어있으면 시작 위치 반환
  if (!path || path.length === 0) {
    return dancer.startPosition;
  }

  // 시작 시간 이전이면 시작 위치
  const pathStartTime = path[0].t;
  const pathEndTime = path[path.length - 1].t;

  if (count <= pathStartTime) {
    return { x: path[0].x, y: path[0].y };
  }

  // 끝 시간 이후면 끝 위치
  if (count >= pathEndTime) {
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }

  // 시간 기반으로 경로 상 위치 찾기
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

  // fallback: 마지막 위치
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

      <motion.text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={Math.max(10, dancerRadius * 0.8)}
        fontWeight="bold"
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
    // X축 라벨 (2m 간격)
    for (let x = 0; x <= stageWidth; x += 2) {
      result.push(
        <text key={`lx-${x}`} x={PADDING + x * scale} y={height - 10} textAnchor="middle" fill="#666" fontSize="11">
          {x}m
        </text>
      );
    }
    // Y축 라벨 (2m 간격)
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
  const apiConfigured = isApiKeyConfigured();

  const examples = [
    '8명이 일렬에서 V자로 이동, 와이드하게',
    '원형에서 하트 모양으로, dancer 4 강조',
    '대각선에서 원형으로, 대칭 유지',
    '두 줄에서 다이아몬드로, 부드럽게',
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onGenerate(input.trim());
    }
  };

  return (
    <div className="nlp-input-section">
      <h3>자연어로 안무 생성</h3>
      {!apiConfigured && (
        <div className="api-warning">
          Gemini API 키가 설정되지 않았습니다. 기본 파서를 사용합니다.
          <br />
          <code>.env</code> 파일에 <code>VITE_GEMINI_API_KEY</code>를 설정하세요.
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: 8명이 일렬에서 V자로 이동, 센터 dancer 강조, 와이드하게"
          rows={3}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()} className="generate-btn">
          {isLoading ? '생성 중...' : '안무 생성'}
        </button>
      </form>
      <div className="examples">
        <span>예시:</span>
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

  const formatName = (f: FormationType) => {
    const names: Record<FormationType, string> = {
      line: '일렬',
      circle: '원형',
      v_shape: 'V자',
      diagonal: '대각선',
      scatter: '흩어짐',
      heart: '하트',
      diamond: '다이아몬드',
      triangle: '삼각형',
      two_lines: '두 줄',
      custom: '커스텀',
    };
    return names[f] || f;
  };

  return (
    <div className="formation-selector">
      <h3>대형 설정</h3>

      <div className="dancer-count-row">
        <label>인원 수:</label>
        <input
          type="number"
          min={2}
          max={24}
          value={dancerCount}
          onChange={(e) => onDancerCountChange(Math.max(2, Math.min(24, parseInt(e.target.value) || 2)))}
          className="dancer-count-input"
        />
        <span className="dancer-count-label">명</span>
      </div>

      <div className="formation-row">
        <div className="formation-select">
          <label>시작 대형:</label>
          <div className="formation-select-row">
            <select value={startFormation} onChange={(e) => onStartChange(e.target.value as FormationType)}>
              {formations.map((f) => (
                <option key={f} value={f}>{formatName(f)}</option>
              ))}
              <option value="custom">커스텀</option>
            </select>
            <button onClick={onEditStart} className="edit-btn" title="커스텀 편집">
              ✏️
            </button>
          </div>
        </div>
        <span className="arrow">→</span>
        <div className="formation-select">
          <label>끝 대형:</label>
          <div className="formation-select-row">
            <select value={endFormation} onChange={(e) => onEndChange(e.target.value as FormationType)}>
              {formations.map((f) => (
                <option key={f} value={f}>{formatName(f)}</option>
              ))}
              <option value="custom">커스텀</option>
            </select>
            <button onClick={onEditEnd} className="edit-btn" title="커스텀 편집">
              ✏️
            </button>
          </div>
        </div>
        <button onClick={onGenerate} disabled={isLoading} className="generate-btn small">
          {isLoading ? '...' : '생성'}
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
      <h4>스테이지 크기</h4>
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
            가로:
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
            세로:
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
        현재: {width}m × {height}m ({(width * 3.28).toFixed(0)}×{(height * 3.28).toFixed(0)} ft)
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
  onPositionsChange: (positions: Position[]) => void;
  onClose: () => void;
  onApplyPreset: (formation: FormationType) => void;
}

function FormationEditor({ positions, dancerCount, title, stageWidth, stageHeight, scale, dancerRadius, onPositionsChange, onClose, onApplyPreset }: FormationEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [localPositions, setLocalPositions] = useState<Position[]>(positions);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSize, setSnapSize] = useState(0.5); // 0.5m grid snap

  useEffect(() => {
    setLocalPositions(positions);
  }, [positions]);

  const svgWidth = stageWidth * scale + PADDING * 2;
  const svgHeight = stageHeight * scale + PADDING * 2;

  const snapToGrid = (value: number, gridSize: number): number => {
    return Math.round(value / gridSize) * gridSize;
  };

  const handleMouseDown = (id: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingId(id);
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingId === null || !svgRef.current) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    let x = ((e.clientX - rect.left - PADDING) / scale);
    let y = stageHeight - ((e.clientY - rect.top - PADDING) / scale);

    // Apply grid snap if enabled
    if (snapEnabled) {
      x = snapToGrid(x, snapSize);
      y = snapToGrid(y, snapSize);
    }

    // Clamp to stage bounds
    const clampedX = Math.max(0.5, Math.min(stageWidth - 0.5, x));
    const clampedY = Math.max(0.5, Math.min(stageHeight - 0.5, y));

    setLocalPositions(prev => prev.map((pos, i) =>
      i === draggingId ? { x: clampedX, y: clampedY } : pos
    ));
  }, [draggingId, snapEnabled, snapSize, scale, stageWidth, stageHeight]);

  const handleMouseUp = useCallback(() => {
    if (draggingId !== null) {
      onPositionsChange(localPositions);
    }
    setDraggingId(null);
  }, [draggingId, localPositions, onPositionsChange]);

  const presets: FormationType[] = ['line', 'circle', 'v_shape', 'diagonal', 'diamond', 'triangle', 'two_lines', 'scatter'];

  return (
    <div className="formation-editor-overlay">
      <div className="formation-editor">
        <div className="editor-header">
          <h3>{title}</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <div className="editor-toolbar">
          <div className="preset-buttons">
            {presets.map(p => (
              <button key={p} onClick={() => onApplyPreset(p)} className="preset-btn">
                {p === 'line' ? '일렬' : p === 'circle' ? '원형' : p === 'v_shape' ? 'V자' :
                 p === 'diagonal' ? '대각선' : p === 'diamond' ? '다이아' : p === 'triangle' ? '삼각' :
                 p === 'two_lines' ? '두줄' : '흩어짐'}
              </button>
            ))}
          </div>
          <div className="snap-controls">
            <label className="snap-toggle">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              <span>그리드 스냅</span>
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
        </div>

        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          style={{ background: BACKGROUND_COLOR, borderRadius: '8px', cursor: draggingId !== null ? 'grabbing' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <rect
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

            return (
              <g key={i} onMouseDown={handleMouseDown(i)} style={{ cursor: 'grab' }}>
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
                  stroke={draggingId === i ? '#fff' : 'rgba(255,255,255,0.3)'}
                  strokeWidth={draggingId === i ? 3 : 2}
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
              </g>
            );
          })}
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
                  const newPos = [...localPositions];
                  newPos[i] = { ...newPos[i], x: parseFloat(e.target.value) || 0 };
                  setLocalPositions(newPos);
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
                  const newPos = [...localPositions];
                  newPos[i] = { ...newPos[i], y: parseFloat(e.target.value) || 0 };
                  setLocalPositions(newPos);
                  onPositionsChange(newPos);
                }}
                className="coord-input"
              />
            </div>
          ))}
        </div>

        <div className="editor-footer">
          <button onClick={onClose} className="done-btn">완료</button>
        </div>
      </div>
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
    <div className="aesthetic-panel">
      <h3>미적 평가</h3>
      <div className="overall-score" style={{ borderColor: getScoreColor(score.overall) }}>
        <span className="score-value">{score.overall}</span>
        <span className="score-label">종합 점수</span>
      </div>
      <div className="score-details">
        {[
          { label: '대칭성', value: score.symmetry },
          { label: '중심 집중', value: score.centerFocus },
          { label: '교차 복잡도', value: score.crossingPenalty },
          { label: '흐름 부드러움', value: score.flowSmoothness },
          { label: '메인 강조', value: score.mainDancerEmphasis },
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
          <h4>피드백</h4>
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
  const [stagePreset, setStagePreset] = useState<StagePreset>('world_of_dance');
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

  // Initialize custom positions when dancer count changes
  useEffect(() => {
    const startPos = generateFormation(startFormation === 'custom' ? 'line' : startFormation, dancerCount);
    const endPos = generateFormation(endFormation === 'custom' ? 'v_shape' : endFormation, dancerCount);
    setCustomStartPositions(startPos);
    setCustomEndPositions(endPos);
  }, [dancerCount]);

  // Initialize with default choreography
  useEffect(() => {
    handleDirectGenerate();
  }, []);

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
      const choreographyResult = await generateChoreographyFromText(input, {
        useGeminiParser: isApiKeyConfigured(),
        useGeminiEvaluator: false,
        dancerCount: dancerCount,
      });

      setResult(choreographyResult);
      setDancers(resultToDancerData(choreographyResult));
      setTotalCounts(choreographyResult.request.totalCounts);
      setCurrentCount(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '안무 생성 실패');
    } finally {
      setIsLoading(false);
    }
  }, [dancerCount]);

  const handleDirectGenerate = useCallback(() => {
    setIsLoading(true);
    setError(null);

    try {
      const choreographyResult = generateChoreographyDirect(
        startFormation,
        endFormation,
        {
          dancerCount: dancerCount,
          spread: 1.0,
          totalCounts: 8,
          customStartPositions: startFormation === 'custom' ? customStartPositions.slice(0, dancerCount) : undefined,
          customEndPositions: endFormation === 'custom' ? customEndPositions.slice(0, dancerCount) : undefined,
        }
      );

      setResult(choreographyResult);
      setDancers(resultToDancerData(choreographyResult));
      setTotalCounts(choreographyResult.request.totalCounts);
      setCurrentCount(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '안무 생성 실패');
    } finally {
      setIsLoading(false);
    }
  }, [startFormation, endFormation, dancerCount, customStartPositions, customEndPositions]);

  // Handle formation preset in editor
  const handleApplyPreset = useCallback((formation: FormationType, target: 'start' | 'end') => {
    const positions = generateFormation(formation, dancerCount);
    if (target === 'start') {
      setCustomStartPositions(positions);
      setStartFormation('custom');
    } else {
      setCustomEndPositions(positions);
      setEndFormation('custom');
    }
  }, [dancerCount]);

  // Handle dancer count change
  const handleDancerCountChange = useCallback((count: number) => {
    setDancerCount(count);
    // Regenerate positions for new count
    const startPos = generateFormation(startFormation === 'custom' ? 'line' : startFormation, count);
    const endPos = generateFormation(endFormation === 'custom' ? 'v_shape' : endFormation, count);
    setCustomStartPositions(startPos);
    setCustomEndPositions(endPos);
  }, [startFormation, endFormation]);

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
        <div className="divider">또는</div>
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
              setCustomStartPositions(generateFormation(f, dancerCount));
            }
          }}
          onEndChange={(f) => {
            setEndFormation(f);
            if (f !== 'custom') {
              setCustomEndPositions(generateFormation(f, dancerCount));
            }
          }}
          onDancerCountChange={handleDancerCountChange}
          onGenerate={handleDirectGenerate}
          onEditStart={() => setEditingFormation('start')}
          onEditEnd={() => setEditingFormation('end')}
          isLoading={isLoading}
        />
      </div>

      {/* Formation Editor Modal */}
      {editingFormation && (
        <FormationEditor
          positions={editingFormation === 'start' ? customStartPositions : customEndPositions}
          dancerCount={dancerCount}
          title={editingFormation === 'start' ? '시작 대형 편집' : '끝 대형 편집'}
          stageWidth={stageWidth}
          stageHeight={stageHeight}
          scale={scale}
          dancerRadius={dancerRadius}
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
          onApplyPreset={(f) => handleApplyPreset(f, editingFormation)}
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
          <DancerInfoPanel
            dancers={dancers}
            currentCount={currentCount}
            totalCounts={totalCounts}
            selectedDancer={selectedDancer}
            onSelectDancer={setSelectedDancer}
            showPaths={showPaths}
            onTogglePaths={() => setShowPaths(!showPaths)}
          />

          {result?.aestheticScore && <AestheticScorePanel score={result.aestheticScore} />}
        </div>
      </div>

      {result && (
        <div className="metadata-section">
          <div className="metadata-item">
            <span>총 이동 거리:</span>
            <strong>{result.metadata.totalDistance.toFixed(2)}m</strong>
          </div>
          <div className="metadata-item">
            <span>평균 거리:</span>
            <strong>{result.metadata.averageDistance.toFixed(2)}m</strong>
          </div>
          <div className="metadata-item">
            <span>계산 시간:</span>
            <strong>{result.metadata.computeTimeMs.toFixed(0)}ms</strong>
          </div>
          <div className="metadata-item">
            <span>충돌:</span>
            <strong style={{ color: result.validation.valid ? '#4ECDC4' : '#FF6B6B' }}>
              {result.validation.valid ? '없음' : `${result.validation.collisions.length}건`}
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
