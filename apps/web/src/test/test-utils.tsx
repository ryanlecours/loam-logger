/* eslint-disable react-refresh/only-export-components */
import { render, type RenderOptions } from '@testing-library/react';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { MemoryRouter } from 'react-router-dom';
import { PreferencesProvider } from '../providers/PreferencesProvider';
import type { ReactElement, ReactNode } from 'react';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  mocks?: MockedResponse[];
  route?: string;
}

function AllProviders({ children, mocks = [], route = '/' }: {
  children: ReactNode;
  mocks?: MockedResponse[];
  route?: string;
}) {
  return (
    <MockedProvider mocks={mocks} addTypename={false}>
      <MemoryRouter initialEntries={[route]}>
        <PreferencesProvider>
          {children}
        </PreferencesProvider>
      </MemoryRouter>
    </MockedProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  { mocks = [], route = '/', ...options }: RenderWithProvidersOptions = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders mocks={mocks} route={route}>
        {children}
      </AllProviders>
    ),
    ...options,
  });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { renderWithProviders as render };
