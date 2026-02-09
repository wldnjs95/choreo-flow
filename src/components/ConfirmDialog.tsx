/**
 * Confirm Dialog Component
 * Reusable confirmation modal for destructive actions
 */

import { useEffect } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  details,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
}: ConfirmDialogProps) {
  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="confirm-message">{message}</p>
        {details && <p className="confirm-details">{details}</p>}
        <div className="confirm-buttons">
          <button className="confirm-btn cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={`confirm-btn ${isDangerous ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
