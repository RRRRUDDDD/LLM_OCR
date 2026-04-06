import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import { PagesProvider } from './stores/pagesStore';
import App from './App';

import './bootstrap';
import './i18n';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <StrictMode>
    <ErrorBoundary>
      <PagesProvider>
        <App />
      </PagesProvider>
    </ErrorBoundary>
  </StrictMode>
);
