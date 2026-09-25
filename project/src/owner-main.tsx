import React from 'react';
import ReactDOM from 'react-dom/client';
import { OwnerConsole } from '@/owner/OwnerConsole';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><OwnerConsole /></React.StrictMode>,
);
