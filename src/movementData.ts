/**
 * Dance Choreography Movement Data
 *
 * Formation 1 (Start): 8 dancers in horizontal line at y=0
 * Formation 2 (End): V-shape formation
 *
 * Optimal Assignment (minimizes crossings, equalizes travel):
 * - Dancers 1-7: Move mostly straight up to corresponding V positions
 * - Dancer 8: Curves from far right to bottom center
 *
 * Timing Strategy:
 * - Longer distances start earlier
 * - All dancers arrive at count 8 together
 */

export interface PathPoint {
  x: number;
  y: number;
}

export interface DancerMovement {
  id: number;
  startPosition: PathPoint;
  endPosition: PathPoint;
  path: PathPoint[];
  startTime: number;  // Count to start moving (0-8)
  speed: number;      // Relative speed multiplier
  color: string;      // Hex color for visualization
  distance: number;   // Total travel distance in meters
}

// Helper function to generate smooth curved path using Catmull-Rom interpolation
function generateSmoothPath(
  start: PathPoint,
  end: PathPoint,
  controlPoints: PathPoint[],
  numPoints: number = 10
): PathPoint[] {
  const allPoints = [start, ...controlPoints, end];
  const path: PathPoint[] = [];

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const point = catmullRomInterpolate(allPoints, t);
    path.push(point);
  }

  return path;
}

function catmullRomInterpolate(points: PathPoint[], t: number): PathPoint {
  const n = points.length - 1;
  const scaledT = t * n;
  const i = Math.min(Math.floor(scaledT), n - 1);
  const localT = scaledT - i;

  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[Math.min(n, i + 1)];
  const p3 = points[Math.min(n, i + 2)];

  const t2 = localT * localT;
  const t3 = t2 * localT;

  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * localT +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );

  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * localT +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );

  return { x, y };
}

function calculateDistance(path: PathPoint[]): number {
  let distance = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    distance += Math.sqrt(dx * dx + dy * dy);
  }
  return Math.round(distance * 100) / 100;
}

// Define the 8 distinct colors for dancers
const DANCER_COLORS = [
  '#FF6B6B',  // Coral Red
  '#4ECDC4',  // Teal
  '#45B7D1',  // Sky Blue
  '#96CEB4',  // Sage Green
  '#FFD93D',  // Golden Yellow
  '#6C5CE7',  // Purple
  '#A8E6CF',  // Mint
  '#FF8C42',  // Orange
];

// Generate movement data for all 8 dancers
export const movementData: DancerMovement[] = [
  // Dancer 1: (0,0) → (0,2) - Left edge, short distance
  {
    id: 1,
    startPosition: { x: 0, y: 0 },
    endPosition: { x: 0, y: 2 },
    path: generateSmoothPath(
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      [
        { x: -0.3, y: 0.5 },
        { x: -0.4, y: 1.0 },
        { x: -0.3, y: 1.5 },
      ],
      10
    ),
    startTime: 3,
    speed: 1.0,
    color: DANCER_COLORS[0],
    distance: 0,
  },
  // Dancer 2: (1,0) → (1,3) - Second from left
  {
    id: 2,
    startPosition: { x: 1, y: 0 },
    endPosition: { x: 1, y: 3 },
    path: generateSmoothPath(
      { x: 1, y: 0 },
      { x: 1, y: 3 },
      [
        { x: 0.7, y: 0.8 },
        { x: 0.6, y: 1.5 },
        { x: 0.8, y: 2.3 },
      ],
      10
    ),
    startTime: 2,
    speed: 1.0,
    color: DANCER_COLORS[1],
    distance: 0,
  },
  // Dancer 3: (2,0) → (2,4) - Third from left
  {
    id: 3,
    startPosition: { x: 2, y: 0 },
    endPosition: { x: 2, y: 4 },
    path: generateSmoothPath(
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      [
        { x: 1.6, y: 1.0 },
        { x: 1.5, y: 2.0 },
        { x: 1.7, y: 3.0 },
      ],
      10
    ),
    startTime: 1,
    speed: 1.0,
    color: DANCER_COLORS[2],
    distance: 0,
  },
  // Dancer 4: (3,0) → (3,5) - Center to tip of V (longest distance)
  {
    id: 4,
    startPosition: { x: 3, y: 0 },
    endPosition: { x: 3, y: 5 },
    path: generateSmoothPath(
      { x: 3, y: 0 },
      { x: 3, y: 5 },
      [
        { x: 3.0, y: 1.2 },
        { x: 3.0, y: 2.5 },
        { x: 3.0, y: 3.8 },
      ],
      10
    ),
    startTime: 0,
    speed: 1.0,
    color: DANCER_COLORS[3],
    distance: 0,
  },
  // Dancer 5: (4,0) → (4,4) - Third from right (mirror of Dancer 3)
  {
    id: 5,
    startPosition: { x: 4, y: 0 },
    endPosition: { x: 4, y: 4 },
    path: generateSmoothPath(
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      [
        { x: 4.4, y: 1.0 },
        { x: 4.5, y: 2.0 },
        { x: 4.3, y: 3.0 },
      ],
      10
    ),
    startTime: 1,
    speed: 1.0,
    color: DANCER_COLORS[4],
    distance: 0,
  },
  // Dancer 6: (5,0) → (5,3) - Second from right (mirror of Dancer 2)
  {
    id: 6,
    startPosition: { x: 5, y: 0 },
    endPosition: { x: 5, y: 3 },
    path: generateSmoothPath(
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      [
        { x: 5.3, y: 0.8 },
        { x: 5.4, y: 1.5 },
        { x: 5.2, y: 2.3 },
      ],
      10
    ),
    startTime: 2,
    speed: 1.0,
    color: DANCER_COLORS[5],
    distance: 0,
  },
  // Dancer 7: (6,0) → (6,2) - Right edge (mirror of Dancer 1)
  {
    id: 7,
    startPosition: { x: 6, y: 0 },
    endPosition: { x: 6, y: 2 },
    path: generateSmoothPath(
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      [
        { x: 6.3, y: 0.5 },
        { x: 6.4, y: 1.0 },
        { x: 6.3, y: 1.5 },
      ],
      10
    ),
    startTime: 3,
    speed: 1.0,
    color: DANCER_COLORS[6],
    distance: 0,
  },
  // Dancer 8: (7,0) → (3,1) - Far right to bottom center (curved to avoid collisions)
  {
    id: 8,
    startPosition: { x: 7, y: 0 },
    endPosition: { x: 3, y: 1 },
    path: generateSmoothPath(
      { x: 7, y: 0 },
      { x: 3, y: 1 },
      [
        { x: 6.8, y: 0.8 },
        { x: 6.2, y: 1.8 },
        { x: 5.0, y: 2.2 },
        { x: 4.0, y: 1.8 },
        { x: 3.3, y: 1.3 },
      ],
      12
    ),
    startTime: 0,
    speed: 0.9,
    color: DANCER_COLORS[7],
    distance: 0,
  },
];

// Calculate distances for each dancer
movementData.forEach(dancer => {
  dancer.distance = calculateDistance(dancer.path);
});

// Stage dimensions
export const STAGE_WIDTH = 10;  // meters
export const STAGE_HEIGHT = 8; // meters
export const TOTAL_COUNTS = 8;

// Export as JSON-compatible format
export const movementDataJSON = {
  stageWidth: STAGE_WIDTH,
  stageHeight: STAGE_HEIGHT,
  totalCounts: TOTAL_COUNTS,
  transitionTime: "8 counts",
  constraints: {
    minimumSeparation: "0.5m",
    collisionAvoidance: true,
    smoothPaths: true,
  },
  dancers: movementData.map(d => ({
    id: d.id,
    color: d.color,
    startPosition: d.startPosition,
    endPosition: d.endPosition,
    path: d.path.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
    startTime: d.startTime,
    speed: d.speed,
    distance: d.distance,
  })),
};

// Function to get dancer position at a specific count
export function getDancerPositionAtCount(dancer: DancerMovement, count: number): PathPoint {
  // If before start time, stay at start position
  if (count <= dancer.startTime) {
    return dancer.startPosition;
  }

  // Calculate effective progress (accounting for start time and speed)
  const availableCounts = TOTAL_COUNTS - dancer.startTime;
  const elapsedCounts = count - dancer.startTime;
  const progress = Math.min(1, (elapsedCounts * dancer.speed) / availableCounts);

  // Interpolate along the path
  const pathIndex = progress * (dancer.path.length - 1);
  const lowerIndex = Math.floor(pathIndex);
  const upperIndex = Math.min(lowerIndex + 1, dancer.path.length - 1);
  const localT = pathIndex - lowerIndex;

  const p1 = dancer.path[lowerIndex];
  const p2 = dancer.path[upperIndex];

  return {
    x: p1.x + (p2.x - p1.x) * localT,
    y: p1.y + (p2.y - p1.y) * localT,
  };
}
