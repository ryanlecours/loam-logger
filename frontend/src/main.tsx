import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/theme.css'
import App from './App';
import { ApolloProvider } from '@apollo/client';
import client from './lib/apolloClient';
import { ThemeProvider } from './providers/ThemeProvider';
import { inject } from '@vercel/analytics';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={client}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ApolloProvider>
  </StrictMode>,
);
inject();
