import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { PreferencesProvider } from './PreferencesProvider';
import { usePreferences } from '../hooks/usePreferences';

// Mock useViewer to avoid Apollo Client dependency
vi.mock('../graphql/me', () => ({
  useViewer: () => ({ viewer: null, loading: false, error: null, refetch: vi.fn() }),
}));

// Mock localStorage is set up in test/setup.ts
const mockLocalStorage = window.localStorage as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};

describe('PreferencesProvider', () => {
  beforeEach(() => {
    mockLocalStorage.getItem.mockReset();
    mockLocalStorage.setItem.mockReset();
  });

  describe('initialization', () => {
    it('defaults hoursDisplay to "total" when localStorage is empty', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const { result } = renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      expect(result.current.hoursDisplay).toBe('total');
    });

    it('reads hoursDisplay from localStorage on init', () => {
      mockLocalStorage.getItem.mockReturnValue('remaining');

      const { result } = renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      expect(result.current.hoursDisplay).toBe('remaining');
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('loam-hours-display');
    });

    it('ignores invalid localStorage values, defaults to "total"', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid-value');

      const { result } = renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      expect(result.current.hoursDisplay).toBe('total');
    });
  });

  describe('state updates', () => {
    it('setHoursDisplay updates state', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const { result } = renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      expect(result.current.hoursDisplay).toBe('total');

      act(() => {
        result.current.setHoursDisplay('remaining');
      });

      expect(result.current.hoursDisplay).toBe('remaining');
    });

    it('setHoursDisplay persists to localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const { result } = renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      act(() => {
        result.current.setHoursDisplay('remaining');
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'loam-hours-display',
        'remaining'
      );
    });

    it('uses correct localStorage key "loam-hours-display"', () => {
      mockLocalStorage.getItem.mockReturnValue('total');

      renderHook(() => usePreferences(), {
        wrapper: PreferencesProvider,
      });

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('loam-hours-display');
    });
  });

  describe('context', () => {
    it('provides value to children', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      function TestComponent() {
        const { hoursDisplay } = usePreferences();
        return <div data-testid="value">{hoursDisplay}</div>;
      }

      render(
        <PreferencesProvider>
          <TestComponent />
        </PreferencesProvider>
      );

      expect(screen.getByTestId('value')).toHaveTextContent('total');
    });

    it('usePreferences throws when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => usePreferences());
      }).toThrow('usePreferences must be used within a PreferencesProvider');

      consoleSpy.mockRestore();
    });
  });
});
