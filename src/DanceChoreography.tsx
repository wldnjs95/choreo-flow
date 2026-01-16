import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  movementData,
  getDancerPositionAtCount,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  TOTAL_COUNTS,
  type DancerMovement,
  type PathPoint,
} from './movementData';

// Visualization constants
const SCALE = 60; // pixels per meter
const PADDING = 40;
const DANCER_RADIUS = 18;
const GRID_COLOR = '#2a2a3e';
const BACKGROUND_COLOR = '#1a1a2e';

interface DancerProps {
  dancer: DancerMovement;
  position: PathPoint;
  showPath: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function Dancer({ dancer, position, showPath, isSelected, onSelect }: DancerProps) {
  const x = PADDING + position.x * SCALE;
  const y = PADDING + (STAGE_HEIGHT - position.y) * SCALE; // Flip Y for visual

  // Generate SVG path string for the dancer's trajectory
  const pathD = useMemo(() => {
    return dancer.path
      .map((p, i) => {
        const px = PADDING + p.x * SCALE;
        const py = PADDING + (STAGE_HEIGHT - p.y) * SCALE;
        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
      })
      .join(' ');
  }, [dancer.path]);

  return (
    <g onClick={onSelect} style={{ cursor: 'pointer' }}>
      {/* Path trail */}
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

      {/* Start position marker */}
      {showPath && (
        <circle
          cx={PADDING + dancer.startPosition.x * SCALE}
          cy={PADDING + (STAGE_HEIGHT - dancer.startPosition.y) * SCALE}
          r={6}
          fill="none"
          stroke={dancer.color}
          strokeWidth={2}
          opacity={0.6}
        />
      )}

      {/* End position marker */}
      {showPath && (
        <rect
          x={PADDING + dancer.endPosition.x * SCALE - 6}
          y={PADDING + (STAGE_HEIGHT - dancer.endPosition.y) * SCALE - 6}
          width={12}
          height={12}
          fill="none"
          stroke={dancer.color}
          strokeWidth={2}
          opacity={0.6}
          transform={`rotate(45 ${PADDING + dancer.endPosition.x * SCALE} ${PADDING + (STAGE_HEIGHT - dancer.endPosition.y) * SCALE})`}
        />
      )}

      {/* Dancer circle */}
      <motion.circle
        cx={x}
        cy={y}
        r={DANCER_RADIUS}
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

      {/* Dancer number */}
      <motion.text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize="14"
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

function Stage({ children }: { children: React.ReactNode }) {
  const width = STAGE_WIDTH * SCALE + PADDING * 2;
  const height = STAGE_HEIGHT * SCALE + PADDING * 2;

  // Generate grid lines
  const gridLines = useMemo(() => {
    const lines = [];
    // Vertical lines
    for (let x = 0; x <= STAGE_WIDTH; x++) {
      lines.push(
        <line
          key={`v-${x}`}
          x1={PADDING + x * SCALE}
          y1={PADDING}
          x2={PADDING + x * SCALE}
          y2={PADDING + STAGE_HEIGHT * SCALE}
          stroke={GRID_COLOR}
          strokeWidth={x % 5 === 0 ? 2 : 1}
        />
      );
    }
    // Horizontal lines
    for (let y = 0; y <= STAGE_HEIGHT; y++) {
      lines.push(
        <line
          key={`h-${y}`}
          x1={PADDING}
          y1={PADDING + y * SCALE}
          x2={PADDING + STAGE_WIDTH * SCALE}
          y2={PADDING + y * SCALE}
          stroke={GRID_COLOR}
          strokeWidth={y % 5 === 0 ? 2 : 1}
        />
      );
    }
    return lines;
  }, []);

  // Grid labels
  const labels = useMemo(() => {
    const result = [];
    // X-axis labels
    for (let x = 0; x <= STAGE_WIDTH; x++) {
      result.push(
        <text
          key={`lx-${x}`}
          x={PADDING + x * SCALE}
          y={height - 10}
          textAnchor="middle"
          fill="#666"
          fontSize="12"
        >
          {x}m
        </text>
      );
    }
    // Y-axis labels
    for (let y = 0; y <= STAGE_HEIGHT; y++) {
      result.push(
        <text
          key={`ly-${y}`}
          x={10}
          y={PADDING + (STAGE_HEIGHT - y) * SCALE + 4}
          textAnchor="start"
          fill="#666"
          fontSize="12"
        >
          {y}m
        </text>
      );
    }
    return result;
  }, [height]);

  return (
    <svg
      width={width}
      height={height}
      style={{
        background: BACKGROUND_COLOR,
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Stage boundary */}
      <rect
        x={PADDING}
        y={PADDING}
        width={STAGE_WIDTH * SCALE}
        height={STAGE_HEIGHT * SCALE}
        fill="rgba(40, 40, 60, 0.5)"
        stroke="#444"
        strokeWidth={2}
        rx={4}
      />
      {gridLines}
      {labels}
      {/* Center line */}
      <line
        x1={PADDING + (STAGE_WIDTH / 2) * SCALE}
        y1={PADDING}
        x2={PADDING + (STAGE_WIDTH / 2) * SCALE}
        y2={PADDING + STAGE_HEIGHT * SCALE}
        stroke="#444"
        strokeWidth={2}
        strokeDasharray="10,5"
      />
      {children}
    </svg>
  );
}

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentCount: number;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSeek: (count: number) => void;
  onSpeedChange: (speed: number) => void;
}

function PlaybackControls({
  isPlaying,
  currentCount,
  playbackSpeed,
  onPlay,
  onPause,
  onReset,
  onSeek,
  onSpeedChange,
}: PlaybackControlsProps) {
  return (
    <div className="controls">
      <div className="timeline-section">
        <label>
          Timeline: <strong>{currentCount.toFixed(2)}</strong> / {TOTAL_COUNTS} counts
        </label>
        <input
          type="range"
          min={0}
          max={TOTAL_COUNTS}
          step={0.01}
          value={currentCount}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="timeline-slider"
        />
      </div>

      <div className="button-section">
        <button onClick={onReset} className="control-btn reset">
          ⏮ Reset
        </button>
        {isPlaying ? (
          <button onClick={onPause} className="control-btn pause">
            ⏸ Pause
          </button>
        ) : (
          <button onClick={onPlay} className="control-btn play">
            ▶ Play
          </button>
        )}
      </div>

      <div className="speed-section">
        <label>Speed:</label>
        <div className="speed-buttons">
          {[0.5, 1, 2].map((speed) => (
            <button
              key={speed}
              onClick={() => onSpeedChange(speed)}
              className={`speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DancerInfoPanelProps {
  dancers: DancerMovement[];
  currentCount: number;
  selectedDancer: number | null;
  onSelectDancer: (id: number | null) => void;
  showPaths: boolean;
  onTogglePaths: () => void;
}

function DancerInfoPanel({
  dancers,
  currentCount,
  selectedDancer,
  onSelectDancer,
  showPaths,
  onTogglePaths,
}: DancerInfoPanelProps) {
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
          const position = getDancerPositionAtCount(dancer, currentCount);
          const isMoving = currentCount > dancer.startTime;
          const progress = Math.min(
            100,
            Math.max(
              0,
              ((currentCount - dancer.startTime) / (TOTAL_COUNTS - dancer.startTime)) * 100
            )
          );

          return (
            <div
              key={dancer.id}
              className={`dancer-info ${selectedDancer === dancer.id ? 'selected' : ''}`}
              onClick={() => onSelectDancer(selectedDancer === dancer.id ? null : dancer.id)}
            >
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
                  <span>
                    ({position.x.toFixed(2)}, {position.y.toFixed(2)})
                  </span>
                </div>
                <div className="detail-row">
                  <span>Speed:</span>
                  <span>{dancer.speed}x</span>
                </div>
                <div className="detail-row">
                  <span>Distance:</span>
                  <span>{dancer.distance}m</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progress}%`,
                      background: dancer.color,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DanceChoreography() {
  const [currentCount, setCurrentCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedDancer, setSelectedDancer] = useState<number | null>(null);
  const [showPaths, setShowPaths] = useState(true);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) return;

    const startTime = performance.now();
    const startCount = currentCount;
    const countDuration = 1000 / playbackSpeed; // 1 count per second at 1x speed

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const newCount = startCount + (elapsed / countDuration);

      if (newCount >= TOTAL_COUNTS) {
        setCurrentCount(TOTAL_COUNTS);
        setIsPlaying(false);
        return;
      }

      setCurrentCount(newCount);
      requestAnimationFrame(animate);
    };

    const frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, playbackSpeed, currentCount]);

  const handlePlay = useCallback(() => {
    if (currentCount >= TOTAL_COUNTS) {
      setCurrentCount(0);
    }
    setIsPlaying(true);
  }, [currentCount]);

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

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  // Calculate dancer positions
  const dancerPositions = useMemo(() => {
    return movementData.map((dancer) => ({
      dancer,
      position: getDancerPositionAtCount(dancer, currentCount),
    }));
  }, [currentCount]);

  return (
    <div className="choreography-container">
      <header className="header">
        <h1>Dance Formation Choreography</h1>
        <p>Line → V-Shape Transition | 8 Dancers | 8 Counts</p>
      </header>

      <div className="main-content">
        <div className="stage-wrapper">
          <Stage>
            <AnimatePresence>
              {dancerPositions.map(({ dancer, position }) => (
                <Dancer
                  key={dancer.id}
                  dancer={dancer}
                  position={position}
                  showPath={showPaths}
                  isSelected={selectedDancer === dancer.id}
                  onSelect={() =>
                    setSelectedDancer(selectedDancer === dancer.id ? null : dancer.id)
                  }
                />
              ))}
            </AnimatePresence>
          </Stage>

          <PlaybackControls
            isPlaying={isPlaying}
            currentCount={currentCount}
            playbackSpeed={playbackSpeed}
            onPlay={handlePlay}
            onPause={handlePause}
            onReset={handleReset}
            onSeek={handleSeek}
            onSpeedChange={handleSpeedChange}
          />
        </div>

        <DancerInfoPanel
          dancers={movementData}
          currentCount={currentCount}
          selectedDancer={selectedDancer}
          onSelectDancer={setSelectedDancer}
          showPaths={showPaths}
          onTogglePaths={() => setShowPaths(!showPaths)}
        />
      </div>

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
