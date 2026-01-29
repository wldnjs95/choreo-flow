import { useState } from 'react';
import { GEMINI_API_URL, GEMINI_CONFIG } from './gemini/config';

const MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 2.5 Pro Preview' },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview' },
];

export default function TestingPage() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    setResponse('');
    setElapsedTime(null);

    const startTime = performance.now();

    try {
      const res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: GEMINI_CONFIG,
        }),
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
    } catch (err) {
      const endTime = performance.now();
      setElapsedTime(endTime - startTime);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1a1a2e',
      color: '#eee',
      padding: '40px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1 style={{ marginBottom: '24px' }}>Gemini API Test</h1>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', color: '#888' }}>
          Model:
        </label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{
            padding: '10px 16px',
            fontSize: '14px',
            backgroundColor: '#16213e',
            color: '#eee',
            border: '1px solid #0f3460',
            borderRadius: '8px',
            outline: 'none',
            cursor: 'pointer',
            minWidth: '280px'
          }}
        >
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', color: '#888' }}>
          Prompt:
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt here..."
          style={{
            width: '100%',
            maxWidth: '800px',
            height: '150px',
            padding: '12px',
            fontSize: '14px',
            backgroundColor: '#16213e',
            color: '#eee',
            border: '1px solid #0f3460',
            borderRadius: '8px',
            resize: 'vertical',
            outline: 'none'
          }}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || !prompt.trim()}
        style={{
          padding: '12px 24px',
          fontSize: '14px',
          fontWeight: 'bold',
          backgroundColor: loading ? '#333' : '#e94560',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '24px'
        }}
      >
        {loading ? 'Sending...' : 'Send to Gemini'}
      </button>

      {error && (
        <div style={{
          padding: '16px',
          backgroundColor: '#4a1a1a',
          border: '1px solid #e94560',
          borderRadius: '8px',
          marginBottom: '16px',
          maxWidth: '800px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: '#e94560' }}>Error:</strong>
            {elapsedTime !== null && (
              <span style={{
                backgroundColor: '#3a1a1a',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '13px',
                color: '#f87171'
              }}>
                {elapsedTime >= 1000
                  ? `${(elapsedTime / 1000).toFixed(2)}s`
                  : `${Math.round(elapsedTime)}ms`}
              </span>
            )}
          </div>
          <p style={{ margin: '8px 0 0 0' }}>{error}</p>
        </div>
      )}

      {response && (
        <div style={{
          padding: '16px',
          backgroundColor: '#16213e',
          border: '1px solid #0f3460',
          borderRadius: '8px',
          maxWidth: '800px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ color: '#4ade80' }}>Response:</strong>
            {elapsedTime !== null && (
              <span style={{
                backgroundColor: '#0f3460',
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '13px',
                color: '#60a5fa'
              }}>
                {elapsedTime >= 1000
                  ? `${(elapsedTime / 1000).toFixed(2)}s`
                  : `${Math.round(elapsedTime)}ms`}
              </span>
            )}
          </div>
          <pre style={{
            margin: '12px 0 0 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: '14px',
            lineHeight: '1.6'
          }}>
            {response}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '32px' }}>
        <a
          href="/"
          style={{
            color: '#888',
            textDecoration: 'underline'
          }}
        >
          Back to Main App
        </a>
      </div>
    </div>
  );
}
