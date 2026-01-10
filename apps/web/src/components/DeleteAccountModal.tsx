import { useState } from "react";
import { Modal, Button } from "./ui";

type DeleteAccountModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
};

export default function DeleteAccountModal({
  open,
  onClose,
  onConfirm,
  isLoading = false,
}: DeleteAccountModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while deleting your account");
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Delete Account?"
      size="sm"
      preventClose={isDeleting}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting || isLoading}
            className="btn-danger"
          >
            {isDeleting || isLoading ? "Deleting..." : "Delete Account"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm opacity-90 leading-6">
          Are you sure you want to delete your account? This action cannot be undone.
        </p>
        <div className="alert-danger-dark">
          <p className="text-sm font-medium">
            All your data will be permanently deleted:
          </p>
          <ul className="mt-2 text-sm opacity-90 space-y-1">
            <li>• All rides and ride history</li>
            <li>• All bikes and gear</li>
            <li>• All component tracking data</li>
            <li>• Your account credentials</li>
          </ul>
        </div>
        {error && (
          <div className="alert-danger-dark">
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
