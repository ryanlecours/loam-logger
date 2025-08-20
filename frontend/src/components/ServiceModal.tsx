// src/components/ServiceModal.tsx
import { useMutation } from '@apollo/client';
import { MARK_BIKE_PIVOT_SERVICED, MARK_COMPONENT_SERVICED } from '../graphql/components';
import { BIKES } from '../graphql/bikes';

type ComponentType = 'FORK' | 'SHOCK' | 'WHEELSET' | 'DROPPERPOST';

export default function ServiceModal({
  onClose,
  bikeId,
  pivot,                    // if true, service pivot bearings
  component,                // else, service a specific component
}: {
  onClose: () => void;
  bikeId: string;
  pivot?: { currentHours: number };
  component?: {
    id: string;
    type: ComponentType;
    manufacturer: string;
    model: string;
    year?: number | null;
    hoursSinceService: number;
  };
}) {
  const [servicePivot, { loading: loadingPivot, error: errorPivot }] = useMutation(MARK_BIKE_PIVOT_SERVICED, {
    refetchQueries: [{ query: BIKES }],
    onCompleted: onClose,
  });

  const [serviceComponent, { loading: loadingComp, error: errorComp }] = useMutation(MARK_COMPONENT_SERVICED, {
    refetchQueries: [{ query: BIKES }],
    onCompleted: onClose,
  });

  const inputCls =
    'w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]';

  const doService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pivot) {
      await servicePivot({ variables: { bikeId } }).catch(() => {});
    } else if (component) {
      await serviceComponent({ variables: { componentId: component.id } }).catch(() => {});
    }
  };

  const loading = loadingPivot || loadingComp;
  const error = errorPivot ?? errorComp;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form onSubmit={doService} className="w-full max-w-md bg-surface border border-app rounded-xl shadow p-6 space-y-4">
        <h3 className="text-heading text-lg">
          {pivot ? 'Service Pivot Bearings' : `Service ${component?.type}`}
        </h3>

        {pivot ? (
          <div className="text-sm">
            Current hours: <b>{pivot.currentHours.toFixed(1)} h</b>
          </div>
        ) : (
          <div className="text-sm space-y-1">
            <div>
              <b>{component?.manufacturer} {component?.model}</b>
              {component?.year ? ` (${component.year})` : ''}
            </div>
            <div>Current hours: <b>{component?.hoursSinceService.toFixed(1)} h</b></div>
          </div>
        )}

        <div className="text-xs text-muted">
          This will reset hours since last service to <b>0</b> and set the serviced date to now.
        </div>

        {error && <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>{error.message}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Servicing…' : 'Mark Serviced'}
          </button>
        </div>
      </form>
    </div>
  );
}
