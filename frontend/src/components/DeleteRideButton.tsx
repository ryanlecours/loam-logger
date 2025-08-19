// src/components/DeleteRideButton.tsx
import { useMutation } from '@apollo/client';
import { DELETE_RIDE } from '../graphql/deleteRide';
import { RIDES } from '../graphql/rides';

export default function DeleteRideButton({ id }: { id: string }) {
  const [mutate, { loading }] = useMutation(DELETE_RIDE, {
    variables: { id },
    update(cache, { data }) {
      const deletedId = data?.deleteRide?.ok ? data.deleteRide.id : undefined;
      if (!deletedId) return;

      cache.updateQuery<{ rides: Array<{ id: string }> }>(
        { query: RIDES },
        (prev) => (prev ? { rides: prev.rides.filter((r) => r.id !== deletedId) } : prev)
      );

      // optional: also evict the normalized entity
      cache.evict({ id: cache.identify({ __typename: 'Ride', id: deletedId }) });
      cache.gc();
    },
  });

  async function onClick() {
    if (loading) return;
    if (!window.confirm('Delete this ride? This cannot be undone.')) return;
    await mutate().catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={loading ? 'Deleting…' : 'Delete ride'}
      className="inline-flex items-center p-1 rounded hover:bg-red-50 border border-transparent hover:border-red-200"
      aria-label="Delete ride"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
      </svg>
    </button>
  );
}
