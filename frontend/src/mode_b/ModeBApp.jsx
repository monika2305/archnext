import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ModeBHeader, { MODE_B_TABS, tabEnabled } from './components/ModeBHeader.jsx'
import OverviewView from './views/OverviewView.jsx'
import ReconstructionView from './views/ReconstructionView.jsx'
import { modeB } from './api.js'
import { isActive } from './lib/status.js'
import { readLocation, writeLocation } from './lib/route.js'
import { RgbdNextBestView, RgbdVisionTrust } from './views/RgbdTrustViews.jsx'

const SceneView = lazy(() => import('./views/SceneView.jsx'))
const VisionTrustView = lazy(() => import('./views/VisionTrustView.jsx'))
const NextBestViewView = lazy(() => import('./views/NextBestViewView.jsx'))
const ResearchView = lazy(() => import('./views/ResearchView.jsx'))
const ExportView = lazy(() => import('./views/ExportView.jsx'))

// Mode B dashboard (room video -> 3D). Independent of Mode A: own state, API, views and viewer.
export default function ModeBApp() {
  const initial = readLocation(window.location)
  const [view, setView] = useState(initial.view)
  const [projectId, setProjectId] = useState(initial.project)
  const [data, setData] = useState(null)            // { project, status, manifests }
  const [scene, setScene] = useState(null)
  const [projects, setProjects] = useState([])
  const [worker, setWorker] = useState(null)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(null)  // { surface, cell } shared by 3D Scene / VisionTrust / NBV
  const poll = useRef(null)

  useEffect(() => { document.title = 'ArchNext — Room video → 3D' }, [])
  useEffect(() => { writeLocation(window.history, { project: projectId, view }) }, [projectId, view])
  useEffect(() => {
    const onPop = () => { const l = readLocation(window.location); setProjectId(l.project); setView(l.view) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const loadProjects = useCallback(() => modeB.projects().then((r) => setProjects(r.projects)).catch((e) => setError(e.message)), [])
  useEffect(() => { loadProjects(); modeB.health().then((h) => setWorker(h.worker)).catch((e) => setError(e.message)) }, [loadProjects])

  const loadScene = useCallback(async (id, version) => {
    try { setScene(await modeB.scene(id, version)) } catch { setScene(null) }
  }, [])

  const loadProject = useCallback(async (id) => {
    try {
      const d = await modeB.project(id)
      setData(d)
      setError('')
      if (d.project.current_version != null) await loadScene(id, d.project.current_version)
      else setScene(null)
      return d
    } catch (e) {
      setError(e.message)
      setData(null)
      setScene(null)
      return null
    }
  }, [loadScene])

  // Poll the job while it runs; reload the project (keyframes, scene) when it finishes.
  useEffect(() => {
    clearTimeout(poll.current)
    if (!projectId) { setData(null); setScene(null); return undefined }
    let live = true
    const tick = async () => {
      const d = await loadProject(projectId)
      if (live && d && isActive(d.status)) poll.current = setTimeout(tick, 1200)
      else if (live) loadProjects()
    }
    tick()
    return () => { live = false; clearTimeout(poll.current) }
  }, [projectId, loadProject, loadProjects])

  const refreshWhileRunning = useCallback(() => {
    if (!projectId) return
    const tick = async () => {
      const d = await loadProject(projectId)
      if (d && isActive(d.status)) poll.current = setTimeout(tick, 1200)
      else loadProjects()
    }
    clearTimeout(poll.current)
    tick()
  }, [projectId, loadProject, loadProjects])

  const open = (id) => { setSelection(null); setProjectId(id); setView('reconstruction') }
  const uploaded = async (file, settings) => {
    const r = await modeB.upload(file, settings)
    open(r.project.id)
    loadProjects()
    return r
  }
  const extend = async (file) => {
    await modeB.extend(projectId, file)
    setView('reconstruction')
    refreshWhileRunning()
  }

  // A tab whose data is missing falls back to a page that can be shown.
  const project = data?.project
  const ctx = { project, scene }
  const shown = MODE_B_TABS.find((t) => t.key === view && tabEnabled(t, ctx)) ? view : project ? 'reconstruction' : 'overview'
  const viewProps = { data, scene, selection, onSelect: setSelection, onReload: () => loadProject(projectId), setScene }

  return (
    <div className="h-full flex flex-col" data-mode="b">
      <ModeBHeader view={shown} onView={setView} project={project} scene={scene}
                   onNew={() => { setProjectId(null); setView('overview') }} />
      {error && <div role="alert" className="shrink-0 bg-bad/5 border-b border-bad/20 text-bad px-4 py-2 text-[12.5px]">{error}</div>}
      <main className="flex-1 min-h-0">
        <Suspense fallback={<div className="h-full grid place-items-center"><Loader2 className="animate-spin text-accent" /></div>}>
          {shown === 'overview' && <OverviewView projects={projects} onOpen={open} onUploaded={uploaded} worker={worker} />}
          {shown === 'reconstruction' && data && (
            <ReconstructionView data={data} onCancel={() => modeB.cancel(projectId).then(refreshWhileRunning)}
                                onScene={() => setView('scene')} />
          )}
          {shown === 'scene' && scene && <SceneView {...viewProps} />}
          {shown === 'visiontrust' && scene && (scene.kind === 'rgbd' ? <RgbdVisionTrust scene={scene} /> : <VisionTrustView {...viewProps} onScene={() => setView('scene')} />)}
          {shown === 'nbv' && scene && (scene.kind === 'rgbd' ? <RgbdNextBestView scene={scene} /> : <NextBestViewView {...viewProps} onExtend={extend} busy={isActive(data?.status)} />)}
          {shown === 'research' && <ResearchView />}
          {shown === 'export' && scene && <ExportView {...viewProps} />}
        </Suspense>
      </main>
    </div>
  )
}
