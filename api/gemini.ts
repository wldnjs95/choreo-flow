/**
 * Vercel Serverless Function - Gemini API Proxy
 *
 * Node.js 런타임 사용 (타임아웃 없이 Pro 모델 사용)
 * Pro 플랜: 최대 60초, Enterprise: 최대 300초
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 60,  // Pro 플랜 최대값 (초)
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3-pro-preview';
const VISION_MODEL = 'gemini-3-pro-preview';
const ALLOWED_MODELS = ['gemini-3-pro-preview'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const { model, ...body } = req.body;

    // Check if request contains image data (multimodal)
    const hasImage = body.contents?.some((content: { parts?: Array<{ inlineData?: unknown }> }) =>
      content.parts?.some((part: { inlineData?: unknown }) => part.inlineData)
    );

    // Select appropriate model: explicit model > vision model for images > default
    const selectedModel = ALLOWED_MODELS.includes(model)
      ? model
      : (hasImage ? VISION_MODEL : DEFAULT_MODEL);

    console.log(`[Gemini] Using model: ${selectedModel}, hasImage: ${hasImage}`);
    const apiUrl = `${GEMINI_API_BASE}/${selectedModel}:generateContent`;

    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Gemini API error'
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
