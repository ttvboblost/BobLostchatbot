import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

// Android builds can point the bundled dashboard at the separately hosted API.
setBaseUrl(import.meta.env.VITE_API_BASE_URL || null);

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
