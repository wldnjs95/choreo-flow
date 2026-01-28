import { useState } from 'react';
import { callGeminiAPI } from './gemini/config';

export default function TestingPage() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    setResponse('');

    try {
      const result = await callGeminiAPI(prompt);
      setResponse(result);
    } catch (err) {
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
      <h1 style={{ marginBottom: '8px' }}>Gemini API Test</h1>
      <p style={{ color: '#888', marginBottom: '24px' }}>
        Model: gemini-3-pro-preview
      </p>

      <div style={{ marginBottom: '16px' }}>
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
          <strong style={{ color: '#e94560' }}>Error:</strong>
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
          <strong style={{ color: '#4ade80' }}>Response:</strong>
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
