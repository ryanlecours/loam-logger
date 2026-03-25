import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Mock lucide-react - returns a proxy that creates SVG stubs for any icon import
vi.mock('lucide-react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (name: string) =>
    function MockIcon(props: Record<string, unknown>) {
      return React.createElement('svg', {
        'data-testid': `${name}-icon`,
        xmlns: 'http://www.w3.org/2000/svg',
        ...props,
      });
    };
  return new Proxy(
    {},
    { get: (_target, name: string) => createIcon(name) }
  );
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Export for use in tests
export { localStorageMock };

// Reset mocks between tests
beforeEach(() => {
  localStorageMock.getItem.mockReset();
  localStorageMock.setItem.mockReset();
  localStorageMock.removeItem.mockReset();
  localStorageMock.clear.mockReset();
});
