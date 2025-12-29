import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuthHeaders } from '@/lib/csrf';

export interface SpokesSearchResult {
  id: string;
  maker: string;
  model: string;
  year: number;
  family: string;
  category: string;
  subcategory: string | null;
}

interface BikeSearchProps {
  onSelect: (bike: SpokesSearchResult) => void;
  initialValue?: string;
  placeholder?: string;
  label?: string;
  hint?: string;
  className?: string;
}

export function BikeSearch({
  onSelect,
  initialValue = '',
  placeholder = 'Search bikes (e.g., "Trek Slash 2024")',
  label,
  hint,
  className = '',
}: BikeSearchProps) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<SpokesSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setError(null);

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
      setResults(data.bikes || []);
      setIsOpen(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Bike search error:', err);
      setError('Search unavailable. Enter bike details manually below.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle input change with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      search(value);
    }, 300);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  // Handle selection
  const handleSelect = (bike: SpokesSearchResult) => {
    setQuery(`${bike.year} ${bike.maker} ${bike.model}`);
    setIsOpen(false);
    onSelect(bike);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Format category for display
  const formatCategory = (category: string, subcategory: string | null) => {
    if (subcategory) {
      return `${category} / ${subcategory.replace(/-/g, ' ')}`;
    }
    return category;
  };

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="label-muted block mb-2">{label}</label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="input-soft w-full"
          autoComplete="off"
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-amber-400 mt-1">{error}</p>
      )}

      {hint && !error && (
        <p className="text-xs text-muted mt-1">{hint}</p>
      )}

      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 max-h-64 overflow-auto rounded-lg bg-surface-2 border border-app shadow-lg"
        >
          {results.map((bike, index) => (
            <button
              key={bike.id}
              type="button"
              onClick={() => handleSelect(bike)}
              className={`w-full px-3 py-2 text-left hover:bg-surface-3 transition-colors ${
                index === selectedIndex ? 'bg-surface-3' : ''
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
                {formatCategory(bike.category, bike.subcategory)}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.length >= 2 && !isLoading && !error && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-2 border border-app shadow-lg p-3">
          <p className="text-sm text-muted">
            No bikes found. Enter details manually below.
          </p>
        </div>
      )}
    </div>
  );
}
