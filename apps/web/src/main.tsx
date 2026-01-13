import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App';
import { ApolloProvider } from '@apollo/client';
import { ThemeProvider } from './providers/ThemeProvider';
import { PreferencesProvider } from './providers/PreferencesProvider';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { inject } from '@vercel/analytics';
import client from './lib/apolloClient';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID!}>
    <ApolloProvider client={client}>
      <ThemeProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </ThemeProvider>
    </ApolloProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
inject();
