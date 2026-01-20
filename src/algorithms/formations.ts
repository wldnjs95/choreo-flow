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
  stageWidth?: number;
  stageHeight?: number;
}

// 기본 스테이지 크기 (World of Dance 기준)
const DEFAULT_STAGE_WIDTH = 12;
const DEFAULT_STAGE_HEIGHT = 10;

/**
 * 대형 좌표 생성
 */
export function generateFormation(
  type: FormationType,
  dancerCount: number = 8,
  params: FormationParams = {}
): Position[] {
  const spread = params.spread ?? 1.0;
  const stageWidth = params.stageWidth ?? DEFAULT_STAGE_WIDTH;
  const stageHeight = params.stageHeight ?? DEFAULT_STAGE_HEIGHT;

  // 동적 스테이지 크기를 포함한 파라미터
  const fullParams = { ...params, stageWidth, stageHeight };

  switch (type) {
    case 'line':
      return generateLine(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'circle':
      return generateCircle(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'v_shape':
      return generateVShape(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'diagonal':
      return generateDiagonal(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'scatter':
      return generateScatter(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'heart':
      return generateHeart(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'diamond':
      return generateDiamond(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'triangle':
      return generateTriangle(dancerCount, fullParams, spread, stageWidth, stageHeight);
    case 'two_lines':
      return generateTwoLines(dancerCount, fullParams, spread, stageWidth, stageHeight);
    default:
      return generateLine(dancerCount, fullParams, spread, stageWidth, stageHeight);
  }
}

/**
 * 일렬 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateLine(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const direction = params.direction ?? 'horizontal';
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? 1;  // 기본 y = 1 (무대 아래쪽)
  const minSpacing = 0.8; // 최소 dancer 간 간격

  // 무대 크기 대비 사용 비율 계산 (spread 1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
  const usageRatio = Math.min(spread * 0.6, 1.0); // 최대 100%
  const maxAvailable = direction === 'horizontal' ? stageWidth - 1 : stageHeight - 1;
  const targetWidth = maxAvailable * usageRatio;

  // 최소 간격 보장
  const minWidth = (count - 1) * minSpacing;
  const width = Math.max(targetWidth, minWidth);

  const positions: Position[] = [];
  const step = count > 1 ? width / (count - 1) : 0;
  const startX = centerX - width / 2;
  const startY = centerY;

  for (let i = 0; i < count; i++) {
    if (direction === 'horizontal') {
      positions.push({
        x: clamp(startX + i * step, 0.5, stageWidth - 0.5),
        y: clamp(startY, 0.5, stageHeight - 0.5),
      });
    } else {
      positions.push({
        x: clamp(centerX, 0.5, stageWidth - 0.5),
        y: clamp(startY + i * step, 0.5, stageHeight - 0.5),
      });
    }
  }

  return positions;
}

/**
 * 원형 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateCircle(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;
  const minSpacing = 0.9; // 최소 dancer 간 간격

  // 원둘레에서 필요한 최소 반지름: 둘레 = 2πr >= count * minSpacing
  const minRadius = (count * minSpacing) / (2 * Math.PI);
  // 무대 범위 내 최대 반지름
  const maxAvailableRadius = Math.min(
    centerX - 0.5,
    stageWidth - centerX - 0.5,
    centerY - 0.5,
    stageHeight - centerY - 0.5
  );

  // 무대 크기 대비 사용 비율 계산
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const targetRadius = maxAvailableRadius * usageRatio;
  const radius = Math.max(targetRadius, minRadius);

  const positions: Position[] = [];
  const angleStep = (2 * Math.PI) / count;

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + i * angleStep;  // 12시 방향부터 시작
    positions.push({
      x: clamp(centerX + radius * Math.cos(angle), 0.5, stageWidth - 0.5),
      y: clamp(centerY + radius * Math.sin(angle), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * V자 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateVShape(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const minSpacing = 1.0; // 최소 dancer 간 간격 (충돌 방지)

  // 한쪽 라인의 dancer 수
  const half = Math.floor(count / 2);
  const hasApex = count % 2 === 1;

  // 최소 필요 크기
  const minLineLength = half > 0 ? (half) * minSpacing * 1.2 : minSpacing;

  // 무대 크기 대비 사용 비율 계산
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxAvailableWidth = stageWidth - 1;
  const maxAvailableHeight = stageHeight - 2;

  const targetWidth = maxAvailableWidth * usageRatio;
  const targetHeight = maxAvailableHeight * usageRatio;

  const width = Math.max(targetWidth, minLineLength);
  const height = Math.max(targetHeight * 0.8, minLineLength * 0.8);

  // V의 꼭지점 위치 (무대 상단 쪽)
  const apexY = Math.min(stageHeight - 1, 1 + height);
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
      x: clamp(leftX, 0.5, stageWidth - 0.5),
      y: clamp(y, 0.5, stageHeight - 0.5),
    });

    // 오른쪽
    positions.push({
      x: clamp(rightX, 0.5, stageWidth - 0.5),
      y: clamp(y, 0.5, stageHeight - 0.5),
    });
  }

  // X좌표 기준 정렬 (시각적 일관성)
  return sortByX(positions);
}

/**
 * 대각선 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateDiagonal(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const width = (stageWidth - 2) * usageRatio;
  const height = (stageHeight - 2) * usageRatio;
  const angle = params.angle ?? 45;

  const positions: Position[] = [];
  const radians = (angle * Math.PI) / 180;

  for (let i = 0; i < count; i++) {
    const ratio = count > 1 ? i / (count - 1) : 0;
    positions.push({
      x: clamp(1 + width * ratio * Math.cos(radians), 0.5, stageWidth - 0.5),
      y: clamp(1 + height * ratio * Math.sin(radians), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * 흩어진 대형 (랜덤 but 균등 분포)
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateScatter(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxRadius = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const radius = maxRadius * usageRatio;

  // 골든 앵글을 사용한 균등 분포
  const positions: Position[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const theta = i * goldenAngle;
    positions.push({
      x: clamp(centerX + r * Math.cos(theta), 0.5, stageWidth - 0.5),
      y: clamp(centerY + r * Math.sin(theta), 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * 하트 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateHeart(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxSize = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const size = maxSize * usageRatio;

  const positions: Position[] = [];

  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI;
    // 하트 방정식
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);

    positions.push({
      x: clamp(centerX + (x / 16) * size, 0.5, stageWidth - 0.5),
      y: clamp(centerY + (y / 16) * size, 0.5, stageHeight - 0.5),
    });
  }

  return positions;
}

/**
 * 다이아몬드 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateDiamond(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const width = (stageWidth - 1) * usageRatio;
  const height = (stageHeight - 1) * usageRatio;

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
      x: clamp(v.x, 0.5, stageWidth - 0.5),
      y: clamp(v.y, 0.5, stageHeight - 0.5),
    }));
  }

  // 꼭지점 + 변 위에 dancer 배치
  const perSide = Math.floor((count - 4) / 4);
  const remainder = (count - 4) % 4;

  for (let side = 0; side < 4; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0.5, stageWidth - 0.5),
      y: clamp(vertices[side].y, 0.5, stageHeight - 0.5),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 4;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0.5, stageWidth - 0.5
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0.5, stageHeight - 0.5
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * 삼각형 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateTriangle(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;

  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxSize = Math.min(stageWidth, stageHeight) / 2 - 0.5;
  const size = maxSize * usageRatio;

  const positions: Position[] = [];

  // 삼각형 꼭지점
  const vertices = [
    { x: centerX, y: centerY + size },                                    // 위
    { x: centerX - size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // 왼쪽 아래
    { x: centerX + size * Math.cos(Math.PI / 6), y: centerY - size / 2 }, // 오른쪽 아래
  ];

  if (count <= 3) {
    return vertices.slice(0, count).map(v => ({
      x: clamp(v.x, 0.5, stageWidth - 0.5),
      y: clamp(v.y, 0.5, stageHeight - 0.5),
    }));
  }

  // 변 위에 dancer 분배
  const perSide = Math.floor((count - 3) / 3);
  const remainder = (count - 3) % 3;

  for (let side = 0; side < 3; side++) {
    positions.push({
      x: clamp(vertices[side].x, 0.5, stageWidth - 0.5),
      y: clamp(vertices[side].y, 0.5, stageHeight - 0.5),
    });

    const extra = side < remainder ? 1 : 0;
    const dancersOnSide = perSide + extra;

    for (let i = 1; i <= dancersOnSide; i++) {
      const ratio = i / (dancersOnSide + 1);
      const nextSide = (side + 1) % 3;
      positions.push({
        x: clamp(
          vertices[side].x + (vertices[nextSide].x - vertices[side].x) * ratio,
          0.5, stageWidth - 0.5
        ),
        y: clamp(
          vertices[side].y + (vertices[nextSide].y - vertices[side].y) * ratio,
          0.5, stageHeight - 0.5
        ),
      });
    }
  }

  return positions.slice(0, count);
}

/**
 * 두 줄 대형
 * spread: 무대 사용 비율 (1.0 = 60%, 1.5 = 90%, 2.0 = 100%)
 */
function generateTwoLines(count: number, params: FormationParams, spread: number, stageWidth: number, stageHeight: number): Position[] {
  const centerX = params.centerX ?? stageWidth / 2;
  const centerY = params.centerY ?? stageHeight / 2;
  const minSpacing = 0.8; // 최소 dancer 간 간격

  const perLine = Math.ceil(count / 2);
  const backCount = count - perLine;

  // 무대 크기 대비 사용 비율 계산
  const usageRatio = Math.min(spread * 0.6, 1.0);
  const maxAvailableWidth = stageWidth - 1;
  const maxAvailableHeight = stageHeight - 2;

  const minWidth = (Math.max(perLine, backCount) - 1) * minSpacing;
  const targetWidth = maxAvailableWidth * usageRatio;
  const width = Math.max(targetWidth, minWidth);
  const gap = Math.max(maxAvailableHeight * usageRatio * 0.5, 1.5);

  const positions: Position[] = [];

  // 앞줄
  for (let i = 0; i < perLine && positions.length < count; i++) {
    const step = perLine > 1 ? width / (perLine - 1) : 0;
    const x = perLine > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, stageWidth - 0.5),
      y: clamp(centerY + gap / 2, 0.5, stageHeight - 0.5),
    });
  }

  // 뒷줄
  for (let i = 0; i < backCount; i++) {
    const step = backCount > 1 ? width / (backCount - 1) : 0;
    const x = backCount > 1 ? centerX - width / 2 + step * i : centerX;
    positions.push({
      x: clamp(x, 0.5, stageWidth - 0.5),
      y: clamp(centerY - gap / 2, 0.5, stageHeight - 0.5),
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
export function applySpread(positions: Position[], spread: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

  return positions.map(p => ({
    x: clamp(centerX + (p.x - centerX) * spread, 0.5, stageWidth - 0.5),
    y: clamp(centerY + (p.y - centerY) * spread, 0.5, stageHeight - 0.5),
  }));
}

/**
 * 대형 이동 (translate)
 */
export function translateFormation(positions: Position[], dx: number, dy: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  return positions.map(p => ({
    x: clamp(p.x + dx, 0.5, stageWidth - 0.5),
    y: clamp(p.y + dy, 0.5, stageHeight - 0.5),
  }));
}

/**
 * 대형 회전 (rotate around center)
 */
export function rotateFormation(positions: Position[], angleDegrees: number, stageWidth: number = DEFAULT_STAGE_WIDTH, stageHeight: number = DEFAULT_STAGE_HEIGHT): Position[] {
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const radians = (angleDegrees * Math.PI) / 180;

  return positions.map(p => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return {
      x: clamp(centerX + dx * Math.cos(radians) - dy * Math.sin(radians), 0.5, stageWidth - 0.5),
      y: clamp(centerY + dx * Math.sin(radians) + dy * Math.cos(radians), 0.5, stageHeight - 0.5),
    };
  });
}
