import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { ADD_BIKE, BIKES } from '../graphql/bikes';

export default function AddBikeModal({ onClose }: { onClose: () => void }) {
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [nickname, setNickname] = useState('');

  const [mutate, { loading, error }] = useMutation(ADD_BIKE, {
    update(cache, { data }) {
      const newBike = data?.addBike;
      if (!newBike) return;
      cache.updateQuery<{ bikes: any[] }>({ query: BIKES }, prev =>
        prev ? { bikes: [newBike, ...prev.bikes] } : prev
      );
    },
    onCompleted: onClose,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await mutate({
      variables: {
        input: {
          manufacturer: manufacturer.trim(),
          model: model.trim(),
          nickname: nickname.trim() || null,
        },
      },
    }).catch(() => {});
  }

  const inputCls =
    'w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]';
  const labelCls = 'block text-sm text-muted';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form onSubmit={onSubmit} className="bg-surface border border-app rounded-xl shadow p-6 w-full max-w-md space-y-4">
        <h3 className="text-heading text-lg">Add a Bike</h3>

        <div className="space-y-1">
          <label className={labelCls}>Manufacturer</label>
          <input className={inputCls} value={manufacturer} onChange={e => setManufacturer(e.target.value)} required />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Model</label>
          <input className={inputCls} value={model} onChange={e => setModel(e.target.value)} required />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Nickname (optional)</label>
          <input className={inputCls} value={nickname} onChange={e => setNickname(e.target.value)} />
        </div>

        {error && <div style={{ color: 'rgb(var(--danger))' }} className="text-sm">{error.message}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Adding…' : 'Add Bike'}
          </button>
        </div>
      </form>
    </div>
  );
}
