/**
 * Settings Modal Component
 *
 * Project-level settings including dancer count, stage configuration, and dancer names.
 */

import { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Dancer settings
  dancerCount: number;
  dancerNames: Record<number, string>;
  dancerColors: Record<number, string>;
  swapSourceDancerId: number | null;
  onUpdateDancerName: (dancerId: number, name: string) => void;
  onUpdateDancerCount: (count: number) => void;
  // Stage settings
  stageWidth: number;
  stageHeight: number;
  onUpdateStageSize: (width: number, height: number) => void;
  // Audience settings
  audienceAtTop: boolean;
  onUpdateAudienceDirection: (atTop: boolean) => void;
}

const STAGE_PRESETS = [
  { label: 'Small (8×6m)', width: 8, height: 6 },
  { label: 'Medium (10×8m)', width: 10, height: 8 },
  { label: 'Large (15×12m)', width: 15, height: 12 },
  { label: 'XLarge (20×15m)', width: 20, height: 15 },
  { label: 'Custom', width: 0, height: 0 },
];

export function SettingsModal({
  isOpen,
  onClose,
  dancerCount,
  dancerNames,
  dancerColors,
  swapSourceDancerId,
  onUpdateDancerName,
  onUpdateDancerCount,
  stageWidth,
  stageHeight,
  onUpdateStageSize,
  audienceAtTop,
  onUpdateAudienceDirection,
}: SettingsModalProps) {
  const [localDancerCountStr, setLocalDancerCountStr] = useState(String(dancerCount));
  const [customWidth, setCustomWidth] = useState(stageWidth);
  const [customHeight, setCustomHeight] = useState(stageHeight);
  const [isCustomSize, setIsCustomSize] = useState(false);

  // Parse the string to number for comparison/calculation
  const localDancerCountNum = parseInt(localDancerCountStr, 10);
  const isValidCount = !isNaN(localDancerCountNum) && localDancerCountNum >= 1 && localDancerCountNum <= 35;

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Check if current size matches a preset
  const matchingPreset = STAGE_PRESETS.find(
    p => p.width === stageWidth && p.height === stageHeight
  );

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalDancerCountStr(String(dancerCount));
      setCustomWidth(stageWidth);
      setCustomHeight(stageHeight);
      setIsCustomSize(!matchingPreset || matchingPreset.label === 'Custom');
    }
  }, [isOpen, dancerCount, stageWidth, stageHeight, matchingPreset]);

  if (!isOpen) return null;

  const handleDancerCountChange = (delta: number) => {
    const current = isNaN(localDancerCountNum) ? dancerCount : localDancerCountNum;
    const newCount = Math.max(1, Math.min(35, current + delta));
    setLocalDancerCountStr(String(newCount));
  };

  const applyDancerCount = () => {
    if (isValidCount && localDancerCountNum !== dancerCount) {
      onUpdateDancerCount(localDancerCountNum);
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Project Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="settings-modal-content">
          {/* Stage Configuration Section */}
          <div className="settings-section">
            <h3>Stage Configuration</h3>
            <div className="settings-row">
              <label>Stage Size</label>
              <select
                className="settings-select"
                value={isCustomSize ? 'custom' : `${stageWidth}x${stageHeight}`}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustomSize(true);
                  } else {
                    setIsCustomSize(false);
                    const [w, h] = e.target.value.split('x').map(Number);
                    setCustomWidth(w);
                    setCustomHeight(h);
                    onUpdateStageSize(w, h);
                  }
                }}
              >
                {STAGE_PRESETS.filter(p => p.label !== 'Custom').map(preset => (
                  <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </div>
            {isCustomSize && (
              <div className="settings-row custom-size-row">
                <label>Custom Size (meters)</label>
                <div className="custom-size-inputs">
                  <div className="size-input-group">
                    <span className="size-label">W</span>
                    <input
                      type="number"
                      className="size-input"
                      min={4}
                      max={50}
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Number(e.target.value))}
                    />
                  </div>
                  <span className="size-separator">×</span>
                  <div className="size-input-group">
                    <span className="size-label">H</span>
                    <input
                      type="number"
                      className="size-input"
                      min={4}
                      max={50}
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Number(e.target.value))}
                    />
                  </div>
                  {(customWidth !== stageWidth || customHeight !== stageHeight) && (
                    <button
                      className="count-apply-btn"
                      onClick={() => {
                        const w = Math.max(4, Math.min(50, customWidth));
                        const h = Math.max(4, Math.min(50, customHeight));
                        onUpdateStageSize(w, h);
                      }}
                    >
                      Apply
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="settings-row">
              <label>Audience Direction</label>
              <div className="settings-toggle-group">
                <button
                  className={`settings-toggle-btn ${audienceAtTop ? 'active' : ''}`}
                  onClick={() => onUpdateAudienceDirection(true)}
                >
                  ⬆ Top
                </button>
                <button
                  className={`settings-toggle-btn ${!audienceAtTop ? 'active' : ''}`}
                  onClick={() => onUpdateAudienceDirection(false)}
                >
                  ⬇ Bottom
                </button>
              </div>
            </div>
          </div>

          {/* Dancer Management Section */}
          <div className="settings-section">
            <h3>Dancer Management</h3>
            <div className="settings-row">
              <label>Number of Dancers</label>
              <div className="dancer-count-control">
                <button
                  className="count-btn"
                  onClick={() => handleDancerCountChange(-1)}
                  disabled={isValidCount && localDancerCountNum <= 1}
                >
                  −
                </button>
                <input
                  type="text"
                  className={`count-input ${!isValidCount && localDancerCountStr !== '' ? 'invalid' : ''}`}
                  value={localDancerCountStr}
                  onChange={(e) => setLocalDancerCountStr(e.target.value)}
                />
                <button
                  className="count-btn"
                  onClick={() => handleDancerCountChange(1)}
                  disabled={isValidCount && localDancerCountNum >= 35}
                >
                  +
                </button>
                {(localDancerCountStr !== String(dancerCount)) && (
                  <button
                    className="count-apply-btn"
                    onClick={applyDancerCount}
                    disabled={!isValidCount}
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Dancer Names Section */}
          <div className="settings-section">
            <h3>
              Dancer Names
              {swapSourceDancerId && (
                <span className="swap-hint"> (Swap mode: #{swapSourceDancerId})</span>
              )}
            </h3>
            <div className="settings-dancer-names-grid">
              {Array.from({ length: dancerCount }, (_, i) => i + 1).map(dancerId => (
                <div
                  key={dancerId}
                  className={`dancer-name-row ${swapSourceDancerId === dancerId ? 'swap-source' : ''}`}
                >
                  <span
                    className="dancer-id-badge"
                    style={{ backgroundColor: dancerColors[dancerId] || '#888' }}
                  >
                    {dancerId}
                  </span>
                  <input
                    type="text"
                    className="dancer-name-input"
                    placeholder={`Dancer ${dancerId}`}
                    value={dancerNames[dancerId] || ''}
                    onChange={(e) => onUpdateDancerName(dancerId, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <p className="settings-tip">
              Double-click dancers on stage to swap positions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
