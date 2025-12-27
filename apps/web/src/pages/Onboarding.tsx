import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery, gql } from '@apollo/client';
import { FaMountain } from 'react-icons/fa';
import { ME_QUERY } from '../graphql/me';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { MOUNTAIN_BIKE_BRANDS } from '../constants/bikeBrands';
import { BIKE_MODELS } from '../constants/bikeModels';
import { Button } from '@/components/ui';
import { getAuthHeaders } from '@/lib/csrf';

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

type OnboardingData = {
  age: number;
  location: string;
  bikeYear: number;
  bikeMake: string;
  bikeModel: string;
  bikeTravelFork?: number;
  bikeTravelShock?: number;
  components: {
    fork?: string;
    rearShock?: string;
    wheels?: string;
    dropperPost?: string;
  };
};

export default function Onboarding() {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const { user } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const { data: accountsData, refetch: refetchAccounts } = useQuery(CONNECTED_ACCOUNTS_QUERY);

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
      const response = await fetch(`${import.meta.env.VITE_API_URL}/onboarding/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
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

              <div className="space-y-4 text-left grid grid-cols-2 gap-4">
                <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                  Year
                  <input
                    type="number"
                    className="mt-2 w-full input-soft"
                    value={data.bikeYear}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        setData({ ...data, bikeYear: parsed });
                      }
                    }}
                  />
                </label>
                <label className="col-span-1 text-xs uppercase tracking-[0.3em] text-muted">
                  Make
                  <select
                    className="mt-2 w-full input-soft"
                    value={data.bikeMake}
                    onChange={(e) => setData({ ...data, bikeMake: e.target.value })}
                  >
                    <option value="">Select a brand</option>
                    {MOUNTAIN_BIKE_BRANDS.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 text-xs uppercase tracking-[0.3em] text-muted">
                  Model
                  <select
                    className="mt-2 w-full input-soft"
                    value={data.bikeModel}
                    onChange={(e) => setData({ ...data, bikeModel: (e.target.value === 'Select a model' ? '' : e.target.value )})}
                    disabled={!data.bikeMake}
                  >
                    <option value="">
                      {data.bikeMake ? 'Select a model' : 'Select a make first'}
                    </option>
                    {data.bikeMake && BIKE_MODELS[data.bikeMake]?.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

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
                <h2 className="text-3xl font-semibold text-white">What components does it have?</h2>
                <p className="text-muted">We'll track service intervals for each component</p>
              </div>

              <div className="space-y-4 text-left">
                <label className="text-xs uppercase tracking-[0.3em] text-muted">
                  Fork
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="RockShox Lyrik Ultimate"
                    value={data.components.fork}
                    onChange={(e) => setData({ ...data, components: { ...data.components, fork: e.target.value } })}
                  />
                </label>
                <label className="text-xs uppercase tracking-[0.3em] text-muted">
                  Rear Shock
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="Fox Float X2"
                    value={data.components.rearShock}
                    onChange={(e) => setData({ ...data, components: { ...data.components, rearShock: e.target.value } })}
                  />
                </label>
                <label className="text-xs uppercase tracking-[0.3em] text-muted">
                  Wheels
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="Industry Nine Enduro 305"
                    value={data.components.wheels}
                    onChange={(e) => setData({ ...data, components: { ...data.components, wheels: e.target.value } })}
                  />
                </label>
                <label className="text-xs uppercase tracking-[0.3em] text-muted">
                  Dropper Post
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="PNW Loam"
                    value={data.components.dropperPost}
                    onChange={(e) => setData({ ...data, components: { ...data.components, dropperPost: e.target.value } })}
                  />
                </label>
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
