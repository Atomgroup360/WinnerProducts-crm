import React from 'react';
import ReactDOM from 'react-dom/client';
// Importamos el código de nuestra app principal
import App from './App.jsx';

// Le decimos a React que renderice la app dentro del elemento <div id="root"> en index.html
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
