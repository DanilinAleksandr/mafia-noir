import '@fontsource/playfair-display/cyrillic-700.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/cyrillic-400-italic.css';
import '@fontsource-variable/manrope/wght.css';
import '@fontsource/amatic-sc/cyrillic-700.css';
import '@fontsource/amatic-sc/latin-700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
