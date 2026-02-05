import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { getSlotKey } from '@loam/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SWAP_COMPONENTS, GEAR_QUERY_LIGHT } from '../../graphql/gear';
import { formatComponentLabel, getBikeName } from '../../utils/formatters';

interface SwapComponentModalProps {
  isOpen: boolean;
  onClose: () => void;
  bikeId: string;
  bikeName: string;
  component: {
    id: string;
    type: string;
    location?: string | null;
    brand: string;
    model: string;
    hoursUsed?: number | null;
  };
  otherBikes: Array<{
    id: string;
    nickname?: string | null;
    manufacturer: string;
    model: string;
    components: Array<{
      id: string;
      type: string;
      location?: string | null;
      brand: string;
      model: string;
      hoursUsed?: number | null;
      isStock: boolean;
    }>;
  }>;
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '0h';
  return `${Math.max(0, hours).toFixed(1)}h`;
}

export function SwapComponentModal({
  isOpen,
  onClose,
  bikeId,
  bikeName,
  component,
  otherBikes,
}: SwapComponentModalProps) {
  const [swappingTargetId, setSwappingTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [swapComponents] = useMutation(SWAP_COMPONENTS, {
    refetchQueries: [{ query: GEAR_QUERY_LIGHT }],
  });

  const sourceLabel = formatComponentLabel({
    componentType: component.type,
    location: component.location,
  });

  // Collect matching components from other bikes (same type)
  const matchingEntries: Array<{
    bike: SwapComponentModalProps['otherBikes'][number];
    comp: SwapComponentModalProps['otherBikes'][number]['components'][number];
  }> = [];

  for (const bike of otherBikes) {
    for (const comp of bike.components) {
      if (comp.type === component.type) {
        matchingEntries.push({ bike, comp });
      }
    }
  }

  async function handleSwap(
    targetBike: SwapComponentModalProps['otherBikes'][number],
    targetComponent: SwapComponentModalProps['otherBikes'][number]['components'][number],
  ) {
    setError(null);
    setSwappingTargetId(targetComponent.id);

    const slotKeyA = getSlotKey(component.type, component.location ?? 'NONE');
    const slotKeyB = getSlotKey(targetComponent.type, targetComponent.location ?? 'NONE');

    try {
      await swapComponents({
        variables: {
          input: {
            bikeIdA: bikeId,
            slotKeyA,
            bikeIdB: targetBike.id,
            slotKeyB,
          },
        },
      });
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to swap components. Please try again.';
      setError(message);
    } finally {
      setSwappingTargetId(null);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Swap ${sourceLabel} between bikes`}
      subtitle={`Currently on ${bikeName}: ${component.brand} ${component.model}`}
      size="md"
    >
      {/* Compatibility warning */}
      <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-300">
          Compatibility is not validated. Ensure both components fit their destination bikes.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-600/40 bg-red-950/30 px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Matching components list */}
      {matchingEntries.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-muted">
            No other bikes have a {sourceLabel.toLowerCase()} installed.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {matchingEntries.map(({ bike, comp }) => {
            const targetBikeName = getBikeName(bike);
            const isSwapping = swappingTargetId === comp.id;

            return (
              <div
                key={comp.id}
                className="flex items-center justify-between rounded-lg border border-app bg-surface-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-app">
                    {targetBikeName}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {comp.brand} {comp.model}
                    <span className="ml-2 opacity-60">
                      {formatHours(comp.hoursUsed)} used
                    </span>
                  </p>
                </div>

                <div className="ml-4 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={swappingTargetId !== null}
                    onClick={() => handleSwap(bike, comp)}
                  >
                    {isSwapping ? 'Swapping...' : 'Swap'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
