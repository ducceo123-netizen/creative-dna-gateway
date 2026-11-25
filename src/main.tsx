import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import UidOAuthConsent from './oauth-consent.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname==='/oauth/consent'?<UidOAuthConsent/>:<App />}
  </StrictMode>,
);
