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
            onClick={handleConfirm}
            disabled={isDeleting || isLoading}
            className="rounded-xl px-4 py-2 text-sm font-medium text-white transition
              bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
              dark:bg-red-700 dark:hover:bg-red-800"
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
        <div className="rounded-2xl bg-red-50 p-4 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
          <p className="text-sm font-medium text-red-900 dark:text-red-100">
            All your data will be permanently deleted:
          </p>
          <ul className="mt-2 text-sm text-red-800 dark:text-red-200 space-y-1">
            <li>• All rides and ride history</li>
            <li>• All bikes and gear</li>
            <li>• All component tracking data</li>
            <li>• Your account credentials</li>
          </ul>
        </div>
        {error && (
          <div className="rounded-2xl bg-red-50 p-4 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
            <p className="text-sm text-red-900 dark:text-red-100">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
