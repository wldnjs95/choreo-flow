/**
 * Health check endpoint - API 키 설정 여부 확인
 */

export const config = {
  runtime: 'edge',
};

export default async function handler() {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = !!apiKey && apiKey.length > 10;

  return new Response(JSON.stringify({
    status: 'ok',
    apiConfigured: isConfigured,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
