import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react';
import './index.css'
import App from './App';
import { ApolloProvider } from '@apollo/client';
import { ThemeProvider } from './providers/ThemeProvider';
import { PreferencesProvider } from './providers/PreferencesProvider';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { inject } from '@vercel/analytics';
import client from './lib/apolloClient';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.05,
  enabled: import.meta.env.PROD,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID!}>
    <ApolloProvider client={client}>
      <ThemeProvider>
        <PreferencesProvider>
          <Sentry.ErrorBoundary fallback={
            <div className="min-h-screen bg-app flex items-center justify-center px-6">
              <div className="text-center max-w-md">
                <h1 className="text-2xl font-bold text-cream mb-3">Something went wrong</h1>
                <p className="text-muted mb-6">An unexpected error occurred. Please refresh the page to try again.</p>
                <button onClick={() => window.location.reload()} className="btn-primary px-6 py-3">
                  Refresh Page
                </button>
              </div>
            </div>
          }>
            <App />
          </Sentry.ErrorBoundary>
        </PreferencesProvider>
      </ThemeProvider>
    </ApolloProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
inject();
