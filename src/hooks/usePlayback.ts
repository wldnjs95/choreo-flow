/**
 * usePlayback Hook
 * Manages playback state, metronome, and animation loop
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { COUNTS_PER_SECOND } from '../constants/editor';

interface UsePlaybackOptions {
  maxCount: number;
  onPlaybackEnd?: () => void;
}

interface UsePlaybackReturn {
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentCount: number;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  playbackSpeed: number;
  setPlaybackSpeed: React.Dispatch<React.SetStateAction<number>>;
  metronomeEnabled: boolean;
  setMetronomeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  togglePlayback: () => void;
}

export function usePlayback(options: UsePlaybackOptions): UsePlaybackReturn {
  const { maxCount, onPlaybackEnd } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentCount, setCurrentCount] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);

  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastBeatRef = useRef<number>(-1);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Play metronome click sound
  const playMetronomeClick = useCallback((isDownbeat: boolean = false) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = isDownbeat ? 1000 : 800;
    oscillator.type = 'sine';

    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    oscillator.start(now);
    oscillator.stop(now + 0.05);
  }, []);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      lastBeatRef.current = -1;
      return;
    }

    let currentCountValue = currentCount;

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      const next = currentCountValue + delta * COUNTS_PER_SECOND * playbackSpeed;

      if (metronomeEnabled) {
        const currentBeat = Math.floor(next);
        if (currentBeat !== lastBeatRef.current && currentBeat >= 0) {
          lastBeatRef.current = currentBeat;
          const isDownbeat = currentBeat % 4 === 0;
          playMetronomeClick(isDownbeat);
        }
      }

      if (next >= maxCount) {
        setIsPlaying(false);
        setCurrentCount(0);
        onPlaybackEnd?.();
        return;
      }

      currentCountValue = next;
      setCurrentCount(next);

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    lastBeatRef.current = Math.floor(currentCount);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, maxCount, metronomeEnabled, playMetronomeClick, currentCount, onPlaybackEnd]);

  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    currentCount,
    setCurrentCount,
    playbackSpeed,
    setPlaybackSpeed,
    metronomeEnabled,
    setMetronomeEnabled,
    togglePlayback,
  };
}
