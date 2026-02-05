/**
 * useGeminiAPI Hook
 * Custom hook for making Gemini API calls with loading, error, and timing state
 */

import { useState, useCallback } from 'react';
import { GEMINI_API_URL, GEMINI_CONFIG } from '../gemini/config';

export interface GeminiAPIOptions {
  model?: string;
  config?: Partial<typeof GEMINI_CONFIG>;
}

export interface GeminiAPIState {
  response: string;
  error: string;
  loading: boolean;
  elapsedTime: number | null;
}

export interface UseGeminiAPIReturn extends GeminiAPIState {
  call: (prompt: string, options?: GeminiAPIOptions) => Promise<string | null>;
  reset: () => void;
}

/**
 * Custom hook for Gemini API calls
 */
export function useGeminiAPI(): UseGeminiAPIReturn {
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);

  const reset = useCallback(() => {
    setResponse('');
    setError('');
    setLoading(false);
    setElapsedTime(null);
  }, []);

  const call = useCallback(async (
    prompt: string,
    options: GeminiAPIOptions = {}
  ): Promise<string | null> => {
    if (!prompt.trim()) return null;

    setLoading(true);
    setError('');
    setResponse('');
    setElapsedTime(null);

    const startTime = performance.now();

    try {
      const requestBody: Record<string, unknown> = {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: { ...GEMINI_CONFIG, ...options.config },
      };

      // Add model if specified
      if (options.model) {
        requestBody.model = options.model;
      }

      const res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(`API error: ${res.status} - ${errorData.error || 'Unknown error'}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const endTime = performance.now();
      setElapsedTime(endTime - startTime);
      setResponse(text);
      return text;
    } catch (err) {
      const endTime = performance.now();
      setElapsedTime(endTime - startTime);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    response,
    error,
    loading,
    elapsedTime,
    call,
    reset,
  };
}

/**
 * Available Gemini models
 */
export const GEMINI_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro Preview' },
] as const;

export type GeminiModelId = typeof GEMINI_MODELS[number]['id'];
