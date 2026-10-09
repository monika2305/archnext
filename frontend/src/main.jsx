import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const ModeBApp = React.lazy(() => import('./mode_b/ModeBApp.jsx'))
const LandingApp = React.lazy(() => import('./landing/App.tsx'))

function getRoute(pathname) {
  if (/^\/mode-b(\/|$)/.test(pathname || '')) return 'mode-b'
  if (/^\/mode-a(\/|$)/.test(pathname || '')) return 'mode-a'
  if (pathname === '/' || pathname === '' || pathname === '/index.html') return 'landing'
  // Fallback for legacy Mode A routes (/upload, /analysis, /studio, etc.)
  return 'mode-a'
}

export function navigate(to) {
  if (`${window.location.pathname}${window.location.search}` !== to) {
    window.history.pushState(null, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function Root() {
  const [route, setRoute] = useState(() => getRoute(window.location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(getRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (route === 'mode-b') {
    return (
      <React.Suspense fallback={<div className="h-screen w-screen bg-paper flex items-center justify-center text-ink-soft text-sm">Loading Mode B...</div>}>
        <ModeBApp onHome={() => navigate('/')} onModeA={() => navigate('/mode-a')} />
      </React.Suspense>
    )
  }

  if (route === 'mode-a') {
    return <App onHome={() => navigate('/')} onModeB={() => navigate('/mode-b')} />
  }

  return (
    <React.Suspense fallback={<div className="h-screen w-screen bg-[#11110F] flex items-center justify-center text-[#E9E2D0] text-sm">Initializing ArchNext...</div>}>
      <LandingApp onNavigate={navigate} />
    </React.Suspense>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
