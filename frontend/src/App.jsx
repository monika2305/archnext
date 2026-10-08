import { useCallback, useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import UploadView from './views/UploadView.jsx'
import AnalysisView from './views/AnalysisView.jsx'
import StudioView from './views/StudioView.jsx'
import ValidationView from './views/ValidationView.jsx'
import Fix2BuildView from './views/Fix2BuildView.jsx'
import { validSelection } from './lib/planGeometry.js'
import { api } from './lib/api.js'

export default function App() {
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

  const chooseFile = useCallback((f) => {
    setSelection(null)
    setFile(f)
    setPreview(f ? URL.createObjectURL(f) : null)
    setResult(null)
    setStatus('idle')
    setError('')
    setView('upload')
  }, [])

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

  return (
    <div className="h-full flex flex-col">
      <Header view={view} onView={setView} hasResult={!!result} config={result?.config} onNew={newPlan} />
      <main className="flex-1 min-h-0">
        {view === 'upload' && (
          <UploadView file={file} preview={preview} status={status} error={error} result={result}
                      onFile={chooseFile} onGenerate={generate} onOpen={() => setView('analysis')} />
        )}
        {view === 'analysis' && result && (
          <AnalysisView result={result} onResult={setResult} onStudio={() => setView('studio')}
                        onConfig={changeConfig} configBusy={configBusy} configError={configError} />
        )}
        {view === 'studio' && result && <StudioView result={result} selection={selection} onSelect={setSelection} />}
        {view === 'fix2build' && result && (
          <Fix2BuildView result={result} onResult={setResult} selection={selection} onSelect={setSelection} />
        )}
        {view === 'validation' && result && (
          <ValidationView result={result} onConfig={changeConfig} configBusy={configBusy} configError={configError} />
        )}
      </main>
    </div>
  )
}
