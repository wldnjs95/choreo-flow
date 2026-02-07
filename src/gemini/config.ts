/**
 * Gemini API Configuration
 *
 * API calls through serverless functions (key security)
 *
 * Production: Set VITE_API_URL to Railway API URL
 * Development: Uses localhost:3000
 */

// Server API endpoint
// Priority: VITE_API_URL > localhost (dev) > relative path (Vercel)
const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:3000' : '');

export const GEMINI_API_URL = `${API_BASE_URL}/api/gemini`;
export const HEALTH_API_URL = `${API_BASE_URL}/api/health`;

// Legacy compatibility (not used)
export const GEMINI_API_KEY = '';

export const GEMINI_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 32768,  // Increased for large choreography responses (10+ dancers × 20+ steps)
};

/**
 * Check if API key is configured on server (health check)
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
 * Call Gemini API through server
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
    throw new Error(`Gemini API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API response is empty.');
  }

  return text;
}

/**
 * Image data for Gemini API
 */
export interface GeminiImageData {
  base64: string;  // Base64 encoded image data (without data URL prefix)
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * Call Gemini API with images through server
 */
export async function callGeminiAPIWithImages(
  prompt: string,
  images: GeminiImageData[],
  config?: Partial<typeof GEMINI_CONFIG>
): Promise<string> {
  // Build parts array: text first, then images
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: prompt },
  ];

  // Add images
  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64,
      },
    });
  }

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { ...GEMINI_CONFIG, ...config },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API response is empty.');
  }

  return text;
}
