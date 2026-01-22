/**
 * src/gemini/generator.ts
 * * 알고리즘 개입 없이 Gemini가 직접 경로 좌표를 생성하는 모듈
 */

import { GEMINI_API_KEY, GEMINI_API_URL, GEMINI_CONFIG, isApiKeyConfigured } from './config';

interface GeneratedDancerPath {
  id: number;
  color?: string;
  path: { t: number; x: number; y: number }[]; // 시간 t에 따른 x, y 좌표
}

interface PureGeminiResponse {
  dancers: GeneratedDancerPath[];
  totalCounts: number;
  concept: string; // 생성된 안무 컨셉 설명
}

const GENERATOR_PROMPT = `당신은 세계적인 안무가이자 수학자입니다. 
주어진 무대 크기와 인원수에 맞춰 댄서들의 이동 경로 좌표를 직접 계산해서 JSON으로 출력하세요.

## 제약 조건:
1. **무대 크기**: 가로 {width}m x 세로 {height}m (좌표계: x는 0~{width}, y는 0~{height})
2. **인원**: {dancerCount}명 (ID: 1 ~ {dancerCount})
3. **시간**: 총 {totalCounts} 카운트 (t=0 부터 t={totalCounts} 까지)
4. **간격**: t는 정수 단위(0, 1, 2...)로 생성하세요.
5. **충돌 방지**: 댄서들 간의 거리가 최소 0.5m 이상 유지되도록 좌표를 배정하세요.
6. **범위**: 모든 좌표는 무대 범위 내에 있어야 합니다.

## 요청사항:
"{userInput}"

## 응답 형식 (JSON):
{
  "concept": "안무에 대한 짧은 설명",
  "totalCounts": {totalCounts},
  "dancers": [
    {
      "id": 1,
      "path": [
        {"t": 0, "x": 2.5, "y": 1.0},
        {"t": 1, "x": 2.8, "y": 1.5},
        ...
        {"t": {totalCounts}, "x": 5.0, "y": 5.0}
      ]
    },
    ...
  ]
}

JSON 외의 다른 말은 하지 마세요. 오직 JSON 데이터만 출력하세요.`;

/**
 * Gemini API 호출 (공통 함수 재사용 가능)
 */
async function callGemini(prompt: string): Promise<string> {
  if (!isApiKeyConfigured()) throw new Error('Gemini API Key Missing');
  
  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { ...GEMINI_CONFIG, responseMimeType: "application/json" } // JSON 모드 강제
    }),
  });

  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * 순수 Gemini 기반 경로 생성 함수
 */
export async function generatePathsViaGemini(
  userInput: string,
  options: { width: number; height: number; dancerCount: number; totalCounts?: number }
): Promise<PureGeminiResponse> {
  const { width, height, dancerCount, totalCounts = 8 } = options;

  // 프롬프트 변수 치환
  const prompt = GENERATOR_PROMPT
    .replace(/{width}/g, width.toString())
    .replace(/{height}/g, height.toString())
    .replace(/{dancerCount}/g, dancerCount.toString())
    .replace(/{totalCounts}/g, totalCounts.toString())
    .replace(/{userInput}/g, userInput);

  try {
    const jsonText = await callGemini(prompt);
    // 마크다운 코드 블록 제거 후 파싱
    const cleanJson = jsonText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJson) as PureGeminiResponse;
  } catch (e) {
    console.error("Gemini Path Generation Failed", e);
    throw new Error("Gemini가 경로를 생성하지 못했습니다.");
  }
}