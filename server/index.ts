/**
 * 로컬 개발용 API 서버
 *
 * Vercel 서버리스 함수를 로컬에서 테스트하기 위한 서버
 * 실행: npx ts-node server/index.ts 또는 bun run server/index.ts
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as dotenv from 'dotenv';

// Load environment variables (local: .env.local, production: system env)
dotenv.config({ path: '.env.local' });
dotenv.config(); // Also load from .env if exists

const app = new Hono();

// CORS 설정
app.use('/*', cors());

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3-pro-preview';  // Gemini 3 Pro Preview
const VISION_MODEL = 'gemini-3-pro-preview';   // Gemini 3 Pro Preview (also for images)

// Health check
app.get('/api/health', (c) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = !!apiKey && apiKey.length > 10;

  return c.json({
    status: 'ok',
    apiConfigured: isConfigured,
  });
});

// Gemini API 프록시 (타임아웃 없음 - Gemini Pro는 느림)
app.post('/api/gemini', async (c) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return c.json({ error: 'API key not configured' }, 500);
    }

    const body = await c.req.json();
    const { model, ...requestBody } = body;

    // Check if request contains image data (multimodal)
    const hasImage = requestBody.contents?.some((content: { parts?: Array<{ inlineData?: unknown }> }) =>
      content.parts?.some((part: { inlineData?: unknown }) => part.inlineData)
    );

    // Select appropriate model
    const selectedModel = model || (hasImage ? VISION_MODEL : DEFAULT_MODEL);
    const apiUrl = `${GEMINI_API_BASE}/${selectedModel}:generateContent`;

    console.log(`[Gemini] Using model: ${selectedModel}, hasImage: ${hasImage}`);

    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Gemini] API Error:', data.error);
      return c.json({ error: data.error?.message || 'Gemini API error' }, response.status);
    }

    // Log response for debugging
    const hasContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`[Gemini] Response received, hasContent: ${!!hasContent}`);

    // Debug: Log full response structure if empty
    if (!hasContent) {
      console.log('[Gemini] Empty content - Full response:', JSON.stringify(data, null, 2));
      // Check for safety block or other issues
      if (data.candidates?.[0]?.finishReason) {
        console.log('[Gemini] Finish reason:', data.candidates[0].finishReason);
      }
      if (data.promptFeedback) {
        console.log('[Gemini] Prompt feedback:', JSON.stringify(data.promptFeedback));
      }
    }

    return c.json(data);
  } catch (error) {
    console.error('[Gemini] Server error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🚀 API Server running on port ${port}`);
console.log(`   Health: /api/health`);
console.log(`   Gemini: /api/gemini`);

serve({
  fetch: app.fetch,
  port,
});
