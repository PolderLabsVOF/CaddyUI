import { createRoot } from 'react-dom/client';
import React from 'react';
import './monacoSetup.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
