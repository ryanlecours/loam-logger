import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppRouter from './Router';
import { ApolloProvider } from '@apollo/client';
import client from './lib/apolloClient';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={client}>
      <AppRouter />
    </ApolloProvider>
  </StrictMode>,
)
