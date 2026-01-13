import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { BIKES } from '../graphql/bikes';
import { ADD_BIKE } from '../graphql/gear';
import { CREATE_STRAVA_GEAR_MAPPING } from '../graphql/stravaGear';
import { Modal, Select, Button, Input } from './ui';
import { getAuthHeaders } from '@/lib/csrf';

type UnmappedGear = {
  gearId: string;
  gearName?: string | null;
  rideCount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  unmappedGears: UnmappedGear[];
  trigger: 'import' | 'webhook' | 'settings';
};

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

type SpokesSearchResult = {
  id: string;
  maker: string;
  model: string;
  year: number;
  family: string;
  category: string;
  subcategory: string | null;
};

const SNOOZE_KEY = 'loam-strava-mapping-snoozed';

export default function StravaGearMappingModal({
  open,
  onClose,
  onSuccess,
  unmappedGears,
  trigger,
}: Props) {
  const [currentGearIndex, setCurrentGearIndex] = useState(0);
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [gearNames, setGearNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState(() => localStorage.getItem(SNOOZE_KEY) === 'true');
  const [isFetchingGearName, setIsFetchingGearName] = useState(false);

  // Track which gear IDs we've already fetched to prevent infinite re-renders
  const fetchedGearIds = useRef(new Set<string>());

  // Create new bike state
  const [showCreateBike, setShowCreateBike] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SpokesSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSpokesBike, setSelectedSpokesBike] = useState<SpokesSearchResult | null>(null);

  const { data: bikesData, refetch: refetchBikes } = useQuery(BIKES);
  const [createMapping, { loading: creatingMapping }] = useMutation(CREATE_STRAVA_GEAR_MAPPING);
  const [addBike, { loading: creatingBike }] = useMutation(ADD_BIKE);

  const bikes: Bike[] = bikesData?.bikes || [];
  const currentGear = unmappedGears[currentGearIndex];

  useEffect(() => {
    if (!open) {
      setCurrentGearIndex(0);
      setSelectedBikeId('');
      setGearNames({});
      setError(null);
      setShowCreateBike(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);
      fetchedGearIds.current.clear();
    }
  }, [open]);

  // Fetch gear names from Strava API
  useEffect(() => {
    if (open && currentGear && !fetchedGearIds.current.has(currentGear.gearId)) {
      fetchedGearIds.current.add(currentGear.gearId);
      fetchGearName(currentGear.gearId);
    }
  }, [open, currentGear]);

  // Pre-fill search query when entering create mode
  useEffect(() => {
    if (showCreateBike && currentGear) {
      const gearName = gearNames[currentGear.gearId] || '';
      setSearchQuery(gearName);
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);
    }
  }, [showCreateBike, currentGear, gearNames]);

  const fetchGearName = async (gearId: string) => {
    setIsFetchingGearName(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/strava/gear/${gearId}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setGearNames((prev) => ({
          ...prev,
          [gearId]: data.name || gearId,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch gear name:', err);
    } finally {
      setIsFetchingGearName(false);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.length < 3) {
      setError('Please enter at least 3 characters to search');
      return;
    }

    setIsSearching(true);
    setError(null);
    setSelectedSpokesBike(null);

    try {
      const params = new URLSearchParams({ q: searchQuery });
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/spokes/search?${params}`,
        {
          credentials: 'include',
          headers: getAuthHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSearchResults(data.bikes || []);
      setHasSearched(true);
    } catch (err) {
      console.error('Bike search error:', err);
      setError('Search unavailable. Please try again.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapBike = async () => {
    if (!selectedBikeId || !currentGear) return;

    setError(null);
    try {
      await createMapping({
        variables: {
          input: {
            stravaGearId: currentGear.gearId,
            stravaGearName: gearNames[currentGear.gearId] || null,
            bikeId: selectedBikeId,
          },
        },
      });

      // Move to next gear or close if done
      if (currentGearIndex < unmappedGears.length - 1) {
        setCurrentGearIndex(currentGearIndex + 1);
        setSelectedBikeId('');
      } else {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping');
    }
  };

  const handleCreateAndMap = async () => {
    if (!selectedSpokesBike || !currentGear) {
      setError('Please select a bike from the search results');
      return;
    }

    setError(null);
    try {
      // Create the bike using 99spokes data
      const bikeResult = await addBike({
        variables: {
          input: {
            manufacturer: selectedSpokesBike.maker,
            model: selectedSpokesBike.model,
            year: selectedSpokesBike.year,
            spokesId: selectedSpokesBike.id,
          },
        },
      });

      const newBikeId = bikeResult.data?.addBike?.id;
      if (!newBikeId) {
        throw new Error('Failed to create bike');
      }

      // Refetch bikes list
      await refetchBikes();

      // Now create the mapping
      await createMapping({
        variables: {
          input: {
            stravaGearId: currentGear.gearId,
            stravaGearName: gearNames[currentGear.gearId] || null,
            bikeId: newBikeId,
          },
        },
      });

      // Reset create form
      setShowCreateBike(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);

      // Move to next gear or close if done
      if (currentGearIndex < unmappedGears.length - 1) {
        setCurrentGearIndex(currentGearIndex + 1);
        setSelectedBikeId('');
      } else {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bike and mapping');
    }
  };

  const handleSkip = () => {
    if (currentGearIndex < unmappedGears.length - 1) {
      setCurrentGearIndex(currentGearIndex + 1);
      setSelectedBikeId('');
      setShowCreateBike(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);
    } else {
      onClose();
    }
  };

  const handleSnoozeChange = (checked: boolean) => {
    setSnoozed(checked);
    if (checked) {
      localStorage.setItem(SNOOZE_KEY, 'true');
    } else {
      localStorage.removeItem(SNOOZE_KEY);
    }
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '__create_new__') {
      setShowCreateBike(true);
      setSelectedBikeId('');
      setSelectedSpokesBike(null);
    } else {
      setShowCreateBike(false);
      setSelectedBikeId(value);
      setSelectedSpokesBike(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  if (!currentGear) return null;

  const gearDisplayName = gearNames[currentGear.gearId] || currentGear.gearId;
  const isLoading = creatingMapping || creatingBike;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Map Strava Bikes"
      subtitle={trigger === 'import'
        ? 'Your Strava import includes bikes that need to be mapped to your Loam Logger bikes.'
        : trigger === 'settings'
        ? 'Map your Strava bikes to Loam Logger bikes to track component hours.'
        : 'New rides from Strava include bikes that need to be mapped to your Loam Logger bikes.'}
      size="lg"
    >
      <div className="mb-6">
        <p className="text-sm text-muted">
          Progress: {currentGearIndex + 1} of {unmappedGears.length}
        </p>
      </div>

      <div className="bg-highlight/30 border border-app rounded-2xl p-4 mb-6">
        <h3 className="text-lg font-semibold text-white mb-2">
          Strava Bike: {isFetchingGearName ? (
            <span className="inline-block w-32 h-5 bg-surface-2 rounded animate-pulse" />
          ) : gearDisplayName}
        </h3>
        <p className="text-sm text-muted">
          Used in {currentGear.rideCount} {currentGear.rideCount === 1 ? 'ride' : 'rides'}
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200">
          {error}
        </div>
      )}

      {!showCreateBike ? (
        <Select
          label="Map to Loam Logger Bike"
          value={selectedBikeId}
          onChange={handleSelectChange}
          containerClassName="mb-6"
        >
          <option value="">Select a bike...</option>
          {bikes.map((bike) => (
            <option key={bike.id} value={bike.id}>
              {bike.nickname || `${bike.manufacturer} ${bike.model}`}
            </option>
          ))}
          <option disabled>──────────────</option>
          <option value="__create_new__">+ Create New Bike...</option>
        </Select>
      ) : (
        <div className="mb-6 space-y-4">
          <p className="text-sm font-semibold text-white">Create New Bike</p>

          {/* Search input with button */}
          <div className="space-y-2">
            <label id="bike-search-label" className="label-muted block">Search for your bike</label>
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Trek Slash 2024"
                containerClassName="flex-1"
                aria-labelledby="bike-search-label"
                aria-describedby="bike-search-hint"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSearch}
                disabled={isSearching || searchQuery.length < 3}
                aria-label="Search for bike"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>
            <p id="bike-search-hint" className="text-xs text-muted">Search by brand, model, or year. Press Enter to search.</p>
          </div>

          {/* Search results */}
          {hasSearched && searchResults.length > 0 && (
            <div
              role="listbox"
              aria-label="Bike search results"
              className="max-h-48 overflow-auto rounded-lg bg-surface-2 border border-app"
            >
              {searchResults.map((bike) => (
                <button
                  key={bike.id}
                  type="button"
                  role="option"
                  aria-selected={selectedSpokesBike?.id === bike.id}
                  aria-label={`${bike.year} ${bike.maker} ${bike.model}, ${bike.category}`}
                  onClick={() => {
                    setSelectedSpokesBike(bike);
                    setError(null);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-surface-3 transition-colors ${
                    selectedSpokesBike?.id === bike.id ? 'bg-surface-3 border-l-2 border-primary' : ''
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium text-heading">{bike.maker}</span>{' '}
                      <span className="text-muted">{bike.model}</span>
                    </div>
                    <span className="text-sm text-muted">{bike.year}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 capitalize">
                    {bike.category}
                    {bike.subcategory && ` / ${bike.subcategory.replace(/-/g, ' ')}`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* No results message */}
          {hasSearched && searchResults.length === 0 && !isSearching && (
            <div className="rounded-lg bg-surface-2 border border-app p-3">
              <p className="text-sm text-muted">
                No bikes found for "{searchQuery}". Try a different search term.
              </p>
            </div>
          )}

          {/* Selected bike preview */}
          {selectedSpokesBike && (
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
              <p className="text-sm text-muted mb-1">Selected bike:</p>
              <p className="font-semibold text-white">
                {selectedSpokesBike.year} {selectedSpokesBike.maker} {selectedSpokesBike.model}
              </p>
              <p className="text-xs text-muted mt-1 capitalize">
                {selectedSpokesBike.category}
                {selectedSpokesBike.subcategory && ` / ${selectedSpokesBike.subcategory.replace(/-/g, ' ')}`}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setShowCreateBike(false);
              setSearchQuery('');
              setSearchResults([]);
              setHasSearched(false);
              setSelectedSpokesBike(null);
            }}
            aria-label="Go back to bike selection"
            className="text-sm text-muted hover:text-white transition"
          >
            ← Back to bike selection
          </button>
        </div>
      )}

      {/* Snooze checkbox - only show for import/webhook triggers */}
      {trigger !== 'settings' && (
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={snoozed}
            onChange={(e) => handleSnoozeChange(e.target.checked)}
            className="rounded border-app bg-surface-2"
          />
          Don't show this again (access from Settings)
        </label>
      )}

      <div className="flex gap-3 justify-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSkip}
          disabled={isLoading}
        >
          {currentGearIndex < unmappedGears.length - 1 ? 'Skip for Now' : 'Done'}
        </Button>
        {showCreateBike ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateAndMap}
            disabled={!selectedSpokesBike || isLoading}
          >
            {isLoading ? 'Creating...' : 'Create & Map'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleMapBike}
            disabled={!selectedBikeId || isLoading}
          >
            {isLoading ? 'Mapping...' : 'Map Bike'}
          </Button>
        )}
      </div>

      <div className="mt-4 text-sm text-muted">
        <p>
          Mapping this bike will automatically assign all past rides with this Strava bike
          to your Loam Logger bike and update component hours.
        </p>
      </div>
    </Modal>
  );
}
