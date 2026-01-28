import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DanceChoreography from './DanceChoreography';
import TestingPage from './TestingPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DanceChoreography />} />
        <Route path="/testing" element={<TestingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
