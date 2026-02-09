import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DanceChoreography from './DanceChoreography';
import TestingPage from './TestingPage';
import FormationCreator from './FormationCreator';
import SimulationPage from './SimulationPage';
import TimelineEditor from './TimelineEditor';

const ACCESS_CODE = '0323';

function PasswordGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('dance-app-auth') === 'true';
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ACCESS_CODE) {
      sessionStorage.setItem('dance-app-auth', 'true');
      setIsAuthenticated(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="password-gate">
      <div className="password-modal">
        <h2>Dance Choreography Editor</h2>
        <p>Enter access code to continue</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Access Code"
            autoFocus
            className={error ? 'error' : ''}
          />
          <button type="submit">Enter</button>
        </form>
        {error && <span className="error-msg">Incorrect code</span>}
      </div>
    </div>
  );
}

function App() {
  return (
    <PasswordGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TimelineEditor />} />
          <Route path="/previous" element={<DanceChoreography />} />
          <Route path="/testing" element={<TestingPage />} />
          <Route path="/create_formation" element={<FormationCreator />} />
          <Route path="/simulation" element={<SimulationPage />} />
        </Routes>
      </BrowserRouter>
    </PasswordGate>
  );
}

export default App;
