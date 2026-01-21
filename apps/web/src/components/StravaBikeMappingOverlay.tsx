import { useState, useEffect, useRef, useMemo, type ReactElement } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { FaTrash, FaPlus, FaExchangeAlt } from 'react-icons/fa';
import { BIKES } from '../graphql/bikes';
import { ADD_BIKE } from '../graphql/gear';
import {
  STRAVA_GEAR_MAPPINGS,
  UNMAPPED_STRAVA_GEARS,
  CREATE_STRAVA_GEAR_MAPPING,
  DELETE_STRAVA_GEAR_MAPPING,
} from '../graphql/stravaGear';
import { Modal, Select, Button, Input } from './ui';
import { getBikeName } from '../utils/formatters';
import { getAuthHeaders } from '@/lib/csrf';

type StravaGearMapping = {
  id: string;
  stravaGearId: string;
  stravaGearName: string | null;
  bikeId: string;
  bike: {
    id: string;
    nickname: string | null;
    manufacturer: string;
    model: string;
  };
  createdAt: string;
};

type UnmappedGear = {
  gearId: string;
  gearName?: string | null;
  rideCount: number;
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

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export default function StravaBikeMappingOverlay({ open, onClose, onSuccess }: Props): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Mapping state for unmapped gear
  const [mappingGearId, setMappingGearId] = useState<string | null>(null);
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [gearNames, setGearNames] = useState<Record<string, string>>({});
  const fetchedGearIds = useRef(new Set<string>());

  // Create new bike state
  const [showCreateBike, setShowCreateBike] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SpokesSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSpokesBike, setSelectedSpokesBike] = useState<SpokesSearchResult | null>(null);

  // Remapping state (for changing an existing mapping)
  const [remappingId, setRemappingId] = useState<string | null>(null);
  const [remappingBikeId, setRemappingBikeId] = useState<string>('');

  const { data: bikesData, refetch: refetchBikes } = useQuery(BIKES);
  const { data: mappingsData, refetch: refetchMappings } = useQuery(STRAVA_GEAR_MAPPINGS, {
    skip: !open,
    fetchPolicy: 'cache-and-network',
  });
  const { data: unmappedData, refetch: refetchUnmapped } = useQuery(UNMAPPED_STRAVA_GEARS, {
    skip: !open,
    fetchPolicy: 'cache-and-network',
  });

  const [createMapping, { loading: creatingMapping }] = useMutation(CREATE_STRAVA_GEAR_MAPPING);
  const [deleteMapping, { loading: deletingMapping }] = useMutation(DELETE_STRAVA_GEAR_MAPPING);
  const [addBike, { loading: creatingBike }] = useMutation(ADD_BIKE);

  const bikes: Bike[] = bikesData?.bikes || [];
  const mappings: StravaGearMapping[] = mappingsData?.stravaGearMappings || [];
  const unmappedGears = useMemo<UnmappedGear[]>(
    () => unmappedData?.unmappedStravaGears || [],
    [unmappedData?.unmappedStravaGears]
  );

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setMappingGearId(null);
      setSelectedBikeId('');
      setError(null);
      setSuccessMessage(null);
      setShowCreateBike(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);
      setRemappingId(null);
      setRemappingBikeId('');
      fetchedGearIds.current.clear();
    }
  }, [open]);

  // Fetch gear names for unmapped gears
  useEffect(() => {
    if (open && unmappedGears.length > 0) {
      unmappedGears.forEach((gear) => {
        if (!fetchedGearIds.current.has(gear.gearId)) {
          fetchedGearIds.current.add(gear.gearId);
          fetchGearName(gear.gearId);
        }
      });
    }
  }, [open, unmappedGears]);

  const fetchGearName = async (gearId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/strava/gear/${gearId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setGearNames((prev) => ({
          ...prev,
          [gearId]: data.name || gearId,
        }));
      }
    } catch {
      // Silently fail - will show gearId as fallback
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
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/spokes/search?${params}`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSearchResults(data.bikes || []);
      setHasSearched(true);
    } catch {
      setError('Search unavailable. Please try again.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapGear = async () => {
    if (!selectedBikeId || !mappingGearId) return;

    setError(null);
    try {
      await createMapping({
        variables: {
          input: {
            stravaGearId: mappingGearId,
            stravaGearName: gearNames[mappingGearId] || null,
            bikeId: selectedBikeId,
          },
        },
      });

      setSuccessMessage('Bike mapped successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
      setMappingGearId(null);
      setSelectedBikeId('');
      await refetchMappings();
      await refetchUnmapped();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping');
    }
  };

  const handleCreateAndMap = async () => {
    if (!selectedSpokesBike || !mappingGearId) {
      setError('Please select a bike from the search results');
      return;
    }

    setError(null);
    try {
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

      await refetchBikes();

      await createMapping({
        variables: {
          input: {
            stravaGearId: mappingGearId,
            stravaGearName: gearNames[mappingGearId] || null,
            bikeId: newBikeId,
          },
        },
      });

      setSuccessMessage('Bike created and mapped successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
      setMappingGearId(null);
      setShowCreateBike(false);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
      setSelectedSpokesBike(null);
      await refetchMappings();
      await refetchUnmapped();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bike and mapping');
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    if (!confirm('Remove this mapping? Rides will keep their bike assignment but future Strava syncs will not auto-assign.')) {
      return;
    }

    setError(null);
    try {
      await deleteMapping({ variables: { id: mappingId } });
      setSuccessMessage('Mapping removed');
      setTimeout(() => setSuccessMessage(null), 3000);
      await refetchMappings();
      await refetchUnmapped();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mapping');
    }
  };

  const handleStartRemap = (mapping: StravaGearMapping) => {
    setRemappingId(mapping.id);
    setRemappingBikeId(mapping.bikeId);
  };

  const handleCancelRemap = () => {
    setRemappingId(null);
    setRemappingBikeId('');
  };

  const handleSaveRemap = async (mapping: StravaGearMapping) => {
    if (!remappingBikeId || remappingBikeId === mapping.bikeId) {
      handleCancelRemap();
      return;
    }

    setError(null);
    try {
      // Delete old mapping
      await deleteMapping({ variables: { id: mapping.id } });
      // Create new mapping
      await createMapping({
        variables: {
          input: {
            stravaGearId: mapping.stravaGearId,
            stravaGearName: mapping.stravaGearName,
            bikeId: remappingBikeId,
          },
        },
      });

      setSuccessMessage('Mapping updated successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
      setRemappingId(null);
      setRemappingBikeId('');
      await refetchMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mapping');
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

  const isLoading = creatingMapping || deletingMapping || creatingBike;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Strava Bike Mappings"
      subtitle="Connect your Strava bikes to Loam Logger bikes for automatic ride assignment"
      size="lg"
    >
      <div className="space-y-6">
        {/* Success/Error Messages */}
        {successMessage && (
          <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-xl text-green-200 text-sm">
            {successMessage}
          </div>
        )}
        {error && (
          <div role="alert" className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Existing Mappings */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Current Mappings</h3>
          {mappings.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center bg-surface-2 rounded-xl border border-app">
              No bike mappings yet. Map your Strava bikes below.
            </p>
          ) : (
            <div className="space-y-2">
              {mappings.map((mapping) => (
                <div
                  key={mapping.id}
                  className="flex items-center justify-between gap-3 p-3 bg-surface-2 rounded-xl border border-app"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {mapping.stravaGearName || mapping.stravaGearId}
                    </p>
                    <p className="text-xs text-muted">Strava Bike</p>
                  </div>
                  <div className="text-muted">→</div>
                  <div className="flex-1 min-w-0">
                    {remappingId === mapping.id ? (
                      <Select
                        value={remappingBikeId}
                        onChange={(e) => setRemappingBikeId(e.target.value)}
                        containerClassName="mb-0"
                      >
                        {bikes.map((bike) => (
                          <option key={bike.id} value={bike.id}>
                            {getBikeName(bike)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-white truncate">
                          {getBikeName(mapping.bike)}
                        </p>
                        <p className="text-xs text-muted">Loam Logger Bike</p>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {remappingId === mapping.id ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCancelRemap}
                          disabled={isLoading}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleSaveRemap(mapping)}
                          disabled={isLoading || remappingBikeId === mapping.bikeId}
                        >
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartRemap(mapping)}
                          className="p-2 text-muted hover:text-white hover:bg-surface-3 rounded-lg transition"
                          aria-label="Change mapping"
                          title="Change mapping"
                        >
                          <FaExchangeAlt size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteMapping(mapping.id)}
                          className="p-2 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                          aria-label="Remove mapping"
                          title="Remove mapping"
                        >
                          <FaTrash size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Unmapped Gears */}
        {unmappedGears.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">
              Unmapped Strava Bikes
              <span className="ml-2 text-amber-400 font-normal">
                ({unmappedGears.length} need mapping)
              </span>
            </h3>
            <div className="space-y-2">
              {unmappedGears.map((gear) => (
                <div
                  key={gear.gearId}
                  className="p-3 bg-surface-2 rounded-xl border border-amber-500/30"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {gearNames[gear.gearId] || gear.gearId}
                      </p>
                      <p className="text-xs text-muted">
                        {gear.rideCount} {gear.rideCount === 1 ? 'ride' : 'rides'} without bike assignment
                      </p>
                    </div>
                    {mappingGearId !== gear.gearId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setMappingGearId(gear.gearId);
                          setSelectedBikeId('');
                          setShowCreateBike(false);
                        }}
                      >
                        <FaPlus size={12} className="mr-1" />
                        Map
                      </Button>
                    )}
                  </div>

                  {/* Mapping Form */}
                  {mappingGearId === gear.gearId && (
                    <div className="mt-3 pt-3 border-t border-app space-y-3">
                      {!showCreateBike ? (
                        <Select
                          label="Select Loam Logger Bike"
                          value={selectedBikeId}
                          onChange={handleSelectChange}
                        >
                          <option value="">Select a bike...</option>
                          {bikes.map((bike) => (
                            <option key={bike.id} value={bike.id}>
                              {getBikeName(bike)}
                            </option>
                          ))}
                          <option disabled>──────────────</option>
                          <option value="__create_new__">+ Create New Bike...</option>
                        </Select>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm font-semibold text-white">Create New Bike</p>
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Search by brand/model (e.g. Trek Slash 2024)"
                                containerClassName="flex-1"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleSearch}
                                disabled={isSearching || searchQuery.length < 3}
                              >
                                {isSearching ? 'Searching...' : 'Search'}
                              </Button>
                            </div>
                          </div>

                          {hasSearched && searchResults.length > 0 && (
                            <div className="max-h-40 overflow-auto rounded-lg bg-surface-3 border border-app">
                              {searchResults.map((bike) => (
                                <button
                                  key={bike.id}
                                  type="button"
                                  onClick={() => setSelectedSpokesBike(bike)}
                                  className={`w-full px-3 py-2 text-left hover:bg-highlight/20 transition-colors ${
                                    selectedSpokesBike?.id === bike.id ? 'bg-highlight/30 border-l-2 border-primary' : ''
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="font-medium text-heading">{bike.maker} {bike.model}</span>
                                    <span className="text-sm text-muted">{bike.year}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}

                          {hasSearched && searchResults.length === 0 && !isSearching && (
                            <p className="text-sm text-muted">No bikes found. Try a different search.</p>
                          )}

                          {selectedSpokesBike && (
                            <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                              <p className="text-sm text-muted">Selected:</p>
                              <p className="font-medium text-white">
                                {selectedSpokesBike.year} {selectedSpokesBike.maker} {selectedSpokesBike.model}
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
                            className="text-sm text-muted hover:text-white transition"
                          >
                            ← Back to bike selection
                          </button>
                        </div>
                      )}

                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setMappingGearId(null);
                            setSelectedBikeId('');
                            setShowCreateBike(false);
                            setSearchQuery('');
                            setSearchResults([]);
                            setHasSearched(false);
                            setSelectedSpokesBike(null);
                          }}
                          disabled={isLoading}
                        >
                          Cancel
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
                            onClick={handleMapGear}
                            disabled={!selectedBikeId || isLoading}
                          >
                            {isLoading ? 'Mapping...' : 'Map Bike'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when all mapped */}
        {mappings.length > 0 && unmappedGears.length === 0 && (
          <div className="text-center py-4 text-sm text-muted">
            All your Strava bikes are mapped!
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
