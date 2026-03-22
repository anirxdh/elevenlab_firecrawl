import React from 'react';
import { createRoot } from 'react-dom/client';
import Welcome from './Welcome';
import '../content/content.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Welcome />);
}
