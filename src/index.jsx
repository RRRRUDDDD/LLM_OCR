import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import { PagesProvider } from './stores/pagesStore';
import App from './App';

import './bootstrap';
import './i18n';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <ErrorBoundary>
      <PagesProvider>
        <App />
      </PagesProvider>
    </ErrorBoundary>
  </StrictMode>
);
