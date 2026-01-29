import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { FaBicycle } from 'react-icons/fa';
import { Modal } from '@/components/ui/Modal';
import { BikeForm } from '@/components/BikeForm';
import { showBikeCreatedToast } from '@/utils/toastHelpers';
import { BIKE_COMPONENT_SECTIONS, type BikeComponentSection, type BikeFormValues, type GearComponentState, type SpareFormState } from '@/models/BikeComponents';
import {
  ADD_BIKE,
  UPDATE_BIKE,
  DELETE_BIKE,
  GEAR_QUERY,
  ADD_COMPONENT,
  UPDATE_COMPONENT,
  DELETE_COMPONENT,
} from '@/graphql/gear';
import { SpareComponentForm } from '@/components/SpareComponentForm';
import { BikeOverviewCard, SpareComponentsPanel, GearPageHeader } from '@/components/gear';
import { LogServiceModal } from '@/components/dashboard';
import type { BikePredictionSummary } from '@/types/prediction';
import type { BikeWithPredictions } from '@/hooks/usePriorityBike';

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
  location?: string | null;
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
  spokesId?: string | null;
  spokesUrl?: string | null;
  thumbnailUrl?: string | null;
  family?: string | null;
  category?: string | null;
  subcategory?: string | null;
  buildKind?: string | null;
  isFrameset?: boolean | null;
  isEbike?: boolean | null;
  gender?: string | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
  components: ComponentDto[];
  predictions?: BikePredictionSummary | null;
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
    brand: match.brand ?? '',
    model: match.model ?? '',
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
  spokesId: bike?.spokesId ?? null,
  spokesUrl: bike?.spokesUrl ?? null,
  thumbnailUrl: bike?.thumbnailUrl ?? null,
  family: bike?.family ?? null,
  category: bike?.category ?? null,
  subcategory: bike?.subcategory ?? null,
  buildKind: bike?.buildKind ?? null,
  isFrameset: bike?.isFrameset ?? false,
  isEbike: bike?.isEbike ?? false,
  gender: bike?.gender ?? null,
  frameMaterial: bike?.frameMaterial ?? null,
  hangerStandard: bike?.hangerStandard ?? null,
  motorMaker: bike?.motorMaker ?? null,
  motorModel: bike?.motorModel ?? null,
  motorPowerW: bike?.motorPowerW ?? null,
  motorTorqueNm: bike?.motorTorqueNm ?? null,
  batteryWh: bike?.batteryWh ?? null,
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
  const navigate = useNavigate();
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
  const [deleteBikeMutation, deleteBikeState] = useMutation(DELETE_BIKE, {
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
  const [serviceModalBike, setServiceModalBike] = useState<BikeDto | null>(null);

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
      spokesId: form.spokesId || undefined,
      spokesUrl: form.spokesUrl || undefined,
      thumbnailUrl: form.thumbnailUrl || undefined,
      family: form.family || undefined,
      category: form.category || undefined,
      subcategory: form.subcategory || undefined,
      buildKind: form.buildKind || undefined,
      isFrameset: form.isFrameset ?? false,
      isEbike: form.isEbike ?? false,
      gender: form.gender || undefined,
      frameMaterial: form.frameMaterial || undefined,
      hangerStandard: form.hangerStandard || undefined,
      motorMaker: form.motorMaker || undefined,
      motorModel: form.motorModel || undefined,
      motorPowerW: form.motorPowerW || undefined,
      motorTorqueNm: form.motorTorqueNm || undefined,
      batteryWh: form.batteryWh || undefined,
      spokesComponents: form.spokesComponents || undefined,
      fork: componentInput(form.components.fork),
      shock: componentInput(form.components.shock),
      seatpost: componentInput(form.components.seatpost),
      wheels: componentInput(form.components.wheels),
      pivotBearings: componentInput(form.components.pivotBearings),
    };

    let failed = false;
    let createdBikeId: string | null = null;

    if (bikeId) {
      await updateBikeMutation({ variables: { id: bikeId, input: payload } }).catch((err) => {
        failed = true;
        setBikeFormError(err.message);
      });
    } else {
      const result = await addBikeMutation({ variables: { input: payload } }).catch((err) => {
        failed = true;
        setBikeFormError(err.message);
        return null;
      });
      if (result?.data?.addBike?.id) {
        createdBikeId = result.data.addBike.id;
      }
    }

    if (!failed) {
      closeBikeModal();
      // Show success toast for newly created bikes
      if (createdBikeId) {
        showBikeCreatedToast(createdBikeId, navigate);
      }
    }
  };

  const handleSpareSubmit = async (form: SpareFormState) => {
    setSpareFormError(null);

    if (!form.isStock && (!form.brand.trim() || !form.model.trim())) {
      setSpareFormError('Brand and model are required for non-stock spares.');
      return;
    }

    const hoursValue = form.hoursUsed.trim();
    const hoursUsed = hoursValue === '' ? 0 : Number(hoursValue);
    const serviceValue = form.serviceDueAtHours.trim();
    const serviceDue = serviceValue === '' ? null : Number(serviceValue);

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

  const initialBikeState = useMemo(
    () => createBikeFormState(currentBike),
    [currentBike]
  );

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
      brand: currentSpare.brand ?? '',
      model: currentSpare.model ?? '',
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

  const handleDeleteBike = async (bike: BikeDto) => {
    const bikeName = bike.nickname || `${bike.year} ${bike.manufacturer} ${bike.model}`;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${bikeName}"? This will also remove all components associated with this bike. Rides logged to this bike will be preserved but no longer associated with it.`
    );
    if (!confirmed) return;
    await deleteBikeMutation({ variables: { id: bike.id } });
  };

  return (
    <div className="gear-page">
      {/* Header */}
      <GearPageHeader
        onAddBike={() => {
          setBikeFormError(null);
          setBikeModal({ mode: 'create' });
        }}
        onAddSpare={() => {
          setSpareFormError(null);
          setSpareModal({ mode: 'create' });
        }}
      />

      {/* Error Alert */}
      {error && (
        <div className="alert alert-danger mb-6">
          Couldn&apos;t load your gear just yet. {error.message}
        </div>
      )}

      {/* Two-column Layout */}
      <div className="gear-layout">
        {/* Main: Bikes Section */}
        <main className="gear-layout-main">
          <div className="bikes-section-header">
            <h2 className="bikes-section-title">Your Bikes</h2>
            {!loading && bikes.length > 0 && (
              <span className="bikes-section-count">{bikes.length} bikes</span>
            )}
          </div>

          {/* Loading State */}
          {loading && (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="bike-card-skeleton animate-pulse" style={{ height: '200px' }} />
              ))}
            </div>
          )}

          {/* Empty State */}
          {!loading && bikes.length === 0 && (
            <div className="bikes-empty">
              <FaBicycle size={48} className="bikes-empty-icon" />
              <h3 className="bikes-empty-title">No bikes on file yet</h3>
              <p className="bikes-empty-text">
                Add your first bike to start tracking service intervals and upgrade paths.
              </p>
            </div>
          )}

          {/* Bike Cards */}
          {!loading && bikes.map((bike) => (
            <BikeOverviewCard
              key={bike.id}
              bike={bike}
              onEdit={() => {
                setBikeFormError(null);
                setBikeModal({ mode: 'edit', bike });
              }}
              onDelete={() => handleDeleteBike(bike)}
              onLogService={() => setServiceModalBike(bike)}
              isDeleting={deleteBikeState.loading}
            />
          ))}
        </main>

        {/* Sidebar: Spare Components */}
        <SpareComponentsPanel
          components={spareComponents}
          onEdit={(component) => {
            setSpareFormError(null);
            setSpareModal({ mode: 'edit', component });
          }}
          onDelete={handleDeleteSpare}
          onAdd={() => {
            setSpareFormError(null);
            setSpareModal({ mode: 'create' });
          }}
          loading={loading}
          deleting={deleteComponentState.loading}
        />
      </div>

      {/* Bike Form Modal */}
      <Modal
        isOpen={!!bikeModal}
        onClose={closeBikeModal}
        title={bikeModal?.mode === 'edit' ? 'Edit Bike' : 'Add Bike'}
        size="xl"
      >
        {bikeModal && (
          <BikeForm
            mode={bikeModal.mode}
            initial={initialBikeState}
            submitting={busyBike}
            error={bikeFormError}
            onSubmit={(form) => handleBikeSubmit(form, currentBike?.id)}
            onClose={closeBikeModal}
          />
        )}
      </Modal>

      {/* Spare Component Form Modal */}
      <Modal
        isOpen={!!spareModal}
        onClose={closeSpareModal}
        title={spareModal?.mode === 'edit' ? 'Edit Spare Component' : 'Add Spare Component'}
        size="md"
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

      {/* Log Service Modal */}
      <LogServiceModal
        isOpen={!!serviceModalBike}
        onClose={() => setServiceModalBike(null)}
        bike={serviceModalBike as BikeWithPredictions | null}
        defaultComponentId={serviceModalBike?.predictions?.priorityComponent?.componentId}
      />
    </div>
  );
}
