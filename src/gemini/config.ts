/**
 * Gemini API Configuration
 *
 * API 키를 여기에 설정하거나 환경 변수로 관리
 */

// TODO: 실제 API 키로 교체
export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';

export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export const GEMINI_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 8192,
};

/**
 * API 키가 설정되었는지 확인
 */
export function isApiKeyConfigured(): boolean {
  return GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' && GEMINI_API_KEY.length > 10;
}
