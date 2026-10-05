import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TenantBootstrap } from './TenantBootstrap.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import './index.css';

const tenantMatch = window.location.pathname.match(/^\/t\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
const tenantSlug = tenantMatch?.[1]?.toLowerCase();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tenantSlug ? <TenantBootstrap slug={tenantSlug} /> : <LandingPage />}
  </StrictMode>
);
