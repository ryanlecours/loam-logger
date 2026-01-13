import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client';
import { motion } from 'motion/react';
import {
  FaArrowLeft,
  FaBicycle,
  FaPencilAlt,
  FaWrench,
  FaExternalLinkAlt,
  FaCog,
} from 'react-icons/fa';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { BikeForm } from '@/components/BikeForm';
import { StatusPill } from '@/components/dashboard/StatusPill';
import { LogServiceModal } from '@/components/dashboard/LogServiceModal';
import { ComponentDetailRow } from '@/components/gear/ComponentDetailRow';
import { BikeSpecsGrid, EbikeSpecsGrid } from '@/components/gear/BikeSpecsGrid';
import { SpareComponentForm } from '@/components/SpareComponentForm';
import {
  GEAR_QUERY,
  UPDATE_BIKE,
  UPDATE_COMPONENT,
} from '@/graphql/gear';
import {
  BIKE_COMPONENT_SECTIONS,
  type BikeComponentSection,
  type BikeFormValues,
  type GearComponentState,
  type SpareFormState,
} from '@/models/BikeComponents';
import type { BikePredictionSummary, ComponentPrediction, PredictionStatus } from '@/types/prediction';

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
  baselineWearPercent?: number | null;
  baselineMethod?: string | null;
  baselineConfidence?: string | null;
  lastServicedAt?: string | null;
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

export default function BikeDetail() {
  const { bikeId } = useParams<{ bikeId: string }>();
  const navigate = useNavigate();

  const { data, loading, error } = useQuery<{ bikes: BikeDto[] }>(GEAR_QUERY, {
    fetchPolicy: 'cache-first',
  });

  const [updateBikeMutation, updateBikeState] = useMutation(UPDATE_BIKE, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });

  const [updateComponentMutation, updateComponentState] = useMutation(UPDATE_COMPONENT, {
    refetchQueries: [{ query: GEAR_QUERY }],
    awaitRefetchQueries: true,
  });

  const bike = data?.bikes?.find((b) => b.id === bikeId);
  const predictions = bike?.predictions;
  const components = bike?.components ?? [];

  // Sort components by prediction status (most urgent first)
  const sortedComponents = useMemo(() => {
    if (!components.length) return [];

    const predictionMap = new Map<string, ComponentPrediction>();
    predictions?.components?.forEach((p) => {
      predictionMap.set(p.componentId, p);
    });

    return [...components].sort((a, b) => {
      const predA = predictionMap.get(a.id);
      const predB = predictionMap.get(b.id);

      const statusOrder: Record<PredictionStatus, number> = {
        OVERDUE: 0,
        DUE_NOW: 1,
        DUE_SOON: 2,
        ALL_GOOD: 3,
      };

      const statusA = predA?.status ?? 'ALL_GOOD';
      const statusB = predB?.status ?? 'ALL_GOOD';
      const statusDiff = statusOrder[statusA] - statusOrder[statusB];
      if (statusDiff !== 0) return statusDiff;

      const hoursA = predA?.hoursRemaining ?? Infinity;
      const hoursB = predB?.hoursRemaining ?? Infinity;
      return hoursA - hoursB;
    });
  }, [components, predictions]);

  // Modal states
  const [editBikeOpen, setEditBikeOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentDto | null>(null);
  const [bikeFormError, setBikeFormError] = useState<string | null>(null);
  const [componentFormError, setComponentFormError] = useState<string | null>(null);

  const bikeFormState = useMemo(() => createBikeFormState(bike), [bike]);

  const handleBikeSubmit = async (form: BikeFormValues) => {
    if (!bike) return;
    setBikeFormError(null);

    if (!form.manufacturer.trim()) {
      setBikeFormError('Manufacturer is required.');
      return;
    }
    if (!form.model.trim()) {
      setBikeFormError('Model is required.');
      return;
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
      year: Number(form.year),
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
      fork: componentInput(form.components.fork),
      shock: componentInput(form.components.shock),
      dropper: componentInput(form.components.dropper),
      wheels: componentInput(form.components.wheels),
      pivotBearings: componentInput(form.components.pivotBearings),
    };

    try {
      await updateBikeMutation({ variables: { id: bike.id, input: payload } });
      setEditBikeOpen(false);
    } catch (err) {
      setBikeFormError((err as Error).message);
    }
  };

  const handleComponentSubmit = async (form: SpareFormState) => {
    if (!editingComponent) return;
    setComponentFormError(null);

    const hoursValue = form.hoursUsed.trim();
    const hoursUsed = hoursValue === '' ? 0 : Number(hoursValue);
    const serviceValue = form.serviceDueAtHours.trim();
    const serviceDue = serviceValue === '' ? null : Number(serviceValue);

    const payload = {
      type: form.type,
      brand: form.isStock ? undefined : form.brand || undefined,
      model: form.isStock ? undefined : form.model || undefined,
      notes: form.notes,
      isStock: form.isStock,
      hoursUsed: Number.isNaN(hoursUsed) ? undefined : hoursUsed,
      serviceDueAtHours: Number.isNaN(serviceDue ?? 0) ? undefined : serviceDue,
    };

    try {
      await updateComponentMutation({ variables: { id: editingComponent.id, input: payload } });
      setEditingComponent(null);
    } catch (err) {
      setComponentFormError((err as Error).message);
    }
  };

  // Loading state
  if (loading && !data) {
    return (
      <div className="bike-detail-page">
        <div className="bike-detail-section" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--sage)' }}>Loading bike details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bike-detail-page">
        <Link to="/gear" className="bike-detail-back">
          <FaArrowLeft size={14} />
          Back to Bikes
        </Link>
        <div className="bike-detail-section" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--error)' }}>Error loading bike: {error.message}</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (!bike) {
    return (
      <div className="bike-detail-page">
        <Link to="/gear" className="bike-detail-back">
          <FaArrowLeft size={14} />
          Back to Bikes
        </Link>
        <div className="bike-detail-section" style={{ padding: '3rem', textAlign: 'center' }}>
          <FaBicycle size={48} style={{ color: 'var(--sage-30)', marginBottom: '1rem' }} />
          <h2 style={{ color: 'var(--cream)', marginBottom: '0.5rem' }}>Bike not found</h2>
          <p style={{ color: 'var(--sage)' }}>
            The bike you're looking for doesn't exist or has been deleted.
          </p>
          <Button variant="primary" onClick={() => navigate('/gear')} style={{ marginTop: '1rem' }}>
            Go to My Bikes
          </Button>
        </div>
      </div>
    );
  }

  const bikeName = bike.year ? `${bike.year} ${bike.model}` : bike.model;
  const overallStatus = predictions?.overallStatus ?? 'ALL_GOOD';

  return (
    <motion.div
      className="bike-detail-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Back Navigation */}
      <Link to="/gear" className="bike-detail-back">
        <FaArrowLeft size={14} />
        Back to Bikes
      </Link>

      {/* Hero Section */}
      <section className="bike-detail-hero">
        <div className="bike-detail-hero-content">
          <header className="bike-detail-hero-header">
            <p className="bike-detail-manufacturer">{bike.manufacturer}</p>
            <h1 className="bike-detail-name">{bikeName}</h1>
            {bike.nickname && (
              <p className="bike-detail-nickname">"{bike.nickname}"</p>
            )}
          </header>

          <div className="bike-detail-status-row">
            <StatusPill status={overallStatus} />
            <div className="bike-detail-badges">
              {bike.category && (
                <span className="bike-card-badge">
                  {bike.subcategory || bike.category}
                </span>
              )}
              {bike.isEbike && (
                <span className="bike-card-badge bike-card-badge-accent">
                  E-Bike
                </span>
              )}
              {bike.frameMaterial && (
                <span className="bike-card-badge">{bike.frameMaterial}</span>
              )}
            </div>
          </div>

          <div className="bike-detail-hero-actions">
            <Button variant="primary" size="sm" onClick={() => setServiceModalOpen(true)}>
              <FaWrench size={12} className="icon-left" />
              Log Service
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditBikeOpen(true)}>
              <FaPencilAlt size={12} className="icon-left" />
              Edit Bike
            </Button>
          </div>
        </div>

        <div className="bike-detail-hero-image">
          {bike.thumbnailUrl ? (
            <img
              src={bike.thumbnailUrl}
              alt={`${bike.manufacturer} ${bike.model}`}
              className="bike-detail-hero-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                if (placeholder) placeholder.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className="bike-detail-hero-placeholder"
            style={{ display: bike.thumbnailUrl ? 'none' : 'flex' }}
          >
            <FaBicycle size={48} />
          </div>
        </div>
      </section>

      {/* Specifications */}
      <BikeSpecsGrid bike={bike} />

      {/* E-bike Specifications */}
      <EbikeSpecsGrid bike={bike} />

      {/* Component Health */}
      <section className="bike-detail-section">
        <h3 className="bike-detail-section-title">Component Health</h3>

        {sortedComponents.length > 0 ? (
          <div className="component-detail-list">
            {sortedComponents.map((component) => {
              const prediction = predictions?.components?.find(
                (p) => p.componentId === component.id
              );
              return (
                <ComponentDetailRow
                  key={component.id}
                  component={component}
                  prediction={prediction}
                  onEdit={() => setEditingComponent(component)}
                />
              );
            })}
          </div>
        ) : (
          <div className="bike-detail-empty-components">
            <FaCog size={32} className="bike-detail-empty-icon" />
            <p className="bike-detail-empty-text">
              No components added yet. Edit the bike to add components.
            </p>
          </div>
        )}
      </section>

      {/* Notes */}
      {bike.notes && (
        <section className="bike-detail-section">
          <h3 className="bike-detail-section-title">Notes</h3>
          <p className="bike-detail-notes">{bike.notes}</p>
        </section>
      )}

      {/* External Links */}
      {bike.spokesUrl && (
        <section className="bike-detail-section">
          <h3 className="bike-detail-section-title">External Links</h3>
          <div className="bike-detail-links">
            <a
              href={bike.spokesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bike-detail-external-link"
            >
              View on 99spokes
              <FaExternalLinkAlt size={12} />
            </a>
          </div>
        </section>
      )}

      {/* Edit Bike Modal */}
      <Modal
        isOpen={editBikeOpen}
        onClose={() => {
          setEditBikeOpen(false);
          setBikeFormError(null);
        }}
        title={`Edit ${bikeName}`}
        size="xl"
      >
        <BikeForm
          mode="edit"
          initial={bikeFormState}
          onSubmit={(form) => handleBikeSubmit(form)}
          onClose={() => {
            setEditBikeOpen(false);
            setBikeFormError(null);
          }}
          submitting={updateBikeState.loading}
          error={bikeFormError}
        />
      </Modal>

      {/* Log Service Modal */}
      {bike && (
        <LogServiceModal
          isOpen={serviceModalOpen}
          onClose={() => setServiceModalOpen(false)}
          bike={{
            ...bike,
            sortOrder: 0,
            predictions: bike.predictions ?? null,
          }}
        />
      )}

      {/* Edit Component Modal */}
      <Modal
        isOpen={!!editingComponent}
        onClose={() => {
          setEditingComponent(null);
          setComponentFormError(null);
        }}
        title={editingComponent ? `Edit ${editingComponent.type}` : 'Edit Component'}
        size="md"
      >
        {editingComponent && (
          <SpareComponentForm
            initial={{
              id: editingComponent.id,
              type: editingComponent.type as SpareFormState['type'],
              brand: editingComponent.brand ?? '',
              model: editingComponent.model ?? '',
              notes: editingComponent.notes ?? '',
              isStock: editingComponent.isStock,
              hoursUsed: String(editingComponent.hoursUsed ?? ''),
              serviceDueAtHours: String(editingComponent.serviceDueAtHours ?? ''),
            }}
            onSubmit={handleComponentSubmit}
            onClose={() => {
              setEditingComponent(null);
              setComponentFormError(null);
            }}
            submitting={updateComponentState.loading}
            error={componentFormError}
          />
        )}
      </Modal>
    </motion.div>
  );
}
