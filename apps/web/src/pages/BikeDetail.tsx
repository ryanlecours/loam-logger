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
import { StatusPill } from '@/components/dashboard/StatusPill';
import { LogServiceModal } from '@/components/dashboard/LogServiceModal';
import { ComponentDetailRow } from '@/components/gear/ComponentDetailRow';
import { BikeSpecsGrid, EbikeSpecsGrid } from '@/components/gear/BikeSpecsGrid';
import { SpareComponentForm } from '@/components/SpareComponentForm';
import { BikeImageSelector } from '@/components/BikeImageSelector';
import { useSpokes } from '@/hooks/useSpokes';
import {
  GEAR_QUERY,
  UPDATE_BIKE,
  UPDATE_COMPONENT,
} from '@/graphql/gear';
import {
  type SpareFormState,
} from '@/models/BikeComponents';
import { getComponentLabel } from '@/constants/componentLabels';
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

  // Sort components by prediction status (most urgent first)
  const sortedComponents = useMemo(() => {
    const components = bike?.components ?? [];
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
  }, [bike?.components, predictions]);

  // 99Spokes hook for fetching bike images
  const { getBikeDetails, isLoading: loadingSpokesDetails } = useSpokes();

  // Modal states
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentDto | null>(null);
  const [editingTravel, setEditingTravel] = useState<'fork' | 'shock' | null>(null);
  const [travelValue, setTravelValue] = useState('');
  const [componentFormError, setComponentFormError] = useState<string | null>(null);
  const [travelFormError, setTravelFormError] = useState<string | null>(null);

  // Edit image modal state
  const [editImageOpen, setEditImageOpen] = useState(false);
  const [spokesImages, setSpokesImages] = useState<Array<{ url: string; colorKey?: string }>>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [imageFormError, setImageFormError] = useState<string | null>(null);

  // Handle opening the edit image modal
  const handleEditImageOpen = async () => {
    if (!bike?.spokesId) {
      // No 99Spokes ID, can't fetch images
      setImageFormError('This bike was added manually and has no additional images available.');
      setEditImageOpen(true);
      return;
    }

    setImageFormError(null);
    setSelectedImageUrl(bike.thumbnailUrl || null);
    setEditImageOpen(true);

    // Fetch bike details from 99Spokes to get images
    const details = await getBikeDetails(bike.spokesId);
    if (details?.images && details.images.length > 0) {
      setSpokesImages(details.images);
    } else {
      setSpokesImages([]);
      setImageFormError('No additional images available for this bike.');
    }
  };

  // Handle saving the selected image
  const handleImageSave = async () => {
    if (!bike || !selectedImageUrl) return;
    setImageFormError(null);

    try {
      await updateBikeMutation({
        variables: {
          id: bike.id,
          input: { thumbnailUrl: selectedImageUrl },
        },
      });
      setEditImageOpen(false);
      setSpokesImages([]);
    } catch (err) {
      setImageFormError((err as Error).message);
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
      brand: form.brand || undefined,
      model: form.model || undefined,
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

  const handleEditTravel = (field: 'fork' | 'shock') => {
    const currentValue = field === 'fork' ? bike?.travelForkMm : bike?.travelShockMm;
    setTravelValue(currentValue ? String(currentValue) : '');
    setTravelFormError(null);
    setEditingTravel(field);
  };

  const handleTravelSubmit = async () => {
    if (!bike || !editingTravel) return;
    setTravelFormError(null);

    const numValue = travelValue.trim() === '' ? null : Number(travelValue);
    if (numValue !== null && (Number.isNaN(numValue) || numValue < 0)) {
      setTravelFormError('Please enter a valid travel value in mm');
      return;
    }

    const payload = editingTravel === 'fork'
      ? { travelForkMm: numValue ?? undefined }
      : { travelShockMm: numValue ?? undefined };

    try {
      await updateBikeMutation({ variables: { id: bike.id, input: payload } });
      setEditingTravel(null);
      setTravelValue('');
    } catch (err) {
      setTravelFormError((err as Error).message);
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
          </div>
        </div>

        <div className="bike-detail-hero-image relative">
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
          {/* Edit image button */}
          {bike.spokesId && (
            <button
              type="button"
              onClick={handleEditImageOpen}
              className="absolute bottom-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 text-white text-xs font-medium hover:bg-black/90 transition-colors"
              aria-label="Change bike image"
            >
              <FaPencilAlt size={10} />
              Change Image
            </button>
          )}
        </div>
      </section>

      {/* Specifications */}
      <BikeSpecsGrid bike={bike} onEditTravel={handleEditTravel} />

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

      {/* Edit Image Modal */}
      <Modal
        isOpen={editImageOpen}
        onClose={() => {
          setEditImageOpen(false);
          setSpokesImages([]);
          setImageFormError(null);
        }}
        title="Change Bike Image"
        size="lg"
      >
        <div className="space-y-6">
          {loadingSpokesDetails ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-muted">Loading available images...</p>
            </div>
          ) : imageFormError && spokesImages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted">{imageFormError}</p>
            </div>
          ) : spokesImages.length > 1 ? (
            <BikeImageSelector
              images={spokesImages}
              thumbnailUrl={bike?.thumbnailUrl}
              selectedUrl={selectedImageUrl}
              onSelect={setSelectedImageUrl}
            />
          ) : spokesImages.length === 1 ? (
            <div className="text-center py-4">
              <p className="text-muted">Only one image is available for this bike.</p>
            </div>
          ) : null}

          {imageFormError && spokesImages.length > 0 && (
            <p className="text-sm text-danger text-center">{imageFormError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-app">
            <Button
              variant="secondary"
              onClick={() => {
                setEditImageOpen(false);
                setSpokesImages([]);
                setImageFormError(null);
              }}
            >
              Cancel
            </Button>
            {spokesImages.length > 1 && (
              <Button
                variant="primary"
                onClick={handleImageSave}
                disabled={updateBikeState.loading || !selectedImageUrl}
              >
                {updateBikeState.loading ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>
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
        title={editingComponent ? `Edit ${getComponentLabel(editingComponent.type)}` : 'Edit Component'}
        size="md"
      >
        {editingComponent && (
          <SpareComponentForm
            mode="bike"
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

      {/* Edit Travel Modal */}
      <Modal
        isOpen={!!editingTravel}
        onClose={() => {
          setEditingTravel(null);
          setTravelValue('');
          setTravelFormError(null);
        }}
        title={editingTravel === 'fork' ? 'Edit Fork Travel' : 'Edit Shock Travel'}
        size="sm"
      >
        <div className="travel-edit-form">
          <label className="travel-edit-label">
            Travel (mm)
            <input
              type="number"
              value={travelValue}
              onChange={(e) => setTravelValue(e.target.value)}
              placeholder="e.g. 160"
              className="travel-edit-input"
              min="0"
              max="300"
              autoFocus
            />
          </label>
          {travelFormError && (
            <p className="travel-edit-error">{travelFormError}</p>
          )}
          <div className="travel-edit-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingTravel(null);
                setTravelValue('');
                setTravelFormError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleTravelSubmit}
              disabled={updateBikeState.loading}
            >
              {updateBikeState.loading ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
