import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { BikeForm } from '@/components/BikeForm';
import { BIKE_COMPONENT_SECTIONS, type BikeComponentSection, type BikeFormValues, type GearComponentState, type SpareFormState } from '@/models/BikeComponents';
import {
  ADD_BIKE,
  UPDATE_BIKE,
  GEAR_QUERY,
  ADD_COMPONENT,
  UPDATE_COMPONENT,
  DELETE_COMPONENT,
} from '@/graphql/gear';
import { SpareComponentForm } from '@/components/SpareComponentForm';



type ComponentDto = {
  id: string;
  type: string;
  brand: string;
  model: string;
  notes?: string | null;
  isStock: boolean;
  bikeId?: string | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type BikeDto = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  year?: number | null;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  notes?: string | null;
  components: ComponentDto[];
};

const defaultComponentState = (): GearComponentState => ({
  brand: '',
  model: '',
  notes: '',
  isStock: true,
});

const toComponentState = (
  bike: BikeDto | undefined,
  section: BikeComponentSection
): GearComponentState => {
  const match = bike?.components?.find((c) => c.type === section.type);
  if (!match) return defaultComponentState();
  return {
    brand: match.isStock ? '' : match.brand ?? '',
    model: match.isStock ? '' : match.model ?? '',
    notes: match.notes ?? '',
    isStock: match.isStock ?? false,
  };
};

const createBikeFormState = (bike?: BikeDto): BikeFormValues => ({
  nickname: bike?.nickname ?? '',
  manufacturer: bike?.manufacturer ?? '',
  model: bike?.model ?? '',
  year: bike?.year ? String(bike.year) : String(new Date().getFullYear()),
  travelForkMm: bike?.travelForkMm ? String(bike.travelForkMm) : '',
  travelShockMm: bike?.travelShockMm ? String(bike.travelShockMm) : '',
  notes: bike?.notes ?? '',
  components: BIKE_COMPONENT_SECTIONS.reduce(
    (acc, section) => ({ ...acc, [section.key]: toComponentState(bike, section) }),
    {} as BikeFormValues['components']
  ),
});

type ModalState =
  | { mode: 'create'; bike?: undefined }
  | { mode: 'edit'; bike: BikeDto };

type SpareModalState =
  | { mode: 'create'; component?: undefined }
  | { mode: 'edit'; component: ComponentDto };

export default function Gear() {
  const { data, loading, error } = useQuery<{ bikes: BikeDto[]; spareComponents: ComponentDto[] }>(
    GEAR_QUERY,
    { fetchPolicy: 'cache-and-network' }
  );

  const [addBikeMutation, addBikeState] = useMutation(ADD_BIKE, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });
  const [updateBikeMutation, updateBikeState] = useMutation(UPDATE_BIKE, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });
  const [addComponentMutation, addComponentState] = useMutation(ADD_COMPONENT, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });
  const [updateComponentMutation, updateComponentState] = useMutation(UPDATE_COMPONENT, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });
  const [deleteComponentMutation, deleteComponentState] = useMutation(DELETE_COMPONENT, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });

  const bikes = data?.bikes ?? [];
  const spareComponents = data?.spareComponents ?? [];

  const [bikeModal, setBikeModal] = useState<ModalState | null>(null);
  const [spareModal, setSpareModal] = useState<SpareModalState | null>(null);
  const [bikeFormError, setBikeFormError] = useState<string | null>(null);
  const [spareFormError, setSpareFormError] = useState<string | null>(null);

  const busyBike = addBikeState.loading || updateBikeState.loading;
  const busySpare = addComponentState.loading || updateComponentState.loading;

  const closeBikeModal = () => {
    setBikeModal(null);
    setBikeFormError(null);
  };
  const closeSpareModal = () => {
    setSpareModal(null);
    setSpareFormError(null);
  };

  const handleBikeSubmit = async (form: BikeFormValues, bikeId?: string) => {
    setBikeFormError(null);

    if (!form.manufacturer.trim()) {
      setBikeFormError('Manufacturer is required.');
      return;
    }
    if (!form.model.trim()) {
      setBikeFormError('Model is required.');
      return;
    }
    const yearValue = Number(form.year);
    if (Number.isNaN(yearValue)) {
      setBikeFormError('Please enter a valid year.');
      return;
    }

    for (const section of BIKE_COMPONENT_SECTIONS) {
      const component = form.components[section.key];
      if (!component.isStock && (!component.brand.trim() || !component.model.trim())) {
        setBikeFormError(`Enter a brand and model for the ${section.label} or mark it as stock.`);
        return;
      }
    }

    const componentInput = (component: GearComponentState) => ({
      brand: component.isStock ? undefined : component.brand || undefined,
      model: component.isStock ? undefined : component.model || undefined,
      notes: component.notes,
      isStock: component.isStock,
    });

    const payload = {
      nickname: form.nickname || undefined,
      manufacturer: form.manufacturer,
      model: form.model,
      year: yearValue,
      travelForkMm: form.travelForkMm ? Number(form.travelForkMm) : undefined,
      travelShockMm: form.travelShockMm ? Number(form.travelShockMm) : undefined,
      notes: form.notes,
      fork: componentInput(form.components.fork),
      shock: componentInput(form.components.shock),
      dropper: componentInput(form.components.dropper),
      wheels: componentInput(form.components.wheels),
      pivotBearings: componentInput(form.components.pivotBearings),
    };

    let failed = false;
    if (bikeId) {
      await updateBikeMutation({ variables: { id: bikeId, input: payload } }).catch((err) => {
        failed = true;
        setBikeFormError(err.message);
      });
    } else {
      await addBikeMutation({ variables: { input: payload } }).catch((err) => {
        failed = true;
        setBikeFormError(err.message);
      });
    }

    if (!failed) closeBikeModal();
  };

  const handleSpareSubmit = async (form: SpareFormState) => {
    setSpareFormError(null);

    if (!form.isStock && (!form.brand.trim() || !form.model.trim())) {
      setSpareFormError('Brand and model are required for non-stock spares.');
      return;
    }

    const hoursValue = form.hoursUsed.trim();
    const hoursUsed =
      hoursValue === '' ? 0 : Number(hoursValue);
    const serviceValue = form.serviceDueAtHours.trim();
    const serviceDue =
      serviceValue === '' ? null : Number(serviceValue);

    const base = {
      type: form.type,
      brand: form.isStock ? undefined : form.brand || undefined,
      model: form.isStock ? undefined : form.model || undefined,
      notes: form.notes,
      isStock: form.isStock,
      hoursUsed: Number.isNaN(hoursUsed) ? undefined : hoursUsed,
      serviceDueAtHours: Number.isNaN(serviceDue ?? 0) ? undefined : serviceDue,
    };

    let failed = false;
    if (form.id) {
      await updateComponentMutation({ variables: { id: form.id, input: base } }).catch((err) => {
        failed = true;
        setSpareFormError(err.message);
      });
    } else {
      await addComponentMutation({ variables: { input: base } }).catch((err) => {
        failed = true;
        setSpareFormError(err.message);
      });
    }

    if (!failed) closeSpareModal();
  };

  const currentBike = bikeModal?.mode === 'edit' ? bikeModal.bike : undefined;
  const currentSpare = spareModal?.mode === 'edit' ? spareModal.component : undefined;

  const initialSpareState: SpareFormState = useMemo(() => {
    if (!currentSpare) {
      return {
        type: 'FORK',
        brand: '',
        model: '',
        notes: '',
        isStock: true,
        hoursUsed: '',
        serviceDueAtHours: '',
      };
    }
    return {
      id: currentSpare.id,
      type: currentSpare.type as SpareFormState['type'],
      brand: currentSpare.isStock ? '' : currentSpare.brand ?? '',
      model: currentSpare.isStock ? '' : currentSpare.model ?? '',
      notes: currentSpare.notes ?? '',
      isStock: currentSpare.isStock,
      hoursUsed: currentSpare.hoursUsed != null ? String(currentSpare.hoursUsed) : '',
      serviceDueAtHours:
        currentSpare.serviceDueAtHours != null ? String(currentSpare.serviceDueAtHours) : '',
    };
  }, [currentSpare]);

  const handleDeleteSpare = async (id: string) => {
    const confirmed = window.confirm('Remove this spare component?');
    if (!confirmed) return;
    await deleteComponentMutation({ variables: { id } });
  };

  return (
    <div className="min-h-screen bg-app px-4 py-6">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted">Gear</p>
          <h1 className="text-3xl font-semibold">Tools to track every bolt and bearing</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { setBikeFormError(null); setBikeModal({ mode: 'create' }); }}>
            Add Bike
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSpareFormError(null);
              setSpareModal({ mode: 'create' });
            }}
          >
            Add Spare Component
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          Couldn&apos;t load your gear just yet. {error.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Your Bikes</h2>
            {!loading && bikes.length > 0 && (
              <span className="text-sm text-muted">{bikes.length} bikes</span>
            )}
          </div>
          {loading && (
            <div className="space-y-3">
              {[...Array(2)].map((_, idx) => (
                <div key={idx} className="h-36 animate-pulse rounded-2xl bg-surface-2" />
              ))}
            </div>
          )}
          {!loading && bikes.length === 0 && (
            <div className="bg-surface-2 border shadow-xl backdrop-blur-2xl border-dashed border-app/80 p-8 text-center">
              <p className="text-lg font-medium">No bikes on file yet</p>
              <p className="text-sm text-muted">
                Add your first bike to start tracking service intervals and upgrade paths.
              </p>
            </div>
          )}
          <div className="space-y-4">
            {bikes.map((bike) => (
              <motion.div
                key={bike.id}
                layout
                whileHover={{ y: -3 }}
                className="bg-surface-2 border shadow-xl backdrop-blur-2xl rounded-2xl px-5 py-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-wide text-muted">{bike.manufacturer}</p>
                    <h3 className="text-2xl font-semibold">
                      {bike.year ? `${bike.year} ` : ''}
                      {bike.model}
                    </h3>
                    {bike.nickname && (
                      <p className="text-sm text-muted">â€œ{bike.nickname}â€</p>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <div className="flex gap-3 text-sm text-muted">
                      {bike.travelForkMm ? <span>{bike.travelForkMm}mm front</span> : null}
                      {bike.travelShockMm ? <span>{bike.travelShockMm}mm rear</span> : null}
                    </div>
                    <Button
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        setBikeFormError(null);
                        setBikeModal({ mode: 'edit', bike });
                      }}
                    >
                      Edit Bike
                    </Button>
                  </div>
                </div>
                {bike.notes && (
                  <p className="mt-2 text-sm text-muted">
                    <span className="font-medium text-accent">Notes:</span> {bike.notes}
                  </p>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {BIKE_COMPONENT_SECTIONS.map((section) => {
                    const component = bike.components.find((c) => c.type === section.type);
                    return (
                      <div
                        key={section.key}
                        className="rounded-xl panel-soft px-4 py-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{section.label}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              component?.isStock
                                ? 'bg-primary/10 text-primary'
                                : 'bg-accent/10 text-accent'
                            }`}
                          >
                            {component?.isStock ? 'Stock' : 'Custom'}
                          </span>
                        </div>
                        <p className="text-sm text-muted">
                          {component?.isStock
                            ? 'OEM spec'
                            : `${component?.brand ?? '--'} ${component?.model ?? ''}`}
                        </p>
                        {component?.notes && (
                          <p className="mt-1 text-xs text-muted">{component.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="bg-surface-2 border shadow-xl backdrop-blur-2xl rounded-2xl lg:col-span-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Spare Components</h2>
            <span className="text-sm text-muted">{spareComponents.length}</span>
          </div>
          {loading && (
            <div className="space-y-3">
              {[...Array(2)].map((_, idx) => (
                <div key={idx} className="h-24 animate-pulse rounded-2xl bg-white/40" />
              ))}
            </div>
          )}
          {!loading && spareComponents.length === 0 && (
            <div className="rounded-xl panel-soft border border-dashed border-app/80 px-4 py-6 text-center text-sm text-muted">
              Track spare forks, shocks, wheels, or droppers so you always know what&apos;s on deck.
            </div>
          )}
          <div className="space-y-3">
            {spareComponents.map((component) => (
              <div key={component.id} className="bg-surface-2 border shadow-xl backdrop-blur-2xl px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">{component.type}</p>
                    <p className="text-base font-semibold">
                      {component.isStock ? 'Stock spec' : `${component.brand} ${component.model}`}
                    </p>
                    {component.notes && <p className="text-sm text-muted">{component.notes}</p>}
                    <p className="text-xs text-muted">
                      {component.hoursUsed ?? 0}h used
                      {component.serviceDueAtHours != null
                        ? ` Â· Service @ ${component.serviceDueAtHours}h`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      className="text-xs text-primary underline"
                      onClick={() => {
                        setSpareFormError(null);
                        setSpareModal({ mode: 'edit', component });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-xs text-red-500 underline"
                      onClick={() => handleDeleteSpare(component.id)}
                      disabled={deleteComponentState.loading}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Modal
        open={!!bikeModal}
        title={bikeModal?.mode === 'edit' ? 'Edit Bike' : 'Add Bike'}
        onClose={closeBikeModal}
      >
        {bikeModal && (
          <BikeForm
            mode={bikeModal.mode}
            initial={createBikeFormState(currentBike)}
            submitting={busyBike}
            error={bikeFormError}
            onSubmit={(form) => handleBikeSubmit(form, currentBike?.id)}
            onClose={closeBikeModal}
          />
        )}
      </Modal>

      <Modal
        open={!!spareModal}
        title={spareModal?.mode === 'edit' ? 'Edit Spare Component' : 'Add Spare Component'}
        onClose={closeSpareModal}
      >
        {spareModal && (
          <SpareComponentForm
            key={currentSpare?.id ?? 'new'}
            initial={initialSpareState}
            submitting={busySpare || deleteComponentState.loading}
            error={spareFormError}
            onSubmit={handleSpareSubmit}
            onClose={closeSpareModal}
          />
        )}
      </Modal>
    </div>
  );
}

type ModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
};

function Modal({ open, title, children, onClose }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl panel-soft modal-surface shadow-soft p-6 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-2xl font-semibold">{title}</h3>
          <button
            className="text-2xl text-muted transition hover:text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}



























