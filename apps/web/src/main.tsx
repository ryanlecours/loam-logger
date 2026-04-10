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
  tracesSampleRate: 0.2,
  enabled: import.meta.env.PROD,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID!}>
    <ApolloProvider client={client}>
      <ThemeProvider>
        <PreferencesProvider>
          <Sentry.ErrorBoundary fallback={<div style={{ padding: 40, textAlign: 'center' }}>Something went wrong. Please refresh the page.</div>}>
            <App />
          </Sentry.ErrorBoundary>
        </PreferencesProvider>
      </ThemeProvider>
    </ApolloProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
inject();
