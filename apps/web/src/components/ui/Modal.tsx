// src/components/ui/Modal.tsx
import { type ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  footer?: ReactNode;
  preventClose?: boolean;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-7xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  showCloseButton = true,
  footer,
  preventClose = false,
}: ModalProps) {
  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preventClose) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, preventClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleBackdropClick = () => {
    if (!preventClose) {
      onClose();
    }
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleBackdropClick}
          />

          {/* Dialog */}
          <motion.div
            className={`relative w-full ${sizeClasses[size]} modal-dialog`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            {(title || subtitle || showCloseButton) && (
              <div className="modal-header">
                <div>
                  {title && <h2 className="modal-title">{title}</h2>}
                  {subtitle && <p className="modal-subtitle">{subtitle}</p>}
                </div>
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="modal-close"
                    aria-label="Close modal"
                    type="button"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            {/* Body */}
            <div className="modal-body">{children}</div>

            {/* Footer */}
            {footer && <div className="modal-actions">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // Render to portal
  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
