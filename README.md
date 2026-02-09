# Dance Choreography Planner

A visual tool for planning and simulating dance choreography with automated path generation and collision avoidance.

## Features

- **Timeline-based Formation Editor**: Create and edit dance formations on a visual timeline
- **Multiple Path Algorithms**: 6 different pathfinding algorithms optimized for different choreography styles
- **Collision-Free Paths**: Automatic collision detection and avoidance
- **Gemini AI Integration**: AI-powered cue sheet generation and path evaluation
- **POV Mode**: View choreography from individual dancer perspectives
- **Rehearsal Mode**: Playback and practice mode with cue sheets

## Path Algorithms

Each algorithm is optimized for different choreography needs:

| Algorithm | Best For |
|-----------|----------|
| Natural Curves | Organic, flowing movements with S-curves |
| Clean Flow | Minimizing path crossings, simple formations |
| Wave Sync | Staggered timing (back-to-front waves) |
| Perfect Sync | Synchronized arrival timing |
| Balanced Direct | Even travel distances across dancers |
| Swap Safe | Dancer exchange formations (A↔B) |

## Getting Started

```bash
# Install dependencies
npm install

# Start development server (frontend + API)
npm run dev:all

# Build for production
npm run build
```

## Tech Stack

- React + TypeScript + Vite
- Hono (API server)
- Google Gemini API (AI features)

## AI Development Note

This project utilized various AI coding assistants to explore and optimize different pathfinding approaches. Each algorithm was developed iteratively with AI assistance to find optimal solutions for specific choreography scenarios.

## License

MIT
