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

// .env.local 파일 로드
dotenv.config({ path: '.env.local' });

const app = new Hono();

// CORS 설정
app.use('/*', cors());

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

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

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return c.json({ error: data.error?.message || 'Gemini API error' }, response.status);
    }

    return c.json(data);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

const port = 3000;
console.log(`🚀 API Server running at http://localhost:${port}`);
console.log(`   Health: http://localhost:${port}/api/health`);
console.log(`   Gemini: http://localhost:${port}/api/gemini`);

serve({
  fetch: app.fetch,
  port,
});
