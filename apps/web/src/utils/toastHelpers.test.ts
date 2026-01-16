import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { showBikeCreatedToast } from './toastHelpers';

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

describe('toastHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('showBikeCreatedToast', () => {
    it('shows success toast with correct message', () => {
      const navigate = vi.fn();
      showBikeCreatedToast('bike-123', navigate);

      expect(toast.success).toHaveBeenCalledWith(
        "Bike added — you're good to ride.",
        expect.objectContaining({
          description: 'Components have been automatically configured.',
          duration: 5000,
        })
      );
    });

    it('includes action with correct label', () => {
      const navigate = vi.fn();
      showBikeCreatedToast('bike-123', navigate);

      expect(toast.success).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: expect.objectContaining({
            label: 'Review components',
          }),
        })
      );
    });

    it('navigates to bike page when action is clicked', () => {
      const navigate = vi.fn();
      showBikeCreatedToast('bike-123', navigate);

      // Get the action callback from the toast call
      const toastCall = vi.mocked(toast.success).mock.calls[0];
      const options = toastCall[1] as unknown as { action: { onClick: () => void } };

      // Call the action onClick
      options.action.onClick();

      expect(navigate).toHaveBeenCalledWith('/gear/bike-123');
    });

    it('uses correct bike ID in navigation path', () => {
      const navigate = vi.fn();
      showBikeCreatedToast('different-bike-id', navigate);

      const toastCall = vi.mocked(toast.success).mock.calls[0];
      const options = toastCall[1] as unknown as { action: { onClick: () => void } };

      options.action.onClick();

      expect(navigate).toHaveBeenCalledWith('/gear/different-bike-id');
    });

    it('sets 5 second duration', () => {
      const navigate = vi.fn();
      showBikeCreatedToast('bike-123', navigate);

      expect(toast.success).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          duration: 5000,
        })
      );
    });
  });
});
