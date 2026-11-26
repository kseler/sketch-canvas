import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The base styles and design tokens first, so the components' own styles build on them.
import './styles/tokens.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
