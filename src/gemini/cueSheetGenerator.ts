/**
 * Cue Sheet Generator using Gemini
 *
 * Converts algorithm-generated path data into natural language cue sheets
 * that dancers can intuitively understand.
 */

import { callGeminiAPI } from './index';
import type { DancerPath, PathPoint } from '../algorithms/pathfinder';

// ============================================
// Types
// ============================================

export interface CueSheetEntry {
  timeRange: string;        // e.g., "0~2 count"
  instruction: string;      // Natural language instruction
  notes?: string;           // Additional notes (interactions, etc.)
}

export interface DancerCueSheet {
  dancerId: number;
  dancerLabel: string;      // e.g., "D1", "Main Dancer"
  cues: CueSheetEntry[];
  summary: string;          // Brief summary of the dancer's role
}

export interface CueSheetResult {
  title: string;
  totalCounts: number;
  stageInfo: string;
  dancers: DancerCueSheet[];
  generalNotes: string[];
}

export interface CueSheetConfig {
  stageWidth: number;
  stageHeight: number;
  totalCounts: number;
  language: 'ko' | 'en';
  includeRelativePositioning: boolean;
  includeArtisticNuance: boolean;
}

// ============================================
// Path Analysis Helpers
// ============================================

interface MovementPhase {
  startTime: number;
  endTime: number;
  type: 'stationary' | 'moving' | 'accelerating' | 'decelerating';
  direction: string;
  speed: 'slow' | 'medium' | 'fast';
}

function analyzePathCurvature(path: PathPoint[]): { isCurved: boolean; direction: 'left' | 'right' | 'none'; maxDeviation: number } {
  if (path.length < 3) return { isCurved: false, direction: 'none', maxDeviation: 0 };

  const start = path[0];
  const end = path[path.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineLength = Math.sqrt(dx * dx + dy * dy);

  if (lineLength < 0.1) return { isCurved: false, direction: 'none', maxDeviation: 0 };

  let maxDeviation = 0;
  let deviationSign = 0;

  for (let i = 1; i < path.length - 1; i++) {
    const t = i / (path.length - 1);
    // Expected position on straight line (used for cross product calculation)
    const _expectedX = start.x + t * dx;
    const _expectedY = start.y + t * dy;
    void _expectedX; void _expectedY; // Mark as intentionally unused

    // Cross product to determine side
    const crossProduct = (path[i].x - start.x) * dy - (path[i].y - start.y) * dx;
    const deviation = Math.abs(crossProduct) / lineLength;

    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      deviationSign = Math.sign(crossProduct);
    }
  }

  const isCurved = maxDeviation > 0.3; // Threshold for considering it curved
  const direction = !isCurved ? 'none' : (deviationSign > 0 ? 'right' : 'left');

  return { isCurved, direction, maxDeviation };
}

function getStageZone(x: number, y: number, stageWidth: number, stageHeight: number): string {
  const relX = x / stageWidth;
  const relY = y / stageHeight;

  let zone = '';

  // Y-axis (front/back)
  if (relY < 0.33) {
    zone = 'downstage'; // Front (closer to audience)
  } else if (relY > 0.67) {
    zone = 'upstage'; // Back
  } else {
    zone = 'center';
  }

  // X-axis (left/right)
  if (relX < 0.33) {
    zone += ' left';
  } else if (relX > 0.67) {
    zone += ' right';
  }

  return zone.trim() || 'center';
}

function getStageZoneKorean(x: number, y: number, stageWidth: number, stageHeight: number): string {
  const relX = x / stageWidth;
  const relY = y / stageHeight;

  let yZone = '';
  let xZone = '';

  // Y-axis
  if (relY < 0.33) {
    yZone = '앞쪽';
  } else if (relY > 0.67) {
    yZone = '뒤쪽';
  } else {
    yZone = '중앙';
  }

  // X-axis
  if (relX < 0.33) {
    xZone = '왼쪽';
  } else if (relX > 0.67) {
    xZone = '오른쪽';
  }

  if (xZone) {
    return `${yZone} ${xZone}`;
  }
  return yZone;
}

function analyzeMovementPhases(path: PathPoint[], _totalCounts: number): MovementPhase[] {
  const phases: MovementPhase[] = [];
  if (path.length < 2) return phases;

  const STATIONARY_THRESHOLD = 0.1;
  let currentPhase: MovementPhase | null = null;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    const timeDiff = p2.t - p1.t;
    const speed = timeDiff > 0 ? dist / timeDiff : 0;

    const isStationary = dist < STATIONARY_THRESHOLD;
    const speedCategory: 'slow' | 'medium' | 'fast' = speed < 0.5 ? 'slow' : speed < 1.2 ? 'medium' : 'fast';

    const direction = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    const directionStr = getDirectionString(direction);

    const phaseType = isStationary ? 'stationary' : 'moving';

    if (!currentPhase || currentPhase.type !== phaseType) {
      if (currentPhase) {
        currentPhase.endTime = p1.t;
        phases.push(currentPhase);
      }
      currentPhase = {
        startTime: p1.t,
        endTime: p2.t,
        type: phaseType,
        direction: directionStr,
        speed: speedCategory,
      };
    } else {
      currentPhase.endTime = p2.t;
    }
  }

  if (currentPhase) {
    phases.push(currentPhase);
  }

  return phases;
}

function getDirectionString(angle: number): string {
  // Normalize angle to 0-360
  const normalizedAngle = ((angle % 360) + 360) % 360;

  if (normalizedAngle >= 337.5 || normalizedAngle < 22.5) return 'right';
  if (normalizedAngle >= 22.5 && normalizedAngle < 67.5) return 'downstage-right';
  if (normalizedAngle >= 67.5 && normalizedAngle < 112.5) return 'downstage';
  if (normalizedAngle >= 112.5 && normalizedAngle < 157.5) return 'downstage-left';
  if (normalizedAngle >= 157.5 && normalizedAngle < 202.5) return 'left';
  if (normalizedAngle >= 202.5 && normalizedAngle < 247.5) return 'upstage-left';
  if (normalizedAngle >= 247.5 && normalizedAngle < 292.5) return 'upstage';
  if (normalizedAngle >= 292.5 && normalizedAngle < 337.5) return 'upstage-right';
  return 'forward';
}

function findNearbyDancers(
  paths: DancerPath[],
  dancerId: number,
  time: number,
  proximityThreshold: number = 1.5
): number[] {
  const nearby: number[] = [];
  const currentPath = paths.find(p => p.dancerId === dancerId);
  if (!currentPath) return nearby;

  const currentPos = getPositionAtTime(currentPath.path, time);
  if (!currentPos) return nearby;

  for (const otherPath of paths) {
    if (otherPath.dancerId === dancerId) continue;

    const otherPos = getPositionAtTime(otherPath.path, time);
    if (!otherPos) continue;

    const dist = Math.sqrt((currentPos.x - otherPos.x) ** 2 + (currentPos.y - otherPos.y) ** 2);
    if (dist < proximityThreshold) {
      nearby.push(otherPath.dancerId);
    }
  }

  return nearby;
}

function getPositionAtTime(path: PathPoint[], time: number): { x: number; y: number } | null {
  if (path.length === 0) return null;
  if (time <= path[0].t) return { x: path[0].x, y: path[0].y };
  if (time >= path[path.length - 1].t) {
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }

  for (let i = 0; i < path.length - 1; i++) {
    if (time >= path[i].t && time <= path[i + 1].t) {
      const ratio = (time - path[i].t) / (path[i + 1].t - path[i].t);
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * ratio,
        y: path[i].y + (path[i + 1].y - path[i].y) * ratio,
      };
    }
  }
  return null;
}

// ============================================
// Data Formatting for Gemini
// ============================================

function formatPathDataForGemini(
  paths: DancerPath[],
  config: CueSheetConfig
): object {
  const formattedPaths = paths.map(dancerPath => {
    const curve = analyzePathCurvature(dancerPath.path);
    const phases = analyzeMovementPhases(dancerPath.path, config.totalCounts);

    const startPos = dancerPath.path[0];
    const endPos = dancerPath.path[dancerPath.path.length - 1];

    const startZone = config.language === 'ko'
      ? getStageZoneKorean(startPos.x, startPos.y, config.stageWidth, config.stageHeight)
      : getStageZone(startPos.x, startPos.y, config.stageWidth, config.stageHeight);

    const endZone = config.language === 'ko'
      ? getStageZoneKorean(endPos.x, endPos.y, config.stageWidth, config.stageHeight)
      : getStageZone(endPos.x, endPos.y, config.stageWidth, config.stageHeight);

    // Find interactions with nearby dancers
    const interactions: { time: number; nearbyDancers: number[] }[] = [];
    if (config.includeRelativePositioning) {
      for (let t = 0; t <= config.totalCounts; t += 0.5) {
        const nearby = findNearbyDancers(paths, dancerPath.dancerId, t);
        if (nearby.length > 0) {
          interactions.push({ time: t, nearbyDancers: nearby });
        }
      }
    }

    return {
      dancerId: dancerPath.dancerId,
      startPosition: { zone: startZone, x: Math.round(startPos.x * 10) / 10, y: Math.round(startPos.y * 10) / 10 },
      endPosition: { zone: endZone, x: Math.round(endPos.x * 10) / 10, y: Math.round(endPos.y * 10) / 10 },
      timing: {
        startTime: dancerPath.startTime,
        endTime: dancerPath.path[dancerPath.path.length - 1]?.t || config.totalCounts,
        delayBeforeStart: dancerPath.startTime,
      },
      movement: {
        totalDistance: Math.round(dancerPath.totalDistance * 10) / 10,
        avgSpeed: Math.round((dancerPath.totalDistance / (config.totalCounts - dancerPath.startTime)) * 10) / 10,
        isCurved: curve.isCurved,
        curveDirection: curve.direction,
        curveIntensity: curve.maxDeviation > 2 ? 'large' : curve.maxDeviation > 1 ? 'medium' : 'small',
      },
      phases: phases.map(p => ({
        timeRange: `${p.startTime.toFixed(1)}~${p.endTime.toFixed(1)}`,
        type: p.type,
        direction: p.direction,
        speed: p.speed,
      })),
      interactions: interactions.slice(0, 5), // Limit to avoid too much data
    };
  });

  return {
    stageConfig: {
      width: config.stageWidth,
      height: config.stageHeight,
      totalCounts: config.totalCounts,
      unit: 'meters',
    },
    dancers: formattedPaths,
  };
}

// ============================================
// Prompt Generation
// ============================================

function generateCueSheetPrompt(
  pathData: object,
  config: CueSheetConfig
): string {
  const isKorean = config.language === 'ko';

  if (isKorean) {
    return `## 역할 정의
당신은 20년 경력의 베테랑 **무대 감독 및 안무가**입니다.
컴퓨터 알고리즘이 계산한 '댄서 좌표 이동 데이터(JSON)'를 댄서들이 직관적으로 이해할 수 있는 **'자연어 큐시트'**로 변환하는 것이 당신의 임무입니다.

## 무대 컨텍스트
- 무대 크기: ${config.stageWidth}m (가로) × ${config.stageHeight}m (세로)
- 총 카운트: ${config.totalCounts} 카운트
- 좌표계: (0,0)은 무대 왼쪽 뒤, y가 클수록 앞(객석 방향)

### 무대 영역 정의
- **앞쪽 (Downstage)**: y > ${(config.stageHeight * 0.67).toFixed(1)}m (객석과 가까운 쪽)
- **뒤쪽 (Upstage)**: y < ${(config.stageHeight * 0.33).toFixed(1)}m (객석과 먼 쪽)
- **왼쪽**: x < ${(config.stageWidth * 0.33).toFixed(1)}m
- **오른쪽**: x > ${(config.stageWidth * 0.67).toFixed(1)}m
- **중앙**: 그 외 영역

## 해석 규칙
1. **좌표 직접 언급 금지**: "x:5로 이동"이 아닌 "무대 중앙으로 이동", "왼쪽 앞으로 전진" 등 무대 용어 사용
2. **상대적 위치 관계**: 다른 댄서와의 관계 명시 (예: "D5 옆을 지나며", "D2 뒤를 돌아서")
3. **정지 상태 감지**: 움직임이 없으면 "대기", "포즈 유지", "정지" 등으로 표현
4. **예술적 뉘앙스 추가**:
   - 빠른 속도 → "빠르게 질주", "폭발적으로 이동"
   - 곡선 경로 → "부드러운 곡선으로", "우아하게 휘어지며"
   - 느린 속도 → "천천히", "여유롭게"
${config.includeRelativePositioning ? '5. **교차/근접 상황**: 다른 댄서와 가까워지는 순간을 강조하여 주의 환기' : ''}

## 입력 데이터
\`\`\`json
${JSON.stringify(pathData, null, 2)}
\`\`\`

## 출력 형식
다음 JSON 형식으로 출력해주세요:

\`\`\`json
{
  "title": "큐시트 제목",
  "generalNotes": ["전체 주의사항 1", "전체 주의사항 2"],
  "dancers": [
    {
      "dancerId": 1,
      "dancerLabel": "D1",
      "summary": "이 댄서의 전체 동선 요약 (1문장)",
      "cues": [
        {
          "timeRange": "0~2 카운트",
          "instruction": "무대 뒤쪽 왼편에서 대기, 시선은 정면",
          "notes": "D3과 함께 시작 준비"
        },
        {
          "timeRange": "2~5 카운트",
          "instruction": "D5가 지나가자마자 빠르게 중앙으로 질주",
          "notes": "곡선으로 이동, D2와 교차 주의"
        }
      ]
    }
  ]
}
\`\`\`

**중요**:
- 반드시 유효한 JSON 형식으로만 출력
- 각 댄서별로 시간순 큐 작성
- 존댓말과 격려하는 톤 사용
- 실제 공연에서 사용 가능한 수준의 구체적 지시`;
  } else {
    return `## Role Definition
You are a veteran **Stage Director and Choreographer** with 20 years of experience.
Your mission is to translate 'Dancer Coordinate Movement Data (JSON)' calculated by computer algorithms into **'Natural Language Cue Sheets'** that dancers can intuitively understand.

## Stage Context
- Stage size: ${config.stageWidth}m (width) × ${config.stageHeight}m (depth)
- Total counts: ${config.totalCounts} counts
- Coordinate system: (0,0) is upstage left, higher y = closer to audience

### Stage Zone Definitions
- **Downstage (Front)**: y > ${(config.stageHeight * 0.67).toFixed(1)}m (closer to audience)
- **Upstage (Back)**: y < ${(config.stageHeight * 0.33).toFixed(1)}m (away from audience)
- **Stage Left**: x < ${(config.stageWidth * 0.33).toFixed(1)}m
- **Stage Right**: x > ${(config.stageWidth * 0.67).toFixed(1)}m
- **Center**: remaining area

## Interpretation Rules
1. **No Raw Coordinates**: Never say "move to x:5". Instead, use stage directions like "move to center stage", "advance downstage left"
2. **Relative Positioning**: Identify relationships with other dancers (e.g., "passing by D5", "circling behind D2")
3. **Detect Stillness**: If movement is minimal, describe as "Hold", "Maintain pose", "Standby"
4. **Add Artistic Nuance**:
   - High speed → "Dash quickly", "Explode into movement"
   - Curved path → "Move in a smooth arc", "Flow gracefully"
   - Slow speed → "Glide slowly", "Move with deliberation"
${config.includeRelativePositioning ? '5. **Crossings/Proximity**: Highlight moments when dancers come close to each other' : ''}

## Input Data
\`\`\`json
${JSON.stringify(pathData, null, 2)}
\`\`\`

## Output Format
Please output in the following JSON format:

\`\`\`json
{
  "title": "Cue Sheet Title",
  "generalNotes": ["General note 1", "General note 2"],
  "dancers": [
    {
      "dancerId": 1,
      "dancerLabel": "D1",
      "summary": "Brief summary of this dancer's movement (1 sentence)",
      "cues": [
        {
          "timeRange": "0~2 counts",
          "instruction": "Standby upstage left, eyes forward",
          "notes": "Prepare to start with D3"
        },
        {
          "timeRange": "2~5 counts",
          "instruction": "As soon as D5 passes, dash quickly to center stage",
          "notes": "Curved path, watch for crossing with D2"
        }
      ]
    }
  ]
}
\`\`\`

**Important**:
- Output ONLY valid JSON
- Write cues chronologically for each dancer
- Use polite, professional, and encouraging tone
- Be specific enough for actual performance use`;
  }
}

// ============================================
// Main API Function
// ============================================

export async function generateCueSheet(
  paths: DancerPath[],
  config: Partial<CueSheetConfig> = {}
): Promise<CueSheetResult> {
  const fullConfig: CueSheetConfig = {
    stageWidth: config.stageWidth || 12,
    stageHeight: config.stageHeight || 10,
    totalCounts: config.totalCounts || 8,
    language: config.language || 'ko',
    includeRelativePositioning: config.includeRelativePositioning ?? true,
    includeArtisticNuance: config.includeArtisticNuance ?? true,
  };

  // Format path data for Gemini
  const pathData = formatPathDataForGemini(paths, fullConfig);

  // Generate prompt
  const prompt = generateCueSheetPrompt(pathData, fullConfig);

  console.log('[CueSheetGenerator] Calling Gemini API...');

  try {
    const response = await callGeminiAPI(prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    let parsedResult: CueSheetResult;

    if (jsonMatch && jsonMatch[1]) {
      parsedResult = JSON.parse(jsonMatch[1]);
    } else {
      // Try parsing the entire response as JSON
      parsedResult = JSON.parse(response);
    }

    // Add stage info
    parsedResult.stageInfo = `${fullConfig.stageWidth}m × ${fullConfig.stageHeight}m`;
    parsedResult.totalCounts = fullConfig.totalCounts;

    console.log('[CueSheetGenerator] Cue sheet generated successfully');
    return parsedResult;

  } catch (error) {
    console.error('[CueSheetGenerator] Error:', error);
    throw new Error(`Failed to generate cue sheet: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================
// Export for testing
// ============================================

export {
  formatPathDataForGemini,
  generateCueSheetPrompt,
  analyzePathCurvature,
  getStageZone,
  getStageZoneKorean,
};
