import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Mode B (room video -> 3D) is a separate dashboard at /mode-b, loaded only there; every other path is Mode A.
const ModeBApp = React.lazy(() => import('./mode_b/ModeBApp.jsx'))
const modeB = /^\/mode-b(\/|$)/.test(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {modeB ? <React.Suspense fallback={null}><ModeBApp /></React.Suspense> : <App />}
  </React.StrictMode>,
)
