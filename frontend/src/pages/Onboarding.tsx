import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { ME_QUERY } from '../graphql/me';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Button } from '@/components/ui';

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
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<OnboardingData>({
    age: 16,
    location: '',
    bikeYear: new Date().getFullYear(),
    bikeMake: '',
    bikeModel: '',
    components: {},
  });

  const firstName = user?.name?.split(' ')?.[0] || 'Rider';

  const handleNext = () => {
    // Validate age on step 1
    if (currentStep === 1) {
      if (!Number.isInteger(data.age) || data.age < 16 || data.age > 115) {
        setError('Age must be between 16 and 115');
        return;
      }
    }

    if (currentStep < 4) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to complete onboarding');
      }

      // Refetch user data to get updated onboardingCompleted status
      const { data: userData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data: userData });

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  const progressPercentage = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(0,60,30,0.6),_transparent),radial-gradient(circle_at_bottom,_rgba(0,20,10,0.8),_rgb(6,8,6))] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted">Step {currentStep} of 4</span>
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
        <div className="rounded-3xl panel-soft shadow-soft border border-app/80 p-8 space-y-6">
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
                    type="number"
                    className="mt-2 w-full input-soft"
                    value={data.age}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value);
                      setData({ ...data, age: Number.isNaN(parsed) ? 16 : parsed });
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
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="Propain"
                    value={data.bikeMake}
                    onChange={(e) => setData({ ...data, bikeMake: e.target.value })}
                  />
                </label>
                <label className="col-span-2 text-xs uppercase tracking-[0.3em] text-muted">
                  Model
                  <input
                    type="text"
                    className="mt-2 w-full input-soft"
                    placeholder="Tyee"
                    value={data.bikeModel}
                    onChange={(e) => setData({ ...data, bikeModel: e.target.value })}
                  />
                </label>
              </div>
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

          {/* Navigation Buttons */}
          <div className="flex gap-4 pt-6">
            {currentStep > 1 && (
              <Button
                onClick={handleBack}
                variant="secondary"
                className="flex-1"
                disabled={isLoading}
              >
                Back
              </Button>
            )}
            {currentStep < 4 ? (
              <Button
                onClick={handleNext}
                variant="primary"
                className="flex-1"
                disabled={isLoading}
              >
                Continue
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                variant="primary"
                className="flex-1"
                disabled={isLoading}
              >
                {isLoading ? 'Completing Setup...' : 'Complete Setup'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
