import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';

// Visualization constants
const DEFAULT_STAGE_WIDTH = 15;
const DEFAULT_STAGE_HEIGHT = 12;
const BASE_SCALE = 50;
const PADDING = 40;
const BASE_DANCER_RADIUS = 0.4;
const GRID_COLOR = '#2a2a3e';
const BACKGROUND_COLOR = '#1a1a2e';

// Dancer colors - 35 unique colors (ordered for maximum distinction)
const DANCER_COLORS = [
  '#FF6B6B', '#3498DB', '#2ECC71', '#FFD93D', '#9B59B6', '#FF8C42', '#4ECDC4', '#E056FD',
  '#1E90FF', '#27AE60', '#F79F1F', '#E74C3C', '#1ABC9C', '#6C5CE7', '#FF69B4', '#BADC58',
  '#2980B9', '#A8E6CF', '#F9CA24', '#E67E22', '#16A085', '#686DE0', '#E91E63', '#A4DE02',
  '#22A6B3', '#1E8449', '#F1C40F', '#8E44AD', '#48C9B0', '#BE2EDD', '#96CEB4', '#45B7D1', '#7B68EE', '#00CED1', '#D63384',
];

// Types
interface PathPoint {
  x: number;
  y: number;
  t: number;
}

interface DancerData {
  id: number;
  color: string;
  startPosition: { x: number; y: number };
  endPosition: { x: number; y: number };
  path: PathPoint[];
  startTime: number;
  speed: number;
  distance: number;
}

interface StepData {
  step_index: number;
  time_ratio: number;
  positions: Record<string, [number, number]>;
}

interface SimulationData {
  steps: StepData[];
}

// Example JSON data
const EXAMPLE_JSON = `{
  "steps": [
    {
      "step_index": 0,
      "time_ratio": 0.0,
      "positions": {
        "D1": [3.00, 10.00],
        "D2": [4.50, 8.50],
        "D3": [6.00, 7.00],
        "D4": [7.50, 5.50],
        "D5": [9.00, 4.00],
        "D6": [12.00, 10.00],
        "D7": [10.00, 8.50],
        "D8": [9.00, 7.00],
        "D9": [7.50, 5.50],
        "D10": [6.00, 4.00]
      }
    },
    {
      "step_index": 10,
      "time_ratio": 0.5,
      "positions": {
        "D1": [3.00, 4.88],
        "D2": [4.00, 5.30],
        "D3": [5.00, 5.72],
        "D4": [6.30, 6.14],
        "D5": [8.00, 6.56],
        "D6": [12.00, 4.88],
        "D7": [10.50, 5.30],
        "D8": [10.00, 5.72],
        "D9": [8.70, 6.14],
        "D10": [7.00, 6.56]
      }
    },
    {
      "step_index": 20,
      "time_ratio": 1.0,
      "positions": {
        "D1": [3.00, 2.20],
        "D2": [4.50, 3.63],
        "D3": [6.00, 5.05],
        "D4": [7.50, 6.49],
        "D5": [9.00, 7.91],
        "D6": [12.00, 2.20],
        "D7": [10.00, 3.63],
        "D8": [9.00, 5.05],
        "D9": [7.50, 6.49],
        "D10": [6.00, 7.91]
      }
    }
  ]
}`;

// Parse JSON to DancerData
function parseSimulationData(data: SimulationData, totalCounts: number): DancerData[] {
  if (!data.steps || data.steps.length === 0) return [];

  const firstStep = data.steps[0];
  const lastStep = data.steps[data.steps.length - 1];
  const dancerIds = Object.keys(firstStep.positions).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''));
    const numB = parseInt(b.replace(/\D/g, ''));
    return numA - numB;
  });

  return dancerIds.map((dancerId, index) => {
    const numericId = parseInt(dancerId.replace(/\D/g, ''));
    const startPos = firstStep.positions[dancerId];
    const endPos = lastStep.positions[dancerId];

    // Build path from all steps
    const path: PathPoint[] = data.steps.map(step => ({
      x: step.positions[dancerId][0],
      y: step.positions[dancerId][1],
      t: step.time_ratio * totalCounts,
    }));

    // Calculate total distance
    let distance = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      distance += Math.sqrt(dx * dx + dy * dy);
    }

    return {
      id: numericId,
      color: DANCER_COLORS[index % DANCER_COLORS.length],
      startPosition: { x: startPos[0], y: startPos[1] },
      endPosition: { x: endPos[0], y: endPos[1] },
      path,
      startTime: 0,
      speed: 1,
      distance,
    };
  });
}

// Get dancer position at specific count
function getDancerPositionAtCount(dancer: DancerData, count: number): { x: number; y: number } {
  const path = dancer.path;

  if (!path || path.length === 0) {
    return dancer.startPosition;
  }

  const pathStartTime = path[0].t;
  const pathEndTime = path[path.length - 1].t;

  if (count <= pathStartTime) {
    return { x: path[0].x, y: path[0].y };
  }

  if (count >= pathEndTime) {
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }

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

  return { x: path[path.length - 1].x, y: path[path.length - 1].y };
}

// Dancer Component
interface DancerProps {
  dancer: DancerData;
  position: { x: number; y: number };
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

// Stage Component
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
    for (let x = 0; x <= stageWidth; x += 2) {
      result.push(
        <text key={`lx-${x}`} x={PADDING + x * scale} y={height - 10} textAnchor="middle" fill="#666" fontSize="11">
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

// Playback Controls
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', backgroundColor: '#16213e', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ color: '#888', minWidth: '120px' }}>
          Timeline: <strong style={{ color: '#eee' }}>{currentCount.toFixed(2)}</strong> / {totalCounts}
        </label>
        <input
          type="range"
          min={0}
          max={totalCounts}
          step={0.01}
          value={currentCount}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={onReset} style={buttonStyle}>Reset</button>
        {isPlaying ? (
          <button onClick={onPause} style={{ ...buttonStyle, backgroundColor: '#e94560' }}>Pause</button>
        ) : (
          <button onClick={onPlay} style={{ ...buttonStyle, backgroundColor: '#4ade80' }}>Play</button>
        )}
        <select
          value={playbackSpeed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          style={{ ...buttonStyle, minWidth: '80px' }}
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  fontWeight: 'bold',
  backgroundColor: '#0f3460',
  color: '#eee',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

// Main Component
export default function SimulationPage() {
  const [jsonInput, setJsonInput] = useState(EXAMPLE_JSON);
  const [dancers, setDancers] = useState<DancerData[]>([]);
  const [parseError, setParseError] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showPaths, setShowPaths] = useState(true);
  const [selectedDancer, setSelectedDancer] = useState<number | null>(null);
  const [totalCounts, setTotalCounts] = useState(8);
  const [stageWidth, setStageWidth] = useState(DEFAULT_STAGE_WIDTH);
  const [stageHeight, setStageHeight] = useState(DEFAULT_STAGE_HEIGHT);

  const animationRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);
  const startCountRef = useRef<number>(0);

  // Parse JSON
  const handleParse = useCallback(() => {
    try {
      const data = JSON.parse(jsonInput) as SimulationData;
      if (!data.steps || !Array.isArray(data.steps)) {
        throw new Error('Invalid format: "steps" array is required');
      }
      if (data.steps.length === 0) {
        throw new Error('Steps array is empty');
      }

      const parsedDancers = parseSimulationData(data, totalCounts);
      setDancers(parsedDancers);
      setParseError('');
      setCurrentCount(0);
      setIsPlaying(false);

      // Auto-detect stage size based on positions
      let maxX = 0, maxY = 0;
      data.steps.forEach(step => {
        Object.values(step.positions).forEach(([x, y]) => {
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        });
      });
      setStageWidth(Math.ceil(maxX + 2));
      setStageHeight(Math.ceil(maxY + 2));

    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse error');
      setDancers([]);
    }
  }, [jsonInput, totalCounts]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    startTimeRef.current = performance.now();
    startCountRef.current = currentCount;
    const countDuration = 1000 / playbackSpeed;

    const animate = (time: number) => {
      const elapsed = time - startTimeRef.current;
      const newCount = startCountRef.current + (elapsed / countDuration);

      if (newCount >= totalCounts) {
        setCurrentCount(totalCounts);
        setIsPlaying(false);
        return;
      }

      setCurrentCount(newCount);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackSpeed, totalCounts]);

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
    setCurrentCount(0);
    setIsPlaying(false);
  }, []);

  const handleSeek = useCallback((count: number) => {
    setCurrentCount(count);
  }, []);

  // Calculate scale
  const scale = useMemo(() => {
    const maxWidth = 800;
    const maxHeight = 600;
    const scaleX = (maxWidth - PADDING * 2) / stageWidth;
    const scaleY = (maxHeight - PADDING * 2) / stageHeight;
    return Math.min(scaleX, scaleY, BASE_SCALE);
  }, [stageWidth, stageHeight]);

  const dancerRadius = BASE_DANCER_RADIUS * scale;

  // Get current positions
  const dancerPositions = useMemo(() => {
    return dancers.map((dancer) => ({
      dancer,
      position: getDancerPositionAtCount(dancer, currentCount),
    }));
  }, [dancers, currentCount]);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1a1a2e',
      color: '#eee',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0 }}>Step Simulation</h1>
        <a href="/" style={{ color: '#888', textDecoration: 'underline' }}>Back to Main</a>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {/* Left: JSON Input */}
        <div style={{ flex: '1 1 400px', minWidth: '300px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#888' }}>
              JSON Input (steps format):
            </label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              style={{
                width: '100%',
                height: '400px',
                padding: '12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                backgroundColor: '#16213e',
                color: '#eee',
                border: '1px solid #0f3460',
                borderRadius: '8px',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
            <label style={{ color: '#888' }}>Total Counts:</label>
            <input
              type="number"
              value={totalCounts}
              onChange={(e) => setTotalCounts(Math.max(1, parseInt(e.target.value) || 8))}
              style={{
                width: '80px',
                padding: '8px',
                backgroundColor: '#16213e',
                color: '#eee',
                border: '1px solid #0f3460',
                borderRadius: '4px',
              }}
            />
            <button
              onClick={handleParse}
              style={{
                ...buttonStyle,
                backgroundColor: '#e94560',
                padding: '10px 24px',
              }}
            >
              Parse & Load
            </button>
          </div>

          {parseError && (
            <div style={{
              padding: '12px',
              backgroundColor: '#4a1a1a',
              border: '1px solid #e94560',
              borderRadius: '8px',
              marginBottom: '16px',
            }}>
              <strong style={{ color: '#e94560' }}>Error:</strong> {parseError}
            </div>
          )}

          {dancers.length > 0 && (
            <div style={{
              padding: '12px',
              backgroundColor: '#1a3a1a',
              border: '1px solid #4ade80',
              borderRadius: '8px',
            }}>
              <strong style={{ color: '#4ade80' }}>Loaded:</strong> {dancers.length} dancers
            </div>
          )}
        </div>

        {/* Right: Visualization */}
        <div style={{ flex: '1 1 500px', minWidth: '400px' }}>
          {dancers.length > 0 ? (
            <>
              <Stage stageWidth={stageWidth} stageHeight={stageHeight} scale={scale}>
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
              </Stage>

              <div style={{ marginTop: '16px' }}>
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

              <div style={{ marginTop: '12px', display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowPaths(!showPaths)}
                  style={{
                    ...buttonStyle,
                    backgroundColor: showPaths ? '#4ade80' : '#0f3460',
                  }}
                >
                  {showPaths ? 'Hide Paths' : 'Show Paths'}
                </button>
              </div>

              {/* Dancer Info */}
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#16213e', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#888' }}>Dancers</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {dancers.map(dancer => {
                    const pos = getDancerPositionAtCount(dancer, currentCount);
                    return (
                      <div
                        key={dancer.id}
                        onClick={() => setSelectedDancer(selectedDancer === dancer.id ? null : dancer.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: selectedDancer === dancer.id ? dancer.color : '#0f3460',
                          color: selectedDancer === dancer.id ? '#000' : '#eee',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        D{dancer.id}: ({pos.x.toFixed(1)}, {pos.y.toFixed(1)})
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '400px',
              backgroundColor: '#16213e',
              borderRadius: '12px',
              color: '#666',
            }}>
              Enter JSON and click "Parse & Load" to visualize
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
