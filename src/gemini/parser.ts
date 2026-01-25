/**
 * Gemini Natural Language Parsing Module
 *
 * Convert user's natural language input to algorithm parameters
 */

import { callGeminiAPI } from './config';
import type { Position } from '../algorithms/hungarian';

/**
 * Parsed choreography request
 */
export interface ChoreographyRequest {
  // Formation information
  startFormation: FormationSpec;
  endFormation: FormationSpec;

  // Constraints
  constraints: DancerConstraint[];

  // Style
  style: StyleSpec;

  // Main dancer (dancer to emphasize)
  mainDancer: number | null;

  // Keyframes (intermediate formations)
  keyframes: KeyframeSpec[];

  // Total count number
  totalCounts: number;

  // Original input text
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
  spread: number;          // 1.0 = default, >1 = wide, <1 = tight
  symmetry: boolean;       // Force left-right symmetry
  smoothness: number;      // Curve smoothness (0-1)
  speed: 'slow' | 'normal' | 'fast';
  dramatic: boolean;       // Dramatic movement
}

export interface KeyframeSpec {
  count: number;
  formation: FormationSpec;
}

/**
 * Natural language parsing prompt
 */
const PARSER_PROMPT = `You are a dance choreography parameter converter.

Convert user's natural language request to the following JSON schema.

## Schema:
{
  "startFormation": {
    "type": "line" | "circle" | "v_shape" | "diagonal" | "scatter" | "heart" | "diamond" | "custom",
    "positions": [{"x": number, "y": number}, ...],  // only needed for custom
    "params": {"centerX": number, "centerY": number, "radius": number, ...}  // optional
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
    "spread": number,       // 1.0 default, 1.5 = wide, 0.7 = tight
    "symmetry": boolean,
    "smoothness": number,   // 0.0 ~ 1.0
    "speed": "slow" | "normal" | "fast",
    "dramatic": boolean
  },
  "mainDancer": number | null,  // dancer number to emphasize (1-8)
  "keyframes": [
    {"count": number, "formation": {...}}
  ],
  "totalCounts": number  // default 8
}

## Formation Type Descriptions:
- line: horizontal or vertical line
- circle: circular
- v_shape: V-shaped
- diagonal: diagonal
- scatter: scattered
- heart: heart shape
- diamond: diamond shape
- custom: user-specified coordinates

## Stage Size:
- Width: 0 ~ 10m
- Height: 0 ~ 8m
- Number of dancers: 8 (numbered 1-8)

## Conversion Rules:
1. "wide" → spread: 1.3~1.5
2. "tight" → spread: 0.6~0.8
3. "smooth" → smoothness: 0.8~1.0
4. "dynamic" → dramatic: true
5. "keep symmetry" → symmetry: true
6. "emphasize dancer N" → mainDancer: N
7. "only left/right" → set bounds
8. "slowly" → speed: "slow"
9. "fast" → speed: "fast"

Return only valid JSON. No explanation, just JSON.

User input:
`;

/**
 * Extract JSON (handle markdown code blocks)
 */
function extractJSON(text: string): string {
  // Handle ```json ... ``` format
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // Plain JSON case
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  throw new Error('JSON not found.');
}

/**
 * Apply defaults
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
 * Parse natural language to choreography parameters
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
    console.error('Parsing error:', error);
    throw new Error(`Choreography request parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Mock parsing (for testing without API)
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

  // Parse formation
  if (input.includes('circle')) {
    if (input.includes('start') || input.includes('from')) {
      request.startFormation = { type: 'circle' };
    } else {
      request.endFormation = { type: 'circle' };
    }
  }
  if (input.includes('v shape') || input.includes('v_shape')) {
    request.endFormation = { type: 'v_shape' };
  }
  if (input.includes('heart')) {
    request.endFormation = { type: 'heart' };
  }
  if (input.includes('line')) {
    if (input.includes('end') || input.includes('to')) {
      request.endFormation = { type: 'line' };
    } else {
      request.startFormation = { type: 'line' };
    }
  }

  // Parse style
  if (input.includes('wide') || input.includes('large')) {
    request.style.spread = 1.4;
  }
  if (input.includes('tight') || input.includes('small')) {
    request.style.spread = 0.7;
  }
  if (input.includes('symmetry') || input.includes('symmetric')) {
    request.style.symmetry = true;
  }
  if (input.includes('smooth')) {
    request.style.smoothness = 0.9;
  }
  if (input.includes('dynamic') || input.includes('dramatic')) {
    request.style.dramatic = true;
  }
  if (input.includes('slow') || input.includes('slowly')) {
    request.style.speed = 'slow';
  }
  if (input.includes('fast') || input.includes('quick')) {
    request.style.speed = 'fast';
  }

  // Parse main dancer
  const dancerMatch = input.match(/dancer\s*(\d)|emphasize\s*(\d)|(\d)\s*main/);
  if (dancerMatch) {
    const num = dancerMatch[1] || dancerMatch[2] || dancerMatch[3];
    request.mainDancer = parseInt(num, 10);
  }

  // Parse constraints
  const leftMatch = input.match(/dancer\s*(\d).*left/);
  if (leftMatch) {
    const num = leftMatch[1];
    request.constraints.push({
      dancerId: parseInt(num, 10),
      bounds: { xMax: 5 },
    });
  }

  const rightMatch = input.match(/dancer\s*(\d).*right/);
  if (rightMatch) {
    const num = rightMatch[1];
    request.constraints.push({
      dancerId: parseInt(num, 10),
      bounds: { xMin: 5 },
    });
  }

  return request;
}
