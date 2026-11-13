import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
if (import.meta.env.DEV && window.location.pathname === '/replay') {
  void import('./replay/ReplayInspector').then(({ ReplayInspector }) => {
    createRoot(root).render(
      <StrictMode>
        <ReplayInspector />
      </StrictMode>,
    );
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
