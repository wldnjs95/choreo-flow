/**
 * Gemini 자연어 파싱 모듈
 *
 * 사용자의 자연어 입력을 알고리즘 파라미터로 변환
 */

import { GEMINI_API_KEY, GEMINI_API_URL, GEMINI_CONFIG, isApiKeyConfigured } from './config';
import type { Position } from '../algorithms/hungarian';

/**
 * 파싱된 안무 요청
 */
export interface ChoreographyRequest {
  // 대형 정보
  startFormation: FormationSpec;
  endFormation: FormationSpec;

  // 제약 조건
  constraints: DancerConstraint[];

  // 스타일
  style: StyleSpec;

  // 메인 dancer (강조할 dancer)
  mainDancer: number | null;

  // 키프레임 (중간 대형)
  keyframes: KeyframeSpec[];

  // 전체 count 수
  totalCounts: number;

  // 원본 입력 텍스트
  originalInput: string;
}

export interface FormationSpec {
  type: 'line' | 'circle' | 'v_shape' | 'diagonal' | 'scatter' | 'heart' | 'diamond' | 'triangle' | 'two_lines' | 'custom';
  positions?: Position[];
  params?: Record<string, number>;
}

export interface DancerConstraint {
  dancerId: number;
  bounds?: {
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
  };
  mustPass?: {
    x: number;
    y: number;
    count: number;
  };
  avoidDancers?: number[];
}

export interface StyleSpec {
  spread: number;          // 1.0 = 기본, >1 = 와이드, <1 = 타이트
  symmetry: boolean;       // 좌우 대칭 강제
  smoothness: number;      // 곡선 부드러움 (0-1)
  speed: 'slow' | 'normal' | 'fast';
  dramatic: boolean;       // 드라마틱한 움직임
}

export interface KeyframeSpec {
  count: number;
  formation: FormationSpec;
}

/**
 * 자연어 파싱 프롬프트
 */
const PARSER_PROMPT = `당신은 댄스 안무 파라미터 변환기입니다.

사용자의 자연어 요청을 다음 JSON 스키마로 변환하세요.

## 스키마:
{
  "startFormation": {
    "type": "line" | "circle" | "v_shape" | "diagonal" | "scatter" | "heart" | "diamond" | "custom",
    "positions": [{"x": number, "y": number}, ...],  // custom일 때만 필요
    "params": {"centerX": number, "centerY": number, "radius": number, ...}  // 선택적
  },
  "endFormation": {
    "type": "...",
    "positions": [...],
    "params": {...}
  },
  "constraints": [
    {
      "dancerId": number,
      "bounds": {"xMin": number, "xMax": number, "yMin": number, "yMax": number},
      "mustPass": {"x": number, "y": number, "count": number}
    }
  ],
  "style": {
    "spread": number,       // 1.0 기본, 1.5 = 와이드, 0.7 = 타이트
    "symmetry": boolean,
    "smoothness": number,   // 0.0 ~ 1.0
    "speed": "slow" | "normal" | "fast",
    "dramatic": boolean
  },
  "mainDancer": number | null,  // 강조할 dancer 번호 (1-8)
  "keyframes": [
    {"count": number, "formation": {...}}
  ],
  "totalCounts": number  // 기본값 8
}

## 대형 타입 설명:
- line: 가로 또는 세로 일렬
- circle: 원형
- v_shape: V자 형태
- diagonal: 대각선
- scatter: 흩어진 형태
- heart: 하트 모양
- diamond: 다이아몬드 형태
- custom: 사용자 지정 좌표

## 무대 크기:
- 가로: 0 ~ 10m
- 세로: 0 ~ 8m
- dancer 수: 8명 (번호 1-8)

## 변환 규칙:
1. "와이드하게" → spread: 1.3~1.5
2. "타이트하게" → spread: 0.6~0.8
3. "부드럽게" → smoothness: 0.8~1.0
4. "역동적으로" → dramatic: true
5. "대칭 유지" → symmetry: true
6. "dancer N 강조" → mainDancer: N
7. "왼쪽/오른쪽에만" → bounds 설정
8. "천천히" → speed: "slow"
9. "빠르게" → speed: "fast"

반드시 유효한 JSON만 출력하세요. 설명 없이 JSON만 반환하세요.

사용자 입력:
`;

/**
 * Gemini API 호출
 */
async function callGeminiAPI(prompt: string): Promise<string> {
  if (!isApiKeyConfigured()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. src/gemini/config.ts 또는 환경 변수를 확인하세요.');
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: GEMINI_CONFIG,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 오류: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API 응답이 비어있습니다.');
  }

  return text;
}

/**
 * JSON 추출 (마크다운 코드 블록 처리)
 */
function extractJSON(text: string): string {
  // ```json ... ``` 형태 처리
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // 그냥 JSON인 경우
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  throw new Error('JSON을 찾을 수 없습니다.');
}

/**
 * 기본값 적용
 */
function applyDefaults(parsed: Partial<ChoreographyRequest>): ChoreographyRequest {
  return {
    startFormation: parsed.startFormation || { type: 'line' },
    endFormation: parsed.endFormation || { type: 'v_shape' },
    constraints: parsed.constraints || [],
    style: {
      spread: parsed.style?.spread ?? 1.0,
      symmetry: parsed.style?.symmetry ?? false,
      smoothness: parsed.style?.smoothness ?? 0.7,
      speed: parsed.style?.speed ?? 'normal',
      dramatic: parsed.style?.dramatic ?? false,
    },
    mainDancer: parsed.mainDancer ?? null,
    keyframes: parsed.keyframes || [],
    totalCounts: parsed.totalCounts ?? 8,
    originalInput: '',
  };
}

/**
 * 자연어를 안무 파라미터로 파싱
 */
export async function parseChoreographyRequest(userInput: string): Promise<ChoreographyRequest> {
  const prompt = PARSER_PROMPT + userInput;

  try {
    const responseText = await callGeminiAPI(prompt);
    const jsonStr = extractJSON(responseText);
    const parsed = JSON.parse(jsonStr);

    const result = applyDefaults(parsed);
    result.originalInput = userInput;

    return result;
  } catch (error) {
    console.error('파싱 오류:', error);
    throw new Error(`안무 요청 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

/**
 * Mock 파싱 (API 없이 테스트용)
 */
export function parseChoreographyRequestMock(userInput: string): ChoreographyRequest {
  const input = userInput.toLowerCase();

  const request: ChoreographyRequest = {
    startFormation: { type: 'line' },
    endFormation: { type: 'v_shape' },
    constraints: [],
    style: {
      spread: 1.0,
      symmetry: false,
      smoothness: 0.7,
      speed: 'normal',
      dramatic: false,
    },
    mainDancer: null,
    keyframes: [],
    totalCounts: 8,
    originalInput: userInput,
  };

  // 대형 파싱
  if (input.includes('원') || input.includes('circle')) {
    if (input.includes('시작') || input.includes('에서')) {
      request.startFormation = { type: 'circle' };
    } else {
      request.endFormation = { type: 'circle' };
    }
  }
  if (input.includes('v자') || input.includes('v shape') || input.includes('브이')) {
    request.endFormation = { type: 'v_shape' };
  }
  if (input.includes('하트') || input.includes('heart')) {
    request.endFormation = { type: 'heart' };
  }
  if (input.includes('일렬') || input.includes('line') || input.includes('라인')) {
    if (input.includes('끝') || input.includes('으로')) {
      request.endFormation = { type: 'line' };
    } else {
      request.startFormation = { type: 'line' };
    }
  }

  // 스타일 파싱
  if (input.includes('와이드') || input.includes('넓게') || input.includes('크게')) {
    request.style.spread = 1.4;
  }
  if (input.includes('타이트') || input.includes('좁게') || input.includes('작게')) {
    request.style.spread = 0.7;
  }
  if (input.includes('대칭') || input.includes('symmetry')) {
    request.style.symmetry = true;
  }
  if (input.includes('부드럽') || input.includes('smooth')) {
    request.style.smoothness = 0.9;
  }
  if (input.includes('역동') || input.includes('드라마틱') || input.includes('dramatic')) {
    request.style.dramatic = true;
  }
  if (input.includes('천천히') || input.includes('slow') || input.includes('느리게')) {
    request.style.speed = 'slow';
  }
  if (input.includes('빠르게') || input.includes('fast') || input.includes('빨리')) {
    request.style.speed = 'fast';
  }

  // 메인 dancer 파싱
  const dancerMatch = input.match(/dancer\s*(\d)|댄서\s*(\d)|(\d)번\s*강조|(\d)번이?\s*메인/);
  if (dancerMatch) {
    const num = dancerMatch[1] || dancerMatch[2] || dancerMatch[3] || dancerMatch[4];
    request.mainDancer = parseInt(num, 10);
  }

  // 제약 조건 파싱
  const leftMatch = input.match(/dancer\s*(\d)|댄서\s*(\d)|(\d)번.*왼쪽/);
  if (leftMatch) {
    const num = leftMatch[1] || leftMatch[2] || leftMatch[3];
    request.constraints.push({
      dancerId: parseInt(num, 10),
      bounds: { xMax: 5 },
    });
  }

  const rightMatch = input.match(/dancer\s*(\d)|댄서\s*(\d)|(\d)번.*오른쪽/);
  if (rightMatch) {
    const num = rightMatch[1] || rightMatch[2] || rightMatch[3];
    request.constraints.push({
      dancerId: parseInt(num, 10),
      bounds: { xMin: 5 },
    });
  }

  return request;
}
