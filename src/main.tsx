import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import WorkspaceApp from './workspace/WorkspaceApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/workspace' || window.location.pathname.startsWith('/workspace/') ? <WorkspaceApp /> : <App />}
  </StrictMode>,
);
