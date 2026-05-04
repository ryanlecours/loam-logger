import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

// Bypass the Modal portal/animation in tests — we only care about the
// confirm-button gating logic, not the visual chrome.
vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        {title && <h2>{title}</h2>}
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

describe('ConfirmDeleteModal', () => {
  let onClose: () => void;
  let onConfirm: () => void;

  beforeEach(() => {
    onClose = vi.fn();
    onConfirm = vi.fn();
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDeleteModal
        isOpen={false}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete user"
        message="Are you sure?"
      />,
    );
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('renders title and message when open', () => {
    render(
      <ConfirmDeleteModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete user"
        message="Are you sure?"
      />,
    );
    expect(screen.getByText('Delete user')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('confirm button is enabled when no typed-confirm is required', () => {
    render(
      <ConfirmDeleteModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete"
        message="msg"
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables the confirm button until the typed value matches', () => {
    // High-blast-radius actions (user delete) require typing the email so a
    // misclicked row doesn't escalate into a permanent delete. Pin that the
    // button stays inert until the strings match exactly — case-sensitive.
    render(
      <ConfirmDeleteModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete user"
        message="msg"
        confirmText="user@example.com"
        confirmLabel="Delete user"
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Delete user' });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('user@example.com');
    fireEvent.change(input, { target: { value: 'user@example.co' } }); // typo
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'user@example.com' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('keeps the confirm button disabled while loading even after a match', () => {
    render(
      <ConfirmDeleteModal
        isOpen
        loading
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete user"
        message="msg"
        confirmText="abc"
        confirmLabel="Delete"
      />,
    );

    const input = screen.getByPlaceholderText('abc');
    fireEvent.change(input, { target: { value: 'abc' } });

    // Confirm button shows the trailing-ellipsis loading label — the
    // pre-loading "Delete" text is no longer present.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete…/ })).toBeDisabled();
  });

  it('cancel button calls onClose', () => {
    render(
      <ConfirmDeleteModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete"
        message="msg"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
