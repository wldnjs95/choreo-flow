/**
 * Cue Sheet Modal Component
 *
 * Displays generated cue sheets for dancers in a modal dialog
 */

import { useState, useEffect } from 'react';
import type { CueSheetResult, DancerCueSheet } from '../gemini/cueSheetGenerator';

interface CueSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  cueSheet: CueSheetResult | null;
  isLoading: boolean;
  error: string | null;
  onGenerate: () => void;
  language: 'ko' | 'en';
  onLanguageChange: (lang: 'ko' | 'en') => void;
}

export function CueSheetModal({
  isOpen,
  onClose,
  cueSheet,
  isLoading,
  error,
  onGenerate,
  language,
  onLanguageChange,
}: CueSheetModalProps) {
  const [selectedDancer, setSelectedDancer] = useState<number | 'all'>('all');
  const [expandedDancers, setExpandedDancers] = useState<Set<number>>(new Set());

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

  const toggleDancerExpanded = (dancerId: number) => {
    setExpandedDancers(prev => {
      const next = new Set(prev);
      if (next.has(dancerId)) {
        next.delete(dancerId);
      } else {
        next.add(dancerId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (cueSheet) {
      setExpandedDancers(new Set(cueSheet.dancers.map(d => d.dancerId)));
    }
  };

  const collapseAll = () => {
    setExpandedDancers(new Set());
  };

  const copyToClipboard = (dancer: DancerCueSheet) => {
    const text = formatDancerCueSheetAsText(dancer, language);
    navigator.clipboard.writeText(text);
  };

  const copyAllToClipboard = () => {
    if (!cueSheet) return;
    const text = formatFullCueSheetAsText(cueSheet, language);
    navigator.clipboard.writeText(text);
  };

  const filteredDancers = cueSheet?.dancers.filter(d =>
    selectedDancer === 'all' || d.dancerId === selectedDancer
  ) || [];

  return (
    <div className="cue-sheet-modal-overlay" onClick={onClose}>
      <div className="cue-sheet-modal" onClick={e => e.stopPropagation()}>
        <div className="cue-sheet-modal-header">
          <h2>{language === 'ko' ? '큐시트' : 'Cue Sheet'}</h2>
          <div className="cue-sheet-header-controls">
            <select
              value={language}
              onChange={e => onLanguageChange(e.target.value as 'ko' | 'en')}
              className="language-select"
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="cue-sheet-modal-content">
          {!cueSheet && !isLoading && !error && (
            <div className="cue-sheet-empty-state">
              <div className="empty-icon">📋</div>
              <p>
                {language === 'ko'
                  ? '선택한 알고리즘의 경로 데이터를 기반으로 댄서들을 위한 큐시트를 생성합니다.'
                  : 'Generate cue sheets for dancers based on the selected algorithm\'s path data.'}
              </p>
              <button
                className="generate-button"
                onClick={onGenerate}
                disabled={isLoading}
              >
                {language === 'ko' ? '큐시트 생성하기' : 'Generate Cue Sheet'}
              </button>
            </div>
          )}

          {isLoading && (
            <div className="cue-sheet-loading">
              <div className="loading-spinner"></div>
              <p>{language === 'ko' ? 'Gemini가 큐시트를 작성 중입니다...' : 'Gemini is writing cue sheets...'}</p>
            </div>
          )}

          {error && (
            <div className="cue-sheet-error">
              <div className="error-icon">⚠️</div>
              <p>{error}</p>
              <button className="retry-button" onClick={onGenerate}>
                {language === 'ko' ? '다시 시도' : 'Retry'}
              </button>
            </div>
          )}

          {cueSheet && !isLoading && (
            <>
              <div className="cue-sheet-info">
                <div className="info-item">
                  <span className="info-label">{language === 'ko' ? '무대 크기' : 'Stage'}</span>
                  <span className="info-value">{cueSheet.stageInfo}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">{language === 'ko' ? '총 카운트' : 'Total Counts'}</span>
                  <span className="info-value">{cueSheet.totalCounts}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">{language === 'ko' ? '댄서 수' : 'Dancers'}</span>
                  <span className="info-value">{cueSheet.dancers.length}</span>
                </div>
              </div>

              {cueSheet.generalNotes && cueSheet.generalNotes.length > 0 && (
                <div className="general-notes">
                  <h4>{language === 'ko' ? '전체 주의사항' : 'General Notes'}</h4>
                  <ul>
                    {cueSheet.generalNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="cue-sheet-controls">
                <div className="dancer-filter">
                  <label>{language === 'ko' ? '댄서 선택' : 'Select Dancer'}</label>
                  <select
                    value={selectedDancer}
                    onChange={e => setSelectedDancer(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  >
                    <option value="all">{language === 'ko' ? '전체 보기' : 'View All'}</option>
                    {cueSheet.dancers.map(d => (
                      <option key={d.dancerId} value={d.dancerId}>
                        {d.dancerLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="expand-controls">
                  <button onClick={expandAll}>{language === 'ko' ? '모두 펼치기' : 'Expand All'}</button>
                  <button onClick={collapseAll}>{language === 'ko' ? '모두 접기' : 'Collapse All'}</button>
                  <button onClick={copyAllToClipboard}>{language === 'ko' ? '전체 복사' : 'Copy All'}</button>
                </div>
              </div>

              <div className="dancers-cue-list">
                {filteredDancers.map(dancer => (
                  <div key={dancer.dancerId} className="dancer-cue-card">
                    <div
                      className="dancer-cue-header"
                      onClick={() => toggleDancerExpanded(dancer.dancerId)}
                    >
                      <div className="dancer-label">
                        <span className="dancer-badge">{dancer.dancerLabel}</span>
                        <span className="dancer-summary">{dancer.summary}</span>
                      </div>
                      <div className="dancer-actions">
                        <button
                          className="copy-button"
                          onClick={e => {
                            e.stopPropagation();
                            copyToClipboard(dancer);
                          }}
                          title={language === 'ko' ? '복사' : 'Copy'}
                        >
                          📋
                        </button>
                        <span className="expand-icon">
                          {expandedDancers.has(dancer.dancerId) ? '▼' : '▶'}
                        </span>
                      </div>
                    </div>

                    {expandedDancers.has(dancer.dancerId) && (
                      <div className="dancer-cues">
                        {dancer.cues.map((cue, i) => (
                          <div key={i} className="cue-entry">
                            <div className="cue-time">{cue.timeRange}</div>
                            <div className="cue-content">
                              <div className="cue-instruction">{cue.instruction}</div>
                              {cue.notes && (
                                <div className="cue-notes">{cue.notes}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="cue-sheet-footer">
                <button className="regenerate-button" onClick={onGenerate} disabled={isLoading}>
                  {language === 'ko' ? '다시 생성' : 'Regenerate'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Helper Functions
// ============================================

function formatDancerCueSheetAsText(dancer: DancerCueSheet, _language: 'ko' | 'en'): string {
  const lines: string[] = [];
  lines.push(`[${dancer.dancerLabel}]`);
  lines.push(dancer.summary);
  lines.push('');

  for (const cue of dancer.cues) {
    lines.push(`(${cue.timeRange})`);
    lines.push(`  ${cue.instruction}`);
    if (cue.notes) {
      lines.push(`  → ${cue.notes}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatFullCueSheetAsText(cueSheet: CueSheetResult, language: 'ko' | 'en'): string {
  const lines: string[] = [];
  lines.push(`=== ${cueSheet.title || (language === 'ko' ? '큐시트' : 'Cue Sheet')} ===`);
  lines.push(`${language === 'ko' ? '무대' : 'Stage'}: ${cueSheet.stageInfo}`);
  lines.push(`${language === 'ko' ? '총 카운트' : 'Total Counts'}: ${cueSheet.totalCounts}`);
  lines.push('');

  if (cueSheet.generalNotes && cueSheet.generalNotes.length > 0) {
    lines.push(`[${language === 'ko' ? '전체 주의사항' : 'General Notes'}]`);
    for (const note of cueSheet.generalNotes) {
      lines.push(`• ${note}`);
    }
    lines.push('');
  }

  for (const dancer of cueSheet.dancers) {
    lines.push('─'.repeat(40));
    lines.push(formatDancerCueSheetAsText(dancer, language));
  }

  return lines.join('\n');
}

export default CueSheetModal;
