import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from './features/theme/theme.ts';
import { createAppRouter } from './router.ts';
import './index.css';

// Before the first render, so a theme chosen on this device does not flash the other one.
applyTheme();

const queryClient = new QueryClient();
const router = createAppRouter({ queryClient });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
