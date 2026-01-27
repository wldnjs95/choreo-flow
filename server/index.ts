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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';
const FETCH_TIMEOUT = 55000; // 55초 (로컬은 제한 없음, 여유있게)

// Health check
app.get('/api/health', (c) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = !!apiKey && apiKey.length > 10;

  return c.json({
    status: 'ok',
    apiConfigured: isConfigured,
  });
});

// Gemini API 프록시
app.post('/api/gemini', async (c) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return c.json({ error: 'API key not configured' }, 500);
    }

    const body = await c.req.json();

    // AbortController로 타임아웃 처리
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        return c.json({ error: data.error?.message || 'Gemini API error' }, response.status);
      }

      return c.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return c.json({ error: 'Gemini API timeout', timeout: true }, 504);
      }
      throw fetchError;
    }
  } catch (error) {
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
