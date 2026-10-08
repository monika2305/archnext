import { useCallback, useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import UploadView from './views/UploadView.jsx'
import AnalysisView from './views/AnalysisView.jsx'
import StudioView from './views/StudioView.jsx'
import ValidationView from './views/ValidationView.jsx'
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

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const chooseFile = useCallback((f) => {
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
      const r = await api.upload(file)
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
        {view === 'studio' && result && <StudioView result={result} />}
        {view === 'validation' && result && (
          <ValidationView result={result} onConfig={changeConfig} configBusy={configBusy} configError={configError} />
        )}
      </main>
    </div>
  )
}
