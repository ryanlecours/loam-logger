import React, { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // body scroll lock
  useEffect(() => {
    document.body.classList.toggle("overflow-hidden", open);
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);

  // esc + focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();

      if (e.key === "Tab" && dialogRef.current) {
        const n = dialogRef.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (!n.length) return;
        const first = n[0],
          last = n[n.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    confirmButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

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

  if (!open) return null;

  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="delete-account-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-3xl bg-white p-6 text-neutral-900 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100"
      >
        {/* Header */}
        <h2 id="delete-account-title" className="text-xl font-semibold">
          Delete Account?
        </h2>

        {/* Content */}
        <div className="mt-4 space-y-4">
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

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            onClick={onClose}
            variant="secondary"
            disabled={isDeleting}
            children="Cancel"
            className="rounded-2xl text-sm"
          />
          <button
            ref={confirmButtonRef}
            onClick={handleConfirm}
            disabled={isDeleting || isLoading}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-white transition
              bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
              dark:bg-red-700 dark:hover:bg-red-800"
          >
            {isDeleting || isLoading ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
