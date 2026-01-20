/**
 * 대형 생성기 (Formation Generator)
 *
 * 다양한 대형 타입에 대한 좌표 생성
 */

import type { Position } from './hungarian';

export type FormationType =
  | 'line'
  | 'circle'
  | 'v_shape'
  | 'diagonal'
  | 'scatter'
  | 'heart'
  | 'diamond'
  | 'triangle'
  | 'two_lines'
  | 'custom';

export interface FormationParams {
  centerX?: number;
  centerY?: number;
  radius?: number;
  width?: number;
  height?: number;
  spread?: number;
  angle?: number;
  direction?: 'horizontal' | 'vertical';
}

const STAGE_WIDTH = 10;
const STAGE_HEIGHT = 8;
const DEFAULT_CENTER_X = STAGE_WIDTH / 2;
const DEFAULT_CENTER_Y = STAGE_HEIGHT / 2;

/**
 * 대형 좌표 생성
 */
export function generateFormation(
  type: FormationType,
  dancerCount: number = 8,
  params: FormationParams = {}
): Position[] {
  const spread = params.spread ?? 1.0;

  switch (type) {
    case 'line':
      return generateLine(dancerCount, params, spread);
    case 'circle':
      return generateCircle(dancerCount, params, spread);
    case 'v_shape':
      return generateVShape(dancerCount, params, spread);
    case 'diagonal':
      return generateDiagonal(dancerCount, params, spread);
    case 'scatter':
      return generateScatter(dancerCount, params, spread);
    case 'heart':
      return generateHeart(dancerCount, params, spread);
    case 'diamond':
      return generateDiamond(dancerCount, params, spread);
    case 'triangle':
      return generateTriangle(dancerCount, params, spread);
    case 'two_lines':
      return generateTwoLines(dancerCount, params, spread);
    default:
      return generateLine(dancerCount, params, spread);
  }
}

/**
 * 일렬 대형
 */
function generateLine(count: number, params: FormationParams, spread: number): Position[] {
  const direction = params.direction ?? 'horizontal';
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? 1;  // 기본 y = 1 (무대 아래쪽)
  const minSpacing = 0.8; // 최소 dancer 간 간격

  // 인원수에 따라 필요한 최소 너비 계산
  const minWidth = (count - 1) * minSpacing;
  const maxWidth = direction === 'horizontal' ? STAGE_WIDTH - 1 : STAGE_HEIGHT - 1;
  const width = Math.min(Math.max(params.width ?? minWidth, minWidth), maxWidth) * spread;

  const positions: Position[] = [];
  const step = count > 1 ? width / (count - 1) : 0;
  const startX = centerX - width / 2;
  const startY = centerY;

  for (let i = 0; i < count; i++) {
    if (direction === 'horizontal') {
      positions.push({
        x: clamp(startX + i * step, 0.5, STAGE_WIDTH - 0.5),
        y: clamp(startY, 0.5, STAGE_HEIGHT - 0.5),
      });
    } else {
      positions.push({
        x: clamp(centerX, 0.5, STAGE_WIDTH - 0.5),
        y: clamp(startY + i * step, 0.5, STAGE_HEIGHT - 0.5),
      });
    }
  }

  return positions;
}

/**
 * 원형 대형
 */
function generateCircle(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const minSpacing = 0.9; // 최소 dancer 간 간격

  // 원둘레에서 필요한 최소 반지름: 둘레 = 2πr >= count * minSpacing
  const minRadius = (count * minSpacing) / (2 * Math.PI);
  // 무대 범위 내 최대 반지름
  const maxRadius = Math.min(
    centerX - 0.5,
    STAGE_WIDTH - centerX - 0.5,
    centerY - 0.5,
    STAGE_HEIGHT - centerY - 0.5
  );
  const radius = Math.min(Math.max(params.radius ?? minRadius, minRadius), maxRadius) * spread;

  const positions: Position[] = [];
  const angleStep = (2 * Math.PI) / count;

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + i * angleStep;  // 12시 방향부터 시작
    positions.push({
      x: clamp(centerX + radius * Math.cos(angle), 0.5, STAGE_WIDTH - 0.5),
      y: clamp(centerY + radius * Math.sin(angle), 0.5, STAGE_HEIGHT - 0.5),
    });
  }

  return positions;
}

/**
 * V자 대형
 */
function generateVShape(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const minSpacing = 1.0; // 최소 dancer 간 간격 (충돌 방지)

  // 한쪽 라인의 dancer 수
  const half = Math.floor(count / 2);
  const hasApex = count % 2 === 1;

  // 인원수에 따라 대형 크기 동적 계산
  // 각 라인에서 필요한 최소 길이 = (half - 1) * minSpacing * √2 (대각선)
  const minLineLength = half > 0 ? (half) * minSpacing * 1.2 : minSpacing;

  // 무대 범위 내에서 최대 크기 결정
  const maxWidth = Math.min(STAGE_WIDTH - 2, minLineLength * 1.5);  // 양쪽 여백 1m
  const maxHeight = Math.min(STAGE_HEIGHT - 2, minLineLength * 1.2); // 상하 여백 1m

  const width = Math.max(params.width ?? maxWidth, minLineLength) * spread;
  const height = Math.max(params.height ?? maxHeight, minLineLength * 0.8) * spread;

  // V의 꼭지점 위치 (무대 상단 쪽)
  const apexY = Math.min(STAGE_HEIGHT - 1, 1 + height);
  const centerY = params.centerY ?? apexY;

  const positions: Position[] = [];

  // 꼭지점 dancer (홀수일 때)
  if (hasApex) {
    positions.push({
      x: centerX,
      y: centerY,
    });
  }

  // 왼쪽, 오른쪽 라인 동시 생성
  for (let i = 0; i < half; i++) {
    // 꼭지점에서 시작해서 바깥으로 퍼지도록
    const ratio = (i + 1) / (half + (hasApex ? 0 : 1));

    const leftX = centerX - (width / 2) * ratio;
    const rightX = centerX + (width / 2) * ratio;
    const y = centerY - height * ratio;

    // 왼쪽
    positions.push({
      x: clamp(leftX, 0.5, STAGE_WIDTH - 0.5),
      y: clamp(y, 0.5, STAGE_HEIGHT - 0.5),
    });

    // 오른쪽
    positions.push({
      x: clamp(rightX, 0.5, STAGE_WIDTH - 0.5),
      y: clamp(y, 0.5, STAGE_HEIGHT - 0.5),
    });
  }

  // X좌표 기준 정렬 (시각적 일관성)
  return sortByX(positions);
}

/**
 * 대각선 대형
 */
function generateDiagonal(count: number, params: FormationParams, spread: number): Position[] {
  const width = (params.width ?? 8) * spread;
  const height = (params.height ?? 6) * spread;
  const angle = params.angle ?? 45;

  const positions: Position[] = [];
  const radians = (angle * Math.PI) / 180;

  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    positions.push({
      x: clamp(1 + width * ratio * Math.cos(radians), 0, STAGE_WIDTH),
      y: clamp(1 + height * ratio * Math.sin(radians), 0, STAGE_HEIGHT),
    });
  }

  return positions;
}

/**
 * 흩어진 대형 (랜덤 but 균등 분포)
 */
function generateScatter(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const radius = (params.radius ?? 3) * spread;

  // 골든 앵글을 사용한 균등 분포
  const positions: Position[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const theta = i * goldenAngle;
    positions.push({
      x: clamp(centerX + r * Math.cos(theta), 0.5, STAGE_WIDTH - 0.5),
      y: clamp(centerY + r * Math.sin(theta), 0.5, STAGE_HEIGHT - 0.5),
    });
  }

  return positions;
}

/**
 * 하트 대형
 */
function generateHeart(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const size = (params.radius ?? 2) * spread;

  const positions: Position[] = [];

  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI;
    // 하트 방정식
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);

    positions.push({
      x: clamp(centerX + (x / 16) * size, 0, STAGE_WIDTH),
      y: clamp(centerY + (y / 16) * size, 0, STAGE_HEIGHT),
    });
  }

  return positions;
}

/**
 * 다이아몬드 대형
 */
function generateDiamond(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const width = (params.width ?? 4) * spread;
  const height = (params.height ?? 5) * spread;

  const positions: Position[] = [];

  // 4개의 꼭지점에 dancer 배치
  const vertices = [
    { x: centerX, y: centerY + height / 2 },        // 위
    { x: centerX + width / 2, y: centerY },          // 오른쪽
    { x: centerX, y: centerY - height / 2 },         // 아래
    { x: centerX - width / 2, y: centerY },          // 왼쪽
  ];

  if (count <= 4) {
    return vertices.slice(0, count).map(v => ({
      x: clamp(v.x, 0, STAGE_WIDTH),
      y: clamp(v.y, 0, STAGE_HEIGHT),
    }));
  }

  // 꼭지점 + 변 위에 dancer 배치
  const perSide = Math.floor((count - 4) / 4);
  const remainder = (count - 4) % 4;

  for (let side = 0; side < 4; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0, STAGE_WIDTH),
      y: clamp(vertices[side].y, 0, STAGE_HEIGHT),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 4;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0, STAGE_WIDTH
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0, STAGE_HEIGHT
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * 삼각형 대형
 */
function generateTriangle(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const size = (params.radius ?? 3) * spread;

  const positions: Position[] = [];

  // 삼각형 꼭지점
  const vertices = [
    { x: centerX, y: centerY + size },                                    // 위
    { x: centerX - size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // 왼쪽 아래
    { x: centerX + size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // 오른쪽 아래
  ];

  if (count <= 3) {
    return vertices.slice(0, count).map(v => ({
      x: clamp(v.x, 0, STAGE_WIDTH),
      y: clamp(v.y, 0, STAGE_HEIGHT),
    }));
  }

  // 변 위에 dancer 분배
  const perSide = Math.floor((count - 3) / 3);
  const remainder = (count - 3) % 3;

  for (let side = 0; side < 3; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0, STAGE_WIDTH),
      y: clamp(vertices[side].y, 0, STAGE_HEIGHT),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 3;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0, STAGE_WIDTH
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0, STAGE_HEIGHT
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * 두 줄 대형
 */
function generateTwoLines(count: number, params: FormationParams, spread: number): Position[] {
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  const minSpacing = 0.8; // 최소 dancer 간 간격

  const perLine = Math.ceil(count / 2);
  const backCount = count - perLine;

  // 인원수에 따라 필요한 최소 너비 계산
  const minWidth = (Math.max(perLine, backCount) - 1) * minSpacing;
  const maxWidth = STAGE_WIDTH - 1;
  const width = Math.min(Math.max(params.width ?? minWidth, minWidth), maxWidth) * spread;
  const gap = Math.max(params.height ?? 2, 1.5) * spread;

  const positions: Position[] = [];

  // 앞줄
  for (let i = 0; i < perLine && positions.length < count; i++) {
    const step = perLine > 1 ? width / (perLine - 1) : 0;
    const x = perLine > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, STAGE_WIDTH - 0.5),
      y: clamp(centerY + gap / 2, 0.5, STAGE_HEIGHT - 0.5),
    });
  }

  // 뒷줄
  for (let i = 0; i < backCount; i++) {
    const step = backCount > 1 ? width / (backCount - 1) : 0;
    const x = backCount > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, STAGE_WIDTH - 0.5),
      y: clamp(centerY - gap / 2, 0.5, STAGE_HEIGHT - 0.5),
    });
  }

  return positions;
}

/**
 * 값 범위 제한
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * X좌표 기준 정렬
 */
function sortByX(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => a.x - b.x);
}

/**
 * 대형에 spread 적용
 */
export function applySpread(positions: Position[], spread: number): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

  return positions.map(p => ({
    x: clamp(centerX + (p.x - centerX) * spread, 0, STAGE_WIDTH),
    y: clamp(centerY + (p.y - centerY) * spread, 0, STAGE_HEIGHT),
  }));
}

/**
 * 대형 이동 (translate)
 */
export function translateFormation(positions: Position[], dx: number, dy: number): Position[] {
  return positions.map(p => ({
    x: clamp(p.x + dx, 0, STAGE_WIDTH),
    y: clamp(p.y + dy, 0, STAGE_HEIGHT),
  }));
}

/**
 * 대형 회전 (rotate around center)
 */
export function rotateFormation(positions: Position[], angleDegrees: number): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const radians = (angleDegrees * Math.PI) / 180;

  return positions.map(p => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return {
      x: clamp(centerX + dx * Math.cos(radians) - dy * Math.sin(radians), 0, STAGE_WIDTH),
      y: clamp(centerY + dx * Math.sin(radians) + dy * Math.cos(radians), 0, STAGE_HEIGHT),
    };
  });
}
