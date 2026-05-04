import { useEffect, useId, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /** Body shown above the action buttons. Either a string or arbitrary node. */
  message: React.ReactNode;
  /**
   * If provided, the confirm button stays disabled until the user types this
   * value into the input. Used for high-risk actions like user deletion to
   * surface the destructive scope and prevent muscle-memory clicks.
   */
  confirmText?: string;
  /** Label on the destructive button; defaults to "Delete". */
  confirmLabel?: string;
  /** Label on the dismiss button; defaults to "Cancel". */
  cancelLabel?: string;
  /** Tone of the action button; defaults to 'danger'. */
  tone?: 'danger' | 'warning';
  loading?: boolean;
};

/**
 * Reusable confirmation modal for destructive admin actions. Replaces the
 * scattered `if (!confirm(...)) return` calls that the old Admin.tsx used
 * everywhere — those were native browser dialogs (white background, OS-styled,
 * trivially click-through-able) and gave no chance to require typed
 * confirmation for high-blast-radius operations.
 */
export function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading,
}: Props) {
  const [typed, setTyped] = useState('');
  // Use React's per-instance id generator so two ConfirmDeleteModal
  // instances mounted at the same time (e.g. UsersSection renders one for
  // demote + one for delete; only one is open in current UI but the
  // markup of both can coexist briefly during open/close transitions)
  // don't produce duplicate `id="confirm-delete-input"` in the DOM. The
  // <label htmlFor> below uses the same id, so screen readers still get
  // the right input/label association per modal instance.
  const inputId = useId();

  // Reset the typed-confirm field whenever the modal closes so a re-open of
  // a different target doesn't inherit the previous typed value.
  useEffect(() => {
    if (!isOpen) setTyped('');
  }, [isOpen]);

  const requiresType = !!confirmText;
  const matched = !requiresType || typed === confirmText;
  const disabled = loading || !matched;

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => undefined : onClose}
      title={title}
      size="sm"
      preventClose={loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={disabled}
            className={[
              tone === 'danger' ? 'btn-danger' : 'btn-warning',
              'disabled:opacity-50',
            ].join(' ')}
          >
            {loading ? `${confirmLabel}…` : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-white/80">{message}</div>

        {requiresType && (
          <div>
            <label className="label-form" htmlFor={inputId}>
              Type <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded font-mono">{confirmText}</code> to confirm
            </label>
            <input
              id={inputId}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="input-soft"
              placeholder={confirmText}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
