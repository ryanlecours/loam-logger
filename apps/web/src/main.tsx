import "./instrument";

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react';
import './index.css'
import App from './App';
import { ApolloProvider } from '@apollo/client';
import { ThemeProvider } from './providers/ThemeProvider';
import { PreferencesProvider } from './providers/PreferencesProvider';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { inject } from '@vercel/analytics';
import client from './lib/apolloClient';
import { initPostHog } from './lib/posthog';
import { installChunkReloadHandler } from './lib/chunkReload';

initPostHog();
installChunkReloadHandler();

// The built index.html carries the prerendered landing page inside #root and,
// on any other path, a class that keeps it invisible (scripts/prerender-landing.mjs).
// Once React has committed its own tree the static markup is gone, so reveal.
function RevealAfterMount() {
  useEffect(() => {
    document.documentElement.classList.remove('lp-prerendered');
  }, []);
  return null;
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID!}>
      <ApolloProvider client={client}>
        <ThemeProvider>
          <PreferencesProvider>
            <App />
            <RevealAfterMount />
          </PreferencesProvider>
        </ThemeProvider>
      </ApolloProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
inject();
