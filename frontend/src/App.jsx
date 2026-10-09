import { useCallback, useEffect, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import UploadView from './views/UploadView.jsx'
import AnalysisView from './views/AnalysisView.jsx'
import StudioView from './views/StudioView.jsx'
import ValidationView from './views/ValidationView.jsx'
import Fix2BuildView from './views/Fix2BuildView.jsx'
import { validSelection } from './lib/planGeometry.js'
import { confirmDiscard, forgetTabPlan, lastPlan, rememberPlan, restoreOffers, saveState, tabPlan } from './lib/session.js'
import { api, REQUIRED_API_VERSION, STALE_BACKEND } from './lib/api.js'
import { AlertTriangle } from 'lucide-react'

// Browser storage can be unavailable (privacy modes); the app then simply does not remember the last plan.
const storage = (name) => { try { return window[name] } catch { return null } }
const local = storage('localStorage')
const tab = storage('sessionStorage')

export default function App({ onHome, onModeB }) {
  const [view, setView] = useState('upload')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('idle') // idle | processing | ready | error
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [configBusy, setConfigBusy] = useState(false)
  const [configError, setConfigError] = useState('')
  // Selection shared by every page (Analysis, 3D Studio, Fix2Build): { kind: 'room' | 'wall' | 'opening', id }
  const [selection, setSelection] = useState(null)
  // Saving: what the Fix2Build workspace has not committed yet, and the revision of the last downloaded file.
  const [pending, setPending] = useState(null)
  const [fileRevision, setFileRevision] = useState(null)
  // Reopening an autosaved plan: its id while loading, the plans on offer and a message if it failed.
  const [restoring, setRestoring] = useState(null)
  const [offers, setOffers] = useState([])
  const [restoreNote, setRestoreNote] = useState('')
  // API version of the running backend process; an older process lacks endpoints this interface calls.
  const [backend, setBackend] = useState(null)

  const save = saveState(result, pending, fileRevision)
  const saveRef = useRef(save)
  saveRef.current = save

  // An edit, undo, mode switch or new plan may remove the selected object: drop it instead of highlighting
  // something else.
  useEffect(() => {
    setSelection((sel) => validSelection(result?.geometry?.corrected, sel))
  }, [result])
  // Another plan or another detection / TopologyGuard / ScaleLock configuration is different geometry: an id there
  // may name a different room, so the selection is cleared rather than remapped by id.
  const cfg = result?.config
  const geometryKey = result ? `${result.id}|${cfg?.detection}|${cfg?.topology_guard}|${cfg?.scale_lock}` : ''
  useEffect(() => { setSelection(null) }, [geometryKey])

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  // Remember the open plan and page: a refresh reopens them, the next visit offers them.
  useEffect(() => { setFileRevision(null) }, [result?.id])
  useEffect(() => { if (result) rememberPlan(local, tab, result, view) }, [result, view])

  // Leaving the page while something is not saved: the browser asks first.
  useEffect(() => {
    if (!save.unsaved) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [save.unsaved])

  const loadOffers = useCallback(async () => {
    try {
      const { sessions } = await api.recentSessions(5)
      setOffers(sessions)
    } catch { setOffers([]) }
  }, [])

  const reopen = useCallback(async (id, toView) => {
    if (!confirmDiscard(saveRef.current)) return
    setRestoring(id)
    setRestoreNote('')
    try {
      const r = await api.getPlan(id)
      setSelection(null)
      setFile(null)
      setPreview(null)
      setPending(null)
      setResult(r)
      setStatus('ready')
      setError('')
      setView(toView || (lastPlan(local)?.id === id && lastPlan(local).view) || 'fix2build')
    } catch (e) {
      setRestoreNote(`The saved plan could not be reopened: ${e.message}`)
      forgetTabPlan(tab)
      loadOffers()
    } finally {
      setRestoring(null)
    }
  }, [loadOffers])

  // Is the backend process as new as this interface? Checked at start and, while it is not, every few seconds,
  // so the warning disappears once the backend is restarted.
  useEffect(() => {
    let live = true
    let timer
    const check = async () => {
      try {
        const b = await api.backendVersion()
        if (!live) return
        setBackend(b)
        if (!b.current) timer = setTimeout(check, 5000)
      } catch { if (live) timer = setTimeout(check, 5000) }   // not reachable yet: requests report that themselves
    }
    check()
    return () => { live = false; clearTimeout(timer) }
  }, [])

  // Refresh: reopen this tab's plan on the page it was on (the backend restores it from its autosave if it was
  // restarted). A new tab or visit offers the recent plans on the Upload page instead.
  useEffect(() => {
    const t = tabPlan(tab)
    if (t) reopen(t.id, t.view === 'upload' ? 'analysis' : t.view)
    loadOffers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'upload') loadOffers() }, [view, loadOffers])

  const chooseFile = useCallback((f) => {
    // Replacing the open plan: it stays autosaved (reopen it from the Upload page) unless something is pending.
    if (result && !confirmDiscard(saveRef.current)) return
    if (result) forgetTabPlan(tab)
    setSelection(null)
    setFile(f)
    setPreview(f ? URL.createObjectURL(f) : null)
    setResult(null)
    setPending(null)
    setStatus('idle')
    setError('')
    setView('upload')
  }, [result])

  const generate = useCallback(async () => {
    if (!file) return
    setStatus('processing')
    setError('')
    try {
      // A saved ArchNext project reopens the edited building; an image is processed from scratch.
      const r = file.name.endsWith('.json') ? await api.openProject(file) : await api.upload(file)
      setResult(r)
      setStatus('ready')
      setView('analysis')
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }, [file])

  // Switching detection mode, TopologyGuard or ScaleLock re-runs the pipeline for the uploaded plan; every page follows.
  const changeConfig = useCallback(async (topologyGuard, scaleLock, detection) => {
    if (!result) return
    setConfigBusy(true)
    setConfigError('')
    try {
      setResult(await api.setConfig(result.id, topologyGuard, scaleLock, detection ?? result.config?.detection))
    } catch (e) {
      setConfigError(e.message)
    } finally {
      setConfigBusy(false)
    }
  }, [result])

  const newPlan = useCallback(() => chooseFile(null), [chooseFile])

  // Leaving Fix2Build discards a preview that was not applied or a drag in progress: ask first.
  const changeView = useCallback((v) => {
    if (v === view) return
    if (view === 'fix2build' && saveRef.current.status === 'pending' && !confirmDiscard(saveRef.current)) return
    setView(v)
  }, [view])

  return (
    <div className="h-full flex flex-col">
      <Header view={view} onView={changeView} hasResult={!!result} config={result?.config} onNew={newPlan} save={save} onHome={onHome} />
      {backend && !backend.current && (
        <div role="alert" data-testid="backend-outdated"
             className="shrink-0 bg-warn/10 border-b border-warn/30 text-warn px-4 py-2 text-[12.5px] flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{STALE_BACKEND} (Backend API version {backend.version}, this interface needs {REQUIRED_API_VERSION}.)</span>
        </div>
      )}
      <main className="flex-1 min-h-0">
        {view === 'upload' && (
          <UploadView file={file} preview={preview} status={status} error={error} result={result}
                      onFile={chooseFile} onGenerate={generate} onOpen={() => setView('analysis')}
                      offers={restoreOffers(offers, lastPlan(local), result?.id)} onReopen={reopen}
                      restoring={restoring} restoreNote={restoreNote} onContinue={() => setView('fix2build')} />
        )}
        {view === 'analysis' && result && (
          <AnalysisView result={result} onResult={setResult} onStudio={() => setView('studio')}
                        onConfig={changeConfig} configBusy={configBusy} configError={configError} />
        )}
        {view === 'studio' && result && <StudioView result={result} selection={selection} onSelect={setSelection} />}
        {view === 'fix2build' && result && (
          <Fix2BuildView result={result} onResult={setResult} selection={selection} onSelect={setSelection}
                         save={save} onPending={setPending} onFileSaved={setFileRevision} />
        )}
        {view === 'validation' && result && (
          <ValidationView result={result} onConfig={changeConfig} configBusy={configBusy} configError={configError} />
        )}
      </main>
    </div>
  )
}
