/**
 * Settings Modal Component
 *
 * Project-level settings including dancer count, stage configuration, and dancer names.
 * Changes are only applied when user clicks Save.
 */

import { useState, useEffect } from 'react';
import { CustomSelect } from './CustomSelect';

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
  onDeleteSpecificDancer?: (dancerId: number) => void;
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
  onDeleteSpecificDancer,
  stageWidth,
  stageHeight,
  onUpdateStageSize,
  audienceAtTop,
  onUpdateAudienceDirection,
}: SettingsModalProps) {
  // Local state for all settings (only applied on Save)
  const [localDancerCountStr, setLocalDancerCountStr] = useState(String(dancerCount));
  const [localDancerNames, setLocalDancerNames] = useState<Record<number, string>>({});
  const [localStageWidth, setLocalStageWidth] = useState(stageWidth);
  const [localStageHeight, setLocalStageHeight] = useState(stageHeight);
  const [localAudienceAtTop, setLocalAudienceAtTop] = useState(audienceAtTop);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [dancersToDelete, setDancersToDelete] = useState<Set<number>>(new Set());

  // Parse the string to number for comparison/calculation
  const localDancerCountNum = parseInt(localDancerCountStr, 10);
  const isValidCount = !isNaN(localDancerCountNum) && localDancerCountNum >= 1 && localDancerCountNum <= 35;

  // Check if current size matches a preset
  const getMatchingPreset = (w: number, h: number) => {
    return STAGE_PRESETS.find(p => p.width === w && p.height === h);
  };

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalDancerCountStr(String(dancerCount));
      setLocalDancerNames({ ...dancerNames });
      setLocalStageWidth(stageWidth);
      setLocalStageHeight(stageHeight);
      setLocalAudienceAtTop(audienceAtTop);
      setDancersToDelete(new Set());
      const matching = getMatchingPreset(stageWidth, stageHeight);
      setIsCustomSize(!matching || matching.label === 'Custom');
    }
  }, [isOpen, dancerCount, dancerNames, stageWidth, stageHeight, audienceAtTop]);

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

  if (!isOpen) return null;

  const handleDancerCountChange = (delta: number) => {
    const current = isNaN(localDancerCountNum) ? dancerCount : localDancerCountNum;
    const newCount = Math.max(1, Math.min(35, current + delta));
    setLocalDancerCountStr(String(newCount));
  };

  const handleLocalDancerNameChange = (dancerId: number, name: string) => {
    setLocalDancerNames(prev => ({ ...prev, [dancerId]: name }));
  };

  const handleStagePresetChange = (value: string) => {
    if (value === 'custom') {
      setIsCustomSize(true);
    } else {
      setIsCustomSize(false);
      const [w, h] = value.split('x').map(Number);
      setLocalStageWidth(w);
      setLocalStageHeight(h);
    }
  };

  // Check if there are changes
  const hasChanges = () => {
    if (localDancerCountNum !== dancerCount) return true;
    if (localStageWidth !== stageWidth || localStageHeight !== stageHeight) return true;
    if (localAudienceAtTop !== audienceAtTop) return true;
    if (dancersToDelete.size > 0) return true;
    // Check dancer names
    for (let i = 1; i <= dancerCount; i++) {
      if ((localDancerNames[i] || '') !== (dancerNames[i] || '')) return true;
    }
    return false;
  };

  // Mark a specific dancer for deletion
  const handleMarkForDeletion = (dancerId: number) => {
    setDancersToDelete(prev => {
      const next = new Set(prev);
      if (next.has(dancerId)) {
        next.delete(dancerId);
      } else {
        next.add(dancerId);
      }
      return next;
    });
  };

  // Get effective dancer list (excluding marked for deletion)
  const effectiveDancerCount = (isValidCount ? localDancerCountNum : dancerCount) - dancersToDelete.size;

  // Save all changes
  const handleSave = () => {
    // Delete specific dancers first (before count changes)
    if (dancersToDelete.size > 0 && onDeleteSpecificDancer) {
      // Delete in reverse order to maintain correct indices
      const sortedDeletions = Array.from(dancersToDelete).sort((a, b) => b - a);
      for (const dancerId of sortedDeletions) {
        onDeleteSpecificDancer(dancerId);
      }
    }

    // Apply dancer count change (only if no specific deletions)
    if (dancersToDelete.size === 0 && isValidCount && localDancerCountNum !== dancerCount) {
      onUpdateDancerCount(localDancerCountNum);
    }

    // Apply stage size change
    if (localStageWidth !== stageWidth || localStageHeight !== stageHeight) {
      const w = Math.max(4, Math.min(50, localStageWidth));
      const h = Math.max(4, Math.min(50, localStageHeight));
      onUpdateStageSize(w, h);
    }

    // Apply audience direction change
    if (localAudienceAtTop !== audienceAtTop) {
      onUpdateAudienceDirection(localAudienceAtTop);
    }

    // Apply dancer name changes (skip deleted dancers)
    const countToUse = isValidCount ? localDancerCountNum : dancerCount;
    for (let i = 1; i <= countToUse; i++) {
      if (dancersToDelete.has(i)) continue;
      const localName = localDancerNames[i] || '';
      const currentName = dancerNames[i] || '';
      if (localName !== currentName) {
        onUpdateDancerName(i, localName);
      }
    }

    onClose();
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
              <CustomSelect
                className="settings-select"
                value={isCustomSize ? 'custom' : `${localStageWidth}x${localStageHeight}`}
                onChange={handleStagePresetChange}
                options={[
                  ...STAGE_PRESETS.filter(p => p.label !== 'Custom').map(preset => ({
                    value: `${preset.width}x${preset.height}`,
                    label: preset.label
                  })),
                  { value: 'custom', label: 'Custom' }
                ]}
              />
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
                      value={localStageWidth}
                      onChange={(e) => setLocalStageWidth(Number(e.target.value))}
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
                      value={localStageHeight}
                      onChange={(e) => setLocalStageHeight(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="settings-row">
              <label>Audience Direction</label>
              <div className="settings-toggle-group">
                <button
                  className={`settings-toggle-btn ${localAudienceAtTop ? 'active' : ''}`}
                  onClick={() => setLocalAudienceAtTop(true)}
                >
                  ⬆ Top
                </button>
                <button
                  className={`settings-toggle-btn ${!localAudienceAtTop ? 'active' : ''}`}
                  onClick={() => setLocalAudienceAtTop(false)}
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
              </div>
            </div>
          </div>

          {/* Dancer Names Section */}
          <div className="settings-section">
            <h3>
              Dancer Names
              {dancersToDelete.size > 0 && (
                <span className="delete-hint"> ({dancersToDelete.size} to delete)</span>
              )}
              {swapSourceDancerId && (
                <span className="swap-hint"> (Swap mode: #{swapSourceDancerId})</span>
              )}
            </h3>
            {effectiveDancerCount < 1 && (
              <p className="settings-warning">At least 1 dancer required</p>
            )}
            <div className="settings-dancer-names-grid">
              {Array.from({ length: isValidCount ? localDancerCountNum : dancerCount }, (_, i) => i + 1).map(dancerId => {
                const isMarkedForDeletion = dancersToDelete.has(dancerId);
                return (
                  <div
                    key={dancerId}
                    className={`dancer-name-row ${swapSourceDancerId === dancerId ? 'swap-source' : ''} ${isMarkedForDeletion ? 'marked-for-deletion' : ''}`}
                  >
                    <span
                      className="dancer-id-badge"
                      style={{ backgroundColor: isMarkedForDeletion ? '#666' : (dancerColors[dancerId] || '#888') }}
                    >
                      {dancerId}
                    </span>
                    <input
                      type="text"
                      className="dancer-name-input"
                      placeholder={`Dancer ${dancerId}`}
                      value={localDancerNames[dancerId] || ''}
                      onChange={(e) => handleLocalDancerNameChange(dancerId, e.target.value)}
                      disabled={isMarkedForDeletion}
                    />
                    {onDeleteSpecificDancer && (
                      <button
                        className={`dancer-delete-btn ${isMarkedForDeletion ? 'restore' : ''}`}
                        onClick={() => handleMarkForDeletion(dancerId)}
                        disabled={!isMarkedForDeletion && effectiveDancerCount <= 1}
                        title={isMarkedForDeletion ? 'Restore dancer' : 'Delete dancer'}
                      >
                        {isMarkedForDeletion ? '↩' : '×'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="settings-tip">
              Double-click dancers on stage to swap positions
            </p>
          </div>
        </div>

        {/* Footer with Save/Cancel buttons */}
        <div className="settings-modal-footer">
          <button className="settings-btn cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="settings-btn save"
            onClick={handleSave}
            disabled={!hasChanges() || !isValidCount}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
