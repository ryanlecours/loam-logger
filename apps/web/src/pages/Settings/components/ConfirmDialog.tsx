import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../../../components/ui/Modal';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<unknown>;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: Props) {
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Focus Cancel on open — safer default for destructive dialogs.
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Caller owns error surfacing (toast). Keep the dialog open on failure.
    } finally {
      setLoading(false);
    }
  };

  const confirmClass = variant === 'danger' ? 'btn-danger' : 'btn-primary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => {} : onClose}
      title={title}
      size="sm"
      showCloseButton={!loading}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={`${confirmClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {description && <div className="text-sm text-muted">{description}</div>}
    </Modal>
  );
}
