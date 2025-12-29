import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery, gql } from '@apollo/client';
import { FaMountain } from 'react-icons/fa';
import { ME_QUERY } from '../graphql/me';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Button } from '@/components/ui';
import { getAuthHeaders } from '@/lib/csrf';
import { BikeSearch, type SpokesSearchResult } from '@/components/BikeSearch';
import { useSpokes, type SpokesComponentEntry, type SpokesBikeDetails } from '@/hooks/useSpokes';

// All component types we track (matching BikeForm)
const ALL_COMPONENT_TYPES = [
  { key: 'fork', label: 'Fork', spokesKey: 'fork' },
  { key: 'rearShock', label: 'Rear Shock', spokesKey: 'rearShock' },
  { key: 'brakes', label: 'Brakes', spokesKey: 'brakes' },
  { key: 'rearDerailleur', label: 'Rear Derailleur', spokesKey: 'rearDerailleur' },
  { key: 'crank', label: 'Crankset', spokesKey: 'crank' },
  { key: 'cassette', label: 'Cassette', spokesKey: 'cassette' },
  { key: 'rims', label: 'Rims', spokesKey: 'rims' },
  { key: 'tires', label: 'Tires', spokesKey: 'tires' },
  { key: 'stem', label: 'Stem', spokesKey: 'stem' },
  { key: 'handlebar', label: 'Handlebar', spokesKey: 'handlebar' },
  { key: 'saddle', label: 'Saddle', spokesKey: 'saddle' },
  { key: 'seatpost', label: 'Seatpost', spokesKey: 'seatpost' },
  { key: 'wheels', label: 'Wheels', spokesKey: 'wheels' },
  { key: 'pivotBearings', label: 'Pivot Bearings', spokesKey: null },
] as const;

// Component entry for the review table
type ComponentEntry = {
  key: string;
  label: string;
  value: string;
  description: string;
  kind?: string;
};

// Helper to extract only GraphQL-allowed fields for SpokesComponentInput
const toSpokesInput = (comp: SpokesComponentEntry | null | undefined): SpokesComponentData | null => {
  if (!comp) return null;
  return {
    maker: comp.make || comp.maker || undefined,
    model: comp.model || undefined,
    description: comp.description || undefined,
    kind: comp.kind || undefined,
  };
};

// Build component entries from 99spokes data (matching BikeForm)
const buildComponentEntries = (details: SpokesBikeDetails | null): ComponentEntry[] => {
  return ALL_COMPONENT_TYPES.map(({ key, label, spokesKey }) => {
    let brand = '';
    let model = '';
    let description = '';
    let kind: string | undefined;

    if (details?.components && spokesKey) {
      const comp = details.components[spokesKey as keyof typeof details.components] as SpokesComponentEntry | undefined;
      if (comp) {
        brand = comp.make || comp.maker || '';
        model = comp.model || '';
        description = comp.description || '';
        kind = comp.kind;
      }
    }

    // Special handling for suspension components
    if (key === 'fork' && details?.suspension?.front?.component) {
      const suspComp = details.suspension.front.component;
      brand = suspComp.make || brand;
      model = suspComp.model || model;
      description = suspComp.description || description;
    }
    if (key === 'rearShock' && details?.suspension?.rear?.component) {
      const suspComp = details.suspension.rear.component;
      brand = suspComp.make || brand;
      model = suspComp.model || model;
      description = suspComp.description || description;
    }

    // Combine brand and model into single value
    const value = [brand, model].filter(Boolean).join(' ').trim();

    // Update label for dropper posts
    const displayLabel = key === 'seatpost' && kind === 'dropper' ? 'Dropper Post' : label;

    return {
      key,
      label: displayLabel,
      value,
      description,
      kind,
    };
  });
};

const CONNECTED_ACCOUNTS_QUERY = gql`
  query ConnectedAccounts {
    me {
      id
      accounts {
        provider
        connectedAt
      }
    }
  }
`;

type SpokesComponentData = {
  maker?: string;
  model?: string;
  description?: string;
  kind?: string;  // For seatpost: 'dropper' | 'rigid'
};

type OnboardingData = {
  age: number;
  location: string;
  bikeYear: number;
  bikeMake: string;
  bikeModel: string;
  bikeTravelFork?: number;
  bikeTravelShock?: number;
  spokesId?: string;
  // 99spokes metadata
  spokesUrl?: string;
  thumbnailUrl?: string;
  family?: string;
  category?: string;
  subcategory?: string;
  buildKind?: string;
  isFrameset?: boolean;
  isEbike?: boolean;
  gender?: string;
  frameMaterial?: string;
  hangerStandard?: string;
  // E-bike motor/battery specs
  motorMaker?: string;
  motorModel?: string;
  motorPowerW?: number;
  motorTorqueNm?: number;
  batteryWh?: number;
  // Legacy components format
  components: {
    fork?: string;
    rearShock?: string;
    wheels?: string;
    dropperPost?: string;
  };
  // 99spokes components for auto-creation
  spokesComponents?: Record<string, SpokesComponentData | null>;
};

export default function Onboarding() {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const { user } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const { data: accountsData, refetch: refetchAccounts } = useQuery(CONNECTED_ACCOUNTS_QUERY);
  const { getBikeDetails, isLoading: loadingBikeDetails } = useSpokes();
  const [showManualBikeEntry, setShowManualBikeEntry] = useState(false);
  const [componentEntries, setComponentEntries] = useState<ComponentEntry[]>(() => buildComponentEntries(null));
  const [spokesDetails, setSpokesDetails] = useState<SpokesBikeDetails | null>(null);

  // Read step from URL query parameter, default to 1
  const initialStep = parseInt(searchParams.get('step') || '1', 10);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = accountsData?.me?.accounts || [];
  const hasConnectedDevice = accounts.some((acc: { provider: string }) => acc.provider === 'garmin');

  // Load initial data from sessionStorage if available (for OAuth redirects)
  const loadSavedData = (): OnboardingData => {
    try {
      const saved = sessionStorage.getItem('onboarding_data');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.error('Failed to load saved onboarding data:', err);
    }
    return {
      age: 16,
      location: 'Bellingham, WA',
      bikeYear: new Date().getFullYear(),
      bikeMake: '',
      bikeModel: '',
      components: {},
    };
  };

  const [data, setData] = useState<OnboardingData>(loadSavedData);

  // Save data to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem('onboarding_data', JSON.stringify(data));
    } catch (err) {
      console.error('Failed to save onboarding data:', err);
    }
  }, [data]);

  // Refetch accounts when returning from OAuth redirect on step 5
  useEffect(() => {
    if (initialStep === 5) {
      refetchAccounts();
    }
  }, [initialStep, refetchAccounts]);

  const firstName = user?.name?.split(' ')?.[0] || 'Rider';

  const isBikeDataValid = () => {
    return data.bikeYear > 0 && data.bikeMake !== '' && data.bikeModel !== '' && data.bikeModel !== 'Select a model';
  };

  // Update a component entry value
  const updateComponentEntry = (key: string, value: string) => {
    setComponentEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, value } : entry))
    );
  };

  // Handle bike selection from search
  const handleBikeSelect = async (bike: SpokesSearchResult) => {
    setData((prev) => ({
      ...prev,
      spokesId: bike.id,
      bikeMake: bike.maker,
      bikeModel: bike.model,
      bikeYear: bike.year,
      // Store basic metadata from search result
      family: bike.family || undefined,
      category: bike.category || undefined,
      subcategory: bike.subcategory || undefined,
    }));

    // Fetch full details for auto-fill
    const details = await getBikeDetails(bike.id);
    if (details) {
      // Build spokesComponents from API response for auto-creation
      // Filter to only GraphQL-allowed fields (maker, model, description, kind)
      const spokesComponents = details.components ? {
        fork: toSpokesInput(details.components.fork),
        rearShock: toSpokesInput(details.components.rearShock || details.components.shock),
        brakes: toSpokesInput(details.components.brakes),
        rearDerailleur: toSpokesInput(details.components.rearDerailleur),
        crank: toSpokesInput(details.components.crank),
        cassette: toSpokesInput(details.components.cassette),
        rims: toSpokesInput(details.components.rims),
        tires: toSpokesInput(details.components.tires),
        stem: toSpokesInput(details.components.stem),
        handlebar: toSpokesInput(details.components.handlebar),
        saddle: toSpokesInput(details.components.saddle),
        seatpost: toSpokesInput(details.components.seatpost),
      } : undefined;

      // Prefer travelMM from direct endpoint, fallback to travel from search
      const forkTravel = details.suspension?.front?.travelMM || details.suspension?.front?.travel;
      const shockTravel = details.suspension?.rear?.travelMM || details.suspension?.rear?.travel;

      // Check if seatpost is a dropper
      const isDropperSeatpost = details.components?.seatpost?.kind === 'dropper';

      setData((prev) => ({
        ...prev,
        bikeTravelFork: forkTravel,
        bikeTravelShock: shockTravel,
        // 99spokes metadata
        spokesUrl: details.url || undefined,
        thumbnailUrl: details.thumbnailUrl || undefined,
        family: details.family || prev.family,
        category: details.category || prev.category,
        subcategory: details.subcategory || prev.subcategory,
        buildKind: details.buildKind || undefined,
        isFrameset: details.isFrameset ?? false,
        isEbike: details.isEbike ?? false,
        gender: details.gender || undefined,
        frameMaterial: details.frameMaterial || undefined,
        hangerStandard: details.hangerStandard || undefined,
        // E-bike motor/battery specs
        motorMaker: details.isEbike && details.components?.motor?.maker ? details.components.motor.maker : undefined,
        motorModel: details.isEbike && details.components?.motor?.model ? details.components.motor.model : undefined,
        motorPowerW: details.isEbike && details.components?.motor?.powerW ? details.components.motor.powerW : undefined,
        motorTorqueNm: details.isEbike && details.components?.motor?.torqueNm ? details.components.motor.torqueNm : undefined,
        batteryWh: details.isEbike && details.components?.battery?.capacityWh ? details.components.battery.capacityWh : undefined,
        // Store full components for auto-creation on backend
        spokesComponents,
        // Update visible component fields (legacy format for display)
        components: {
          ...prev.components,
          fork: details.suspension?.front?.component
            ? `${details.suspension.front.component.make || ''} ${details.suspension.front.component.model || ''}`.trim()
            : prev.components.fork,
          rearShock: details.suspension?.rear?.component
            ? `${details.suspension.rear.component.make || ''} ${details.suspension.rear.component.model || ''}`.trim()
            : prev.components.rearShock,
          wheels: details.components?.wheels
            ? `${details.components.wheels.make || details.components.wheels.maker || ''} ${details.components.wheels.model || ''}`.trim()
            : prev.components.wheels,
          // Smart dropper detection: use seatpost data if it's a dropper
          dropperPost: isDropperSeatpost && details.components?.seatpost
            ? `${details.components.seatpost.make || details.components.seatpost.maker || ''} ${details.components.seatpost.model || ''}`.trim()
            : details.components?.dropper
              ? `${details.components.dropper.make || details.components.dropper.maker || ''} ${details.components.dropper.model || ''}`.trim()
              : prev.components.dropperPost,
        },
      }));

      // Store full details and build component entries for Step 4
      setSpokesDetails(details);
      setComponentEntries(buildComponentEntries(details));
    } else {
      // No details found, use empty component entries
      setSpokesDetails(null);
      setComponentEntries(buildComponentEntries(null));
    }
  };

  // Get initial search value for display
  const getBikeSearchInitialValue = () => {
    if (data.bikeMake && data.bikeModel && data.bikeYear) {
      return `${data.bikeYear} ${data.bikeMake} ${data.bikeModel}`;
    }
    return '';
  };

  const handleNext = () => {
    // Validate age on step 1
    if (currentStep === 1) {
      if (!Number.isInteger(data.age) || data.age < 16 || data.age > 115) {
        setError('Age must be between 16 and 115');
        return;
      }
    }

    // Validate bike details on step 3
    if (currentStep === 3) {
      const errors = [];
      if (!data.bikeYear) errors.push('bike year');
      if (!data.bikeMake) errors.push('bike make');
      if (!data.bikeModel) errors.push('bike model');

      if (errors.length > 0) {
        setError(`Please enter a valid ${errors.join(', ')}`);
        return;
      }
    }

    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  };

  const handleComplete = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Build spokesComponents from component entries for auto-creation
      const spokesComponents = spokesDetails?.components ? {
        fork: toSpokesInput(spokesDetails.components.fork),
        rearShock: toSpokesInput(spokesDetails.components.rearShock || spokesDetails.components.shock),
        brakes: toSpokesInput(spokesDetails.components.brakes),
        rearDerailleur: toSpokesInput(spokesDetails.components.rearDerailleur),
        crank: toSpokesInput(spokesDetails.components.crank),
        cassette: toSpokesInput(spokesDetails.components.cassette),
        rims: toSpokesInput(spokesDetails.components.rims),
        tires: toSpokesInput(spokesDetails.components.tires),
        stem: toSpokesInput(spokesDetails.components.stem),
        handlebar: toSpokesInput(spokesDetails.components.handlebar),
        saddle: toSpokesInput(spokesDetails.components.saddle),
        seatpost: spokesDetails.components.seatpost ? {
          ...toSpokesInput(spokesDetails.components.seatpost),
          kind: spokesDetails.components.seatpost.kind || undefined,
        } : null,
      } : undefined;

      // Build legacy components format from component entries
      const getComponentValue = (key: string) => {
        const entry = componentEntries.find((e) => e.key === key);
        return entry?.value || '';
      };

      // Check if seatpost is a dropper
      const seatpostEntry = componentEntries.find((e) => e.key === 'seatpost');
      const isDropper = seatpostEntry?.kind === 'dropper';

      const submissionData = {
        ...data,
        spokesComponents,
        components: {
          fork: getComponentValue('fork'),
          rearShock: getComponentValue('rearShock'),
          wheels: getComponentValue('wheels'),
          dropperPost: isDropper ? getComponentValue('seatpost') : getComponentValue('seatpost'),
        },
      };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/onboarding/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(submissionData),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to complete onboarding');
      }

      // Refetch user data to get updated onboardingCompleted status
      const { data: userData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data: userData });

      // Clear saved onboarding data from sessionStorage
      sessionStorage.removeItem('onboarding_data');

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  const handleConnectGarmin = () => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    window.location.href = `${apiBase}/auth/garmin/start`;
  };

  const handleSkipDevices = async () => {
    // Skip device connections and complete onboarding
    await handleComplete();
  };

  const progressPercentage = (currentStep / 5) * 100;

  return (
    <div className="min-h-screen w-full relative flex items-center justify-center px-4 py-10">
      {/* Background - Desktop */}
      <div
        className="absolute inset-0 z-0 hidden md:block"
        style={{
          backgroundImage: 'url(/mtbLandingPhoto.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/95 via-charcoal/90 to-forest-deep/95" />
      </div>

      {/* Background - Mobile */}
      <div
        className="absolute inset-0 z-0 md:hidden"
        style={{
          backgroundImage: 'url(/mtbLandingPhotoMobile.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/95 via-charcoal/90 to-forest-deep/95" />
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted">Step {currentStep} of 5</span>
            <span className="text-sm text-primary">{Math.round(progressPercentage)}%</span>
          </div>
          <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Content Card */}
        <div
          className="rounded-3xl p-8 space-y-6"
          style={{
            backgroundColor: 'rgba(18, 28, 24, 0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(168, 208, 184, 0.1)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(168, 208, 184, 0.05)',
          }}
        >
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Step 1: Age */}
          {currentStep === 1 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">📅</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">How old are you, {firstName}?</h2>
                <p className="text-muted">You must be at least 16 to use Loam Logger</p>
              </div>

              <div className="space-y-4 text-left">
                <label className="block text-xs uppercase tracking-[0.3em] text-muted">
                  Age
                  <input
                    type="text"
                    inputMode="numeric"
                    className="mt-2 w-full input-soft"
                    value={data.age}
                    onChange={(e) => {
                      const value = e.target.value;
                      const parsed = parseInt(value);
                      if (value === '' || !Number.isNaN(parsed)) {
                        setData({ ...data, age: value === '' ? 0 : parsed });
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Location */}
          {currentStep === 2 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">📍</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Where are you located?</h2>
                <p className="text-muted">This helps us find local bike shops and service centers near you</p>
              </div>

              <div className="space-y-4 text-left">
                <label className="block text-xs uppercase tracking-[0.3em] text-muted">
                  Location (Optional)
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="Bellingham, WA"
                    value={data.location}
                    onChange={(e) => setData({ ...data, location: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted">City and state/province are sufficient</p>
                </label>
              </div>
            </div>
          )}

          {/* Step 3: Bike */}
          {currentStep === 3 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">🚲</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Tell us about your bike</h2>
                <p className="text-muted">What bike do you ride the most?</p>
              </div>

              {/* Bike Search */}
              <div className="space-y-2 text-left">
                <BikeSearch
                  label="Search Bike"
                  onSelect={handleBikeSelect}
                  initialValue={getBikeSearchInitialValue()}
                  hint="Search by brand, model, or year to auto-fill details"
                />
                {loadingBikeDetails && (
                  <p className="text-xs text-muted">Loading bike details...</p>
                )}
              </div>

              {/* Selected bike display */}
              {data.bikeMake && data.bikeModel && !showManualBikeEntry && (
                <div className="rounded-lg bg-surface-2 p-4 border border-app text-left">
                  <div className="flex gap-4">
                    {data.thumbnailUrl && (
                      <img
                        src={data.thumbnailUrl}
                        alt={`${data.bikeYear} ${data.bikeMake} ${data.bikeModel}`}
                        className="w-24 h-18 object-contain rounded bg-white/5"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <div className="flex-1">
                      <p className="text-heading font-medium">
                        {data.bikeYear} {data.bikeMake} {data.bikeModel}
                      </p>
                      {(data.bikeTravelFork || data.bikeTravelShock) && (
                        <p className="text-sm text-muted mt-1">
                          {data.bikeTravelFork && `Fork: ${data.bikeTravelFork}mm`}
                          {data.bikeTravelFork && data.bikeTravelShock && ' / '}
                          {data.bikeTravelShock && `Shock: ${data.bikeTravelShock}mm`}
                        </p>
                      )}
                      {data.category && (
                        <p className="text-xs text-muted mt-1 capitalize">{data.category}</p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowManualBikeEntry(true)}
                    className="text-xs text-primary hover:underline mt-2"
                  >
                    Edit details manually
                  </button>
                </div>
              )}

              {/* Manual entry toggle when no bike selected */}
              {!data.bikeMake && !showManualBikeEntry && (
                <button
                  type="button"
                  onClick={() => setShowManualBikeEntry(true)}
                  className="text-sm text-muted hover:text-primary"
                >
                  Can't find your bike? Enter details manually
                </button>
              )}

              {/* Manual Entry Fields */}
              {showManualBikeEntry && (
                <div className="space-y-4 text-left border-t border-app pt-4">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-muted">Manual Entry</p>
                    {data.spokesId && (
                      <button
                        type="button"
                        onClick={() => setShowManualBikeEntry(false)}
                        className="text-xs text-primary hover:underline"
                      >
                        Hide manual entry
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                      Year
                      <input
                        type="number"
                        className="mt-2 w-full input-soft"
                        value={data.bikeYear}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            setData({ ...data, bikeYear: parsed, spokesId: undefined });
                          }
                        }}
                      />
                    </label>
                    <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                      Make
                      <input
                        type="text"
                        className="mt-2 w-full input-soft"
                        placeholder="Trek, Specialized, etc."
                        value={data.bikeMake}
                        onChange={(e) => setData({ ...data, bikeMake: e.target.value, spokesId: undefined })}
                      />
                    </label>
                    <label className="col-span-2 text-xs uppercase tracking-[0.3em] text-muted">
                      Model
                      <input
                        type="text"
                        className="mt-2 w-full input-soft"
                        placeholder="Slash, Enduro, etc."
                        value={data.bikeModel}
                        onChange={(e) => setData({ ...data, bikeModel: e.target.value, spokesId: undefined })}
                      />
                    </label>
                    <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                      Fork Travel (mm)
                      <input
                        type="number"
                        className="mt-2 w-full input-soft"
                        placeholder="160"
                        value={data.bikeTravelFork || ''}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value);
                          setData({ ...data, bikeTravelFork: Number.isNaN(parsed) ? undefined : parsed });
                        }}
                      />
                    </label>
                    <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                      Shock Travel (mm)
                      <input
                        type="number"
                        className="mt-2 w-full input-soft"
                        placeholder="150"
                        value={data.bikeTravelShock || ''}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value);
                          setData({ ...data, bikeTravelShock: Number.isNaN(parsed) ? undefined : parsed });
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

              {!isBikeDataValid() && (
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
                  <p className="text-sm text-yellow-400">Please enter a valid bike year, make, and model to continue</p>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Components */}
          {currentStep === 4 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">🔧</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Review Components</h2>
                <p className="text-muted">
                  {data.bikeYear} {data.bikeMake} {data.bikeModel}
                </p>
              </div>

              <p className="text-sm text-muted text-left">
                Review your bike's components. Edit any parts you've customized.
              </p>

              <div className="border border-app rounded-lg bg-surface overflow-hidden text-left">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-app bg-surface-2">
                      <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2 w-1/3">
                        Component
                      </th>
                      <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2">
                        Part
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {componentEntries.map((entry, idx) => (
                      <tr
                        key={entry.key}
                        className={idx < componentEntries.length - 1 ? 'border-b border-app' : ''}
                      >
                        <td className="px-4 py-2 text-sm text-heading font-medium">
                          {entry.label}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={entry.value}
                            onChange={(e) => updateComponentEntry(entry.key, e.target.value)}
                            placeholder="Brand Model"
                            className="w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 5: Device Connections */}
          {currentStep === 5 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">📱</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Connect Your Devices</h2>
                <p className="text-muted max-w-lg mx-auto">
                  Connect your fitness devices to automatically sync your rides. You can always add more devices later in Settings.
                </p>
              </div>

              <div className="space-y-3 max-w-md mx-auto">
                {/* Garmin Connection */}
                {accounts.find((acc: { provider: string }) => acc.provider === 'garmin') ? (
                  <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaMountain className="text-lg" style={{ color: '#11A9ED' }} />
                        <div className="text-left">
                          <p className="font-semibold">Garmin Connect</p>
                          <p className="text-xs text-green-400">Connected ✓</p>
                        </div>
                      </div>
                      <span className="text-xs text-green-400">Ready</span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectGarmin}
                    className="w-full rounded-2xl border border-app/70 bg-surface-2 hover:bg-surface-3 px-4 py-4 transition text-left"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaMountain className="text-lg" style={{ color: '#11A9ED' }} />
                        <div>
                          <p className="font-semibold">Garmin Connect</p>
                          <p className="text-xs text-muted">Import activities automatically</p>
                        </div>
                      </div>
                      <span className="text-xs text-primary">Connect</span>
                    </div>
                  </button>
                )}

                {/* Placeholder for future integrations */}
                <div className="w-full rounded-2xl border border-app/70 bg-surface-2/50 px-4 py-4 opacity-50">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-left">
                      <p className="font-semibold">Strava, Suunto, Whoop</p>
                      <p className="text-xs text-muted">Coming soon</p>
                    </div>
                    <span className="text-xs text-muted">Not available</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-4 pt-6">
            {currentStep > 1 && currentStep !== 5 && (
              <Button
                onClick={handleBack}
                variant="secondary"
                className="flex-1"
                disabled={isLoading}
              >
                Back
              </Button>
            )}
            {currentStep < 5 ? (
              <Button
                onClick={handleNext}
                variant="primary"
                className="flex-1"
                disabled={isLoading || (currentStep === 3 && !isBikeDataValid())}
              >
                Continue
              </Button>
            ) : (
              <div className="flex gap-4 w-full">
                <Button
                  onClick={handleSkipDevices}
                  variant="secondary"
                  className="flex-1"
                  disabled={isLoading}
                >
                  {hasConnectedDevice ? 'Back' : 'Skip for now'}
                </Button>
                <Button
                  onClick={handleComplete}
                  variant="primary"
                  className="flex-1"
                  disabled={isLoading}
                >
                  {isLoading ? 'Completing...' : 'Continue'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
