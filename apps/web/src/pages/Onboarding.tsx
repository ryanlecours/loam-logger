import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery, gql } from '@apollo/client';
import { FaMountain, FaStrava, FaCog, FaCheck } from 'react-icons/fa';
import { ME_QUERY } from '../graphql/me';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useUserTier } from '../hooks/useUserTier';
import { Button } from '@/components/ui';
import { getAuthHeaders } from '@/lib/csrf';
import { BikeSearch, type SpokesSearchResult } from '@/components/BikeSearch';
import { BikeImageSelector } from '@/components/BikeImageSelector';
import { useSpokes, type SpokesBikeDetails } from '@/hooks/useSpokes';
import { TermsAcceptanceStep } from '@/components/TermsAcceptanceStep';
import { ServiceHistoryForm } from '@/components/onboarding/ServiceHistoryForm';
import { ImportRidesForm } from '@/components/onboarding/ImportRidesForm';
import {
  toSpokesInput,
  isValidImageUrl,
  filterNonNullComponents,
} from '@/utils/bikeFormHelpers';

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
  maker?: string | null;
  model?: string | null;
  description?: string | null;
  kind?: string | null;  // For seatpost: 'dropper' | 'rigid'
};

type BikeImageData = {
  url: string;
  colorKey?: string;
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
  // Bike colorway images from 99spokes
  bikeImages?: BikeImageData[];
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
  const { isAdmin } = useUserTier();
  const [searchParams] = useSearchParams();
  const { data: accountsData, refetch: refetchAccounts } = useQuery(CONNECTED_ACCOUNTS_QUERY);
  const { getBikeDetails, isLoading: loadingBikeDetails } = useSpokes();

  // Strava connections temporarily disabled for non-admin users
  const isStravaDisabled = !isAdmin;
  const [showManualBikeEntry, setShowManualBikeEntry] = useState(false);
  const [spokesDetails, setSpokesDetails] = useState<SpokesBikeDetails | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // Step 7: Personalization state
  const [bikeId, setBikeId] = useState<string | null>(null);

  // Get bike image URL with fallback to images array, validated for security
  const getBikeImageUrl = () => {
    const url = selectedImageUrl || data.thumbnailUrl || spokesDetails?.images?.[0]?.url;
    return url && isValidImageUrl(url) ? url : null;
  };

  // Handle image selection from BikeImageSelector
  const handleImageSelect = (url: string) => {
    setSelectedImageUrl(url);
    setData((prev) => ({ ...prev, thumbnailUrl: url }));
  };

  // Read step from URL query parameter, default to 1
  const initialStep = parseInt(searchParams.get('step') || '1', 10);
  const [currentStep, setCurrentStep] = useState(initialStep);
  // Granular loading state for better UX during submission
  const [loadingState, setLoadingState] = useState<'idle' | 'saving' | 'syncing' | 'redirecting'>('idle');
  const isLoading = loadingState !== 'idle';
  const [error, setError] = useState<string | null>(null);

  const accounts = accountsData?.me?.accounts || [];
  const hasConnectedDevice = accounts.some((acc: { provider: string }) =>
    acc.provider === 'garmin' || acc.provider === 'strava'
  );

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

  // Refetch accounts when returning from OAuth redirect on step 7 (device connections)
  useEffect(() => {
    if (initialStep === 7) {
      refetchAccounts();
    }
  }, [initialStep, refetchAccounts]);

  const firstName = user?.name?.split(' ')?.[0] || 'Rider';

  const isBikeDataValid = () => {
    return data.bikeYear > 0 && data.bikeMake !== '' && data.bikeModel !== '' && data.bikeModel !== 'Select a model';
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

      // Check if seatpost is a dropper
      const isDropperSeatpost = details.components?.seatpost?.kind === 'dropper';

      // Prioritize images array over thumbnailUrl
      const defaultImage = details.images?.[0]?.url || details.thumbnailUrl || undefined;
      setSelectedImageUrl(defaultImage || null);

      // Convert images to persistable format (strip any extra properties)
      const bikeImages: BikeImageData[] = details.images?.map(img => ({
        url: img.url,
        colorKey: img.colorKey,
      })) || [];

      setData((prev) => ({
        ...prev,
        // 99spokes metadata
        spokesUrl: details.url || undefined,
        thumbnailUrl: defaultImage,
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
        // Store bike images for colorway selection (persisted)
        bikeImages,
        // Store full components for auto-creation on backend
        spokesComponents,
        // Update visible component fields (legacy format for display)
        components: {
          ...prev.components,
          fork: details.components?.fork
            ? `${details.components.fork.make || details.components.fork.maker || ''} ${details.components.fork.model || ''}`.trim()
            : prev.components.fork,
          rearShock: details.components?.shock || details.components?.rearShock
            ? `${(details.components.shock || details.components.rearShock)?.make || (details.components.shock || details.components.rearShock)?.maker || ''} ${(details.components.shock || details.components.rearShock)?.model || ''}`.trim()
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

      // Store full details for spokesComponents submission
      setSpokesDetails(details);
    } else {
      setSpokesDetails(null);
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
    // Step 1 (Terms) has its own navigation via TermsAcceptanceStep
    if (currentStep === 1) {
      return;
    }

    // Validate age on step 2
    if (currentStep === 2) {
      if (!Number.isInteger(data.age) || data.age < 16 || data.age > 115) {
        setError('Age must be between 16 and 115');
        return;
      }
    }

    // Validate bike details on step 4
    if (currentStep === 4) {
      const errors = [];
      if (!data.bikeYear) errors.push('bike year');
      if (!data.bikeMake) errors.push('bike make');
      if (!data.bikeModel) errors.push('bike model');

      if (errors.length > 0) {
        setError(`Please enter a valid ${errors.join(', ')}`);
        return;
      }
    }

    // Step 5 (colorway) has no validation - optional selection

    if (currentStep < 6) {
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
    setLoadingState('saving');
    setError(null);

    try {
      // Build spokesComponents from 99Spokes details for auto-creation
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

      const submissionData = {
        ...data,
        spokesComponents: filterNonNullComponents(spokesComponents),
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

      // Get the created bike ID from response
      const result = await response.json();
      setBikeId(result.bikeId);

      // Update loading state for cache sync
      setLoadingState('syncing');

      // Refetch user data to get updated onboardingCompleted status
      const { data: userData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data: userData });

      // Clear saved onboarding data from sessionStorage
      sessionStorage.removeItem('onboarding_data');

      setLoadingState('idle');
      // Advance to Step 7 (Personalization) instead of redirecting
      setCurrentStep(7);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoadingState('idle');
    }
  };

  const handleConnectGarmin = () => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    window.location.href = `${apiBase}/auth/garmin/start`;
  };

  const handleConnectStrava = () => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    window.location.href = `${apiBase}/auth/strava/start`;
  };

  const handleSkipDevices = async () => {
    // Skip device connections and complete onboarding
    await handleComplete();
  };

  // Step 7: Personalization handlers
  const handleGoToDashboard = () => {
    navigate('/dashboard', { replace: true });
  };

  const progressPercentage = (currentStep / 7) * 100;

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
            <span className="text-sm text-muted">Step {currentStep} of 8</span>
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
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {/* Step 1: Terms & Conditions */}
          {currentStep === 1 && (
            <TermsAcceptanceStep onComplete={() => setCurrentStep(2)} />
          )}

          {/* Step 2: Age */}
          {currentStep === 2 && (
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
                <label className="block label-section">
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

          {/* Step 3: Location */}
          {currentStep === 3 && (
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
                <label className="block label-section">
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

          {/* Step 4: Bike */}
          {currentStep === 4 && (
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
                <>
                  <div className="rounded-lg bg-accent/10 p-4 border border-accent/30 text-left">
                    <div className="flex gap-4">
                      {getBikeImageUrl() && (
                        <img
                          src={getBikeImageUrl()!}
                          alt={`${data.bikeYear} ${data.bikeMake} ${data.bikeModel}`}
                          className="w-24 h-18 object-contain rounded bg-white/10"
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
                  </div>

                  <p className="text-sm text-muted mt-3">
                    Bike not found?{' '}
                    <button
                      type="button"
                      onClick={() => setShowManualBikeEntry(true)}
                      className="text-accent hover:underline"
                    >
                      Enter bike details manually
                    </button>
                  </p>
                </>
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
                    <label className="col-span-1 label-section">
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
                    <label className="col-span-1 label-section">
                      Make
                      <input
                        type="text"
                        className="mt-2 w-full input-soft"
                        placeholder="Trek, Specialized, etc."
                        value={data.bikeMake}
                        onChange={(e) => setData({ ...data, bikeMake: e.target.value, spokesId: undefined })}
                      />
                    </label>
                    <label className="col-span-2 label-section">
                      Model
                      <input
                        type="text"
                        className="mt-2 w-full input-soft"
                        placeholder="Slash, Enduro, etc."
                        value={data.bikeModel}
                        onChange={(e) => setData({ ...data, bikeModel: e.target.value, spokesId: undefined })}
                      />
                    </label>
                    <label className="col-span-1 label-section">
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
                    <label className="col-span-1 label-section">
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
                  <p className="text-sm text-warning">Please enter a valid bike year, make, and model to continue</p>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Colorway Selection (only shown if bike has multiple images) */}
          {currentStep === 5 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">🎨</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Which colorway do you have?</h2>
                <p className="text-muted">
                  {data.bikeYear} {data.bikeMake} {data.bikeModel}
                </p>
              </div>

              {/* Colorway selector - uses persisted data.bikeImages */}
              {data.bikeImages && data.bikeImages.length > 1 ? (
                <div className="text-left">
                  <p className="text-sm text-muted mb-4 text-center">
                    Select the color that matches your bike.
                  </p>
                  <BikeImageSelector
                    images={data.bikeImages}
                    thumbnailUrl={data.thumbnailUrl}
                    selectedUrl={selectedImageUrl}
                    onSelect={handleImageSelect}
                  />
                </div>
              ) : (
                <div className="text-center py-8">
                  {getBikeImageUrl() ? (
                    <div className="space-y-4">
                      <img
                        src={getBikeImageUrl()!}
                        alt={`${data.bikeYear} ${data.bikeMake} ${data.bikeModel}`}
                        className="mx-auto max-h-48 object-contain rounded-lg bg-white/5"
                      />
                      <p className="text-sm text-muted">Only one colorway available for this bike.</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No colorway options available for this bike.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 6: Device Connections */}
          {currentStep === 6 && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                    <span className="text-2xl">📱</span>
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">Connect Your Devices</h2>
                <p className="text-muted max-w-lg mx-auto">
                  Connect your fitness apps and devices to automatically sync your rides. You can always add more later in Settings.
                </p>
              </div>

              <div className="space-y-3 max-w-md mx-auto">
                {/* Strava Connection (Recommended) */}
                {accounts.find((acc: { provider: string }) => acc.provider === 'strava') ? (
                  <div className="w-full rounded-2xl border border-[#FC4C02]/50 bg-surface-2 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaStrava className="text-lg" style={{ color: '#FC4C02' }} />
                        <div className="text-left">
                          <p className="font-semibold">Strava</p>
                          <p className="text-xs text-success">Connected ✓</p>
                        </div>
                      </div>
                      <span className="text-xs text-success">Ready</span>
                    </div>
                  </div>
                ) : isStravaDisabled ? (
                  <div className="w-full">
                    <div className="w-full rounded-2xl border border-sage-20 bg-surface-2/30 px-4 py-4 opacity-60">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <FaStrava className="text-lg text-muted" />
                          <div className="text-left">
                            <p className="font-semibold text-muted">Strava</p>
                            <p className="text-xs text-muted">Temporarily unavailable</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-concrete mt-2 text-center px-2">
                      We're awaiting an athlete limit increase from Strava. You'll receive an email when connections are re-enabled.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectStrava}
                    className="w-full rounded-2xl border border-[#FC4C02]/50 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 px-4 py-4 transition text-left"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaStrava className="text-lg" style={{ color: '#FC4C02' }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">Strava</p>
                            <span className="text-xs bg-[#FC4C02]/20 text-[#FC4C02] px-2 py-0.5 rounded-full">Recommended</span>
                          </div>
                          <p className="text-xs text-muted">Import activities automatically</p>
                        </div>
                      </div>
                      <span className="text-xs" style={{ color: '#FC4C02' }}>Connect</span>
                    </div>
                  </button>
                )}

                {/* Garmin Connection */}
                {accounts.find((acc: { provider: string }) => acc.provider === 'garmin') ? (
                  <div className="w-full rounded-2xl border border-[#11A9ED]/50 bg-surface-2 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaMountain className="text-lg" style={{ color: '#11A9ED' }} />
                        <div className="text-left">
                          <p className="font-semibold">Garmin Connect</p>
                          <p className="text-xs text-success">Connected ✓</p>
                        </div>
                      </div>
                      <span className="text-xs text-success">Ready</span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectGarmin}
                    className="w-full rounded-2xl border border-[#11A9ED]/50 bg-[#11A9ED]/10 hover:bg-[#11A9ED]/20 px-4 py-4 transition text-left"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <FaMountain className="text-lg" style={{ color: '#11A9ED' }} />
                        <div>
                          <p className="font-semibold">Garmin Connect</p>
                          <p className="text-xs text-muted">Import activities automatically</p>
                        </div>
                      </div>
                      <span className="text-xs" style={{ color: '#11A9ED' }}>Connect</span>
                    </div>
                  </button>
                )}

                {/* Coming Soon */}
                <div className="w-full rounded-2xl border border-app/30 bg-surface-2/50 px-4 py-4 opacity-60 cursor-not-allowed">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-left">
                      <p className="font-semibold text-muted">Coming Soon</p>
                      <p className="text-xs text-muted">Suunto, Coros, Whoop</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 7: Personalization (Optional) */}
          {currentStep === 7 && bikeId && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                    <FaCheck className="text-2xl text-green-400" />
                  </div>
                </div>
                <h2 className="text-3xl font-semibold text-white">You're All Set!</h2>
                <p className="text-muted max-w-lg mx-auto">
                  Your bike is ready for wear tracking. Want to personalize your experience?
                </p>
              </div>

              {/* Optional Actions */}
              <div className="grid gap-3 max-w-md mx-auto text-left">
                {/* 1. Import past rides (only if device connected) */}
                {hasConnectedDevice && (
                  <ImportRidesForm
                    connectedProviders={accounts
                      .filter((a: { provider: string }) =>
                        (a.provider === 'strava' && !isStravaDisabled) || a.provider === 'garmin'
                      )
                      .map((a: { provider: string }) => a.provider as 'strava' | 'garmin')}
                  />
                )}

                {/* 2. Log Service History - inline form */}
                <ServiceHistoryForm bikeId={bikeId} />

                {/* 3. Edit bike components */}
                <button
                  onClick={() => navigate(`/gear/${bikeId}`)}
                  className="w-full p-4 rounded-lg border-2 border-app hover:border-accent/50 hover:bg-surface-hover text-left transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                      <FaCog className="text-accent" />
                    </div>
                    <div className="flex-1">
                      <span className="font-medium text-primary">Edit bike components</span>
                      <div className="text-sm text-muted">Update component details if you've swapped parts</div>
                    </div>
                  </div>
                </button>
              </div>

              {/* Primary CTA */}
              <Button onClick={handleGoToDashboard} variant="primary" className="w-full max-w-md">
                Go to Dashboard
              </Button>
            </div>
          )}

          {/* Navigation Buttons */}
          {currentStep !== 1 && currentStep !== 7 && (
          <div className="flex gap-4 pt-6">
            {currentStep > 1 && currentStep !== 6 && (
              <Button
                onClick={handleBack}
                variant="secondary"
                className="flex-1"
                disabled={isLoading}
              >
                Back
              </Button>
            )}
            {currentStep < 6 ? (
              <Button
                onClick={handleNext}
                variant="primary"
                className="flex-1"
                disabled={isLoading || (currentStep === 4 && !isBikeDataValid())}
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
                  {loadingState === 'idle' && 'Continue'}
                  {loadingState === 'saving' && 'Saving bike...'}
                  {loadingState === 'syncing' && 'Syncing...'}
                  {loadingState === 'redirecting' && 'Redirecting...'}
                </Button>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
