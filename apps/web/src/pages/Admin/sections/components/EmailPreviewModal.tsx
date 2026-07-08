import { Modal } from '../../../../components/ui/Modal';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  preview: { subject: string; html: string } | null;
};

/**
 * Email preview modal. The previous implementation rendered the email HTML
 * directly in the modal body using `dangerouslySetInnerHTML` against a
 * forced white background — clashing with the rest of the dark-themed
 * admin UI AND letting the email's CSS bleed into the surrounding app.
 *
 * Two changes here:
 *   1. The modal *chrome* (header, padding, border) inherits the dark
 *      `<Modal>` styles like every other admin modal.
 *   2. The email body — which legitimately wants the white background of
 *      a real email-client render — is sandboxed inside a same-origin
 *      `<iframe srcDoc={...}>`. The iframe gives the rendered email its
 *      own document context, isolating its CSS in both directions and
 *      removing the ambient `dangerouslySetInnerHTML` injection surface.
 */
export function EmailPreviewModal({ isOpen, onClose, preview }: Props) {
  return (
    <Modal
      isOpen={isOpen && preview !== null}
      onClose={onClose}
      title="Email Preview"
      subtitle={preview?.subject}
      size="lg"
    >
      {preview && (
        <div className="border border-app rounded-xl overflow-hidden bg-white">
          <iframe
            title={`Preview of ${preview.subject}`}
            srcDoc={preview.html}
            sandbox=""
            className="block w-full"
            style={{ minHeight: 480, border: 0 }}
          />
        </div>
      )}
    </Modal>
  );
}
