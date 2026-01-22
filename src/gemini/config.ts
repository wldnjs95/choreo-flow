/**
 * Gemini API Configuration
 *
 * 서버리스 함수를 통해 API 호출 (키 보안)
 */

// 서버 API 엔드포인트 (Vercel serverless function)
const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:3000' : '';

export const GEMINI_API_URL = `${API_BASE_URL}/api/gemini`;
export const HEALTH_API_URL = `${API_BASE_URL}/api/health`;

// 레거시 호환성 (사용하지 않음)
export const GEMINI_API_KEY = '';

export const GEMINI_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 8192,
};

/**
 * API 키가 서버에 설정되었는지 확인 (health check)
 */
export async function isApiKeyConfigured(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_API_URL);
    if (!response.ok) return false;
    const data = await response.json();
    return data.apiConfigured === true;
  } catch {
    return false;
  }
}

/**
 * 서버를 통해 Gemini API 호출
 */
export async function callGeminiAPI(prompt: string, config?: Partial<typeof GEMINI_CONFIG>): Promise<string> {
  const response = await fetch(GEMINI_API_URL, {
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
      generationConfig: { ...GEMINI_CONFIG, ...config },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API 오류: ${response.status} - ${errorData.error || 'Unknown error'}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API 응답이 비어있습니다.');
  }

  return text;
}
