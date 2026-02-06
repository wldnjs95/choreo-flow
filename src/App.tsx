import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DanceChoreography from './DanceChoreography';
import TestingPage from './TestingPage';
import FormationCreator from './FormationCreator';
import SimulationPage from './SimulationPage';
import TimelineEditor from './TimelineEditor';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TimelineEditor />} />
        <Route path="/previous" element={<DanceChoreography />} />
        <Route path="/testing" element={<TestingPage />} />
        <Route path="/create_formation" element={<FormationCreator />} />
        <Route path="/simulation" element={<SimulationPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
