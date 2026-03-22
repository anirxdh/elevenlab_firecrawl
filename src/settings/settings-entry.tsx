import React from 'react';
import { createRoot } from 'react-dom/client';
import Settings from './Settings';
import '../content/content.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Settings />);
}
