import { toast } from 'sonner';

/**
 * Shows a success toast after bike creation with optional "Review components" action.
 */
export function showBikeCreatedToast(bikeId: string, navigate: (path: string) => void) {
  toast.success("Bike added — you're good to ride.", {
    description: 'Components have been automatically configured.',
    action: {
      label: 'Review components',
      onClick: () => {
        navigate(`/bike/${bikeId}`);
      },
    },
    duration: 5000,
  });
}
