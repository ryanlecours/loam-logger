import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Mock lucide-react - creates SVG stubs for any icon import
vi.mock('lucide-react', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const original = await importOriginal<Record<string, unknown>>();
  const createIcon = (name: string) =>
    function MockIcon(props: Record<string, unknown>) {
      return React.createElement('svg', {
        'data-testid': `${name}-icon`,
        xmlns: 'http://www.w3.org/2000/svg',
        ...props,
      });
    };
  // Replace every export that looks like a component (PascalCase) with a mock
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(original)) {
    mocked[key] = /^[A-Z]/.test(key) ? createIcon(key) : original[key];
  }
  return mocked;
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
