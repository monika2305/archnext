// Mode B lives at /mode-b; the open project and page are kept in the URL so a refresh or a shared link reopens them.

const VIEWS = new Set(['overview', 'reconstruction', 'scene', 'visiontrust', 'nbv', 'research', 'export'])
const ID = /^[0-9a-f]{12}$/

export function isModeB(pathname) {
  return /^\/mode-b(\/|$)/.test(pathname || '')
}

export function readLocation(loc) {
  const q = new URLSearchParams(loc?.search || '')
  const project = ID.test(q.get('project') || '') ? q.get('project') : null
  const view = VIEWS.has(q.get('view')) ? q.get('view') : project ? 'reconstruction' : 'overview'
  return { project, view }
}

export function locationFor({ project, view }) {
  const q = new URLSearchParams()
  if (project) q.set('project', project)
  if (view && view !== 'overview') q.set('view', view)
  const s = q.toString()
  return `/mode-b${s ? `?${s}` : ''}`
}

export function writeLocation(history, state) {
  const url = locationFor(state)
  if (`${window.location.pathname}${window.location.search}` !== url) history.replaceState(null, '', url)
}
