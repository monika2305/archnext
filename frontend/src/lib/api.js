// Endpoints this interface needs appeared in this backend API version (see API_VERSION in backend/app/main.py).
export const REQUIRED_API_VERSION = 3
export const STALE_BACKEND = 'The backend is running older code than this interface. Restart it (close the backend ' +
  'window and run start_backend.bat), then try again.'
const UNREACHABLE = 'The processing service is not reachable. Make sure it is running and try again.'

/**
 * The message for a failed request. The server's own message is kept; a missing endpoint (404 / 405 from the
 * router rather than from ArchNext) also names the request and the likely cause, an outdated backend process.
 */
export function failureMessage({ status, detail, method, url }) {
  if (status === 502 || status === 504) return UNREACHABLE
  const text = typeof detail === 'string' && detail ? detail : `Request failed (${status})`
  const missingRoute = status === 405 || (status === 404 && (detail === 'Not Found' || /^Unknown API endpoint/.test(text)))
  return missingRoute ? `${text} (HTTP ${status} on ${method} ${url}). ${STALE_BACKEND}` : text
}

async function handle(res, method, url) {
  if (!res.ok) {
    let detail = null
    try { detail = (await res.json())?.detail } catch { /* not JSON */ }
    throw new Error(failureMessage({ status: res.status, detail, method, url }))
  }
  // An API answer is JSON; a web page here means the request reached a route that is not part of the API.
  if (!(res.headers.get('content-type') || '').includes('json')) {
    throw new Error(`The backend answered ${method} ${url} with a web page instead of data. ${STALE_BACKEND}`)
  }
  return res.json()
}

async function request(url, opts) {
  const method = opts?.method || 'GET'
  try {
    return await handle(await fetch(url, opts), method, url)
  } catch (e) {
    if (e instanceof TypeError) throw new Error('The processing service is not reachable. Make sure it is running and try again.')
    throw e
  }
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  /** Which API version the backend process runs (an old process reports none, i.e. version 1). */
  async backendVersion() {
    const h = await request('/api/health')
    const version = Number(h?.api_version) || 1
    return { version, current: version >= REQUIRED_API_VERSION }
  },
  upload(file) {
    const fd = new FormData()
    fd.append('file', file)
    return request('/api/plans', { method: 'POST', body: fd })
  },
  getPlan(id) {
    return request(`/api/plans/${encodeURIComponent(id)}`)
  },
  recentSessions(limit = 5) {
    return request(`/api/sessions/recent?limit=${limit}`)
  },
  calibrate(id, p1, p2, distance, unit) {
    return request(`/api/plans/${id}/calibration`, json({ p1, p2, distance, unit }))
  },
  resetCalibration(id) {
    return request(`/api/plans/${id}/calibration`, { method: 'DELETE' })
  },
  applyFix(id, key) {
    return request(`/api/plans/${id}/fixes`, json({ key }))
  },
  undoFix(id) {
    return request(`/api/plans/${id}/fixes/undo`, { method: 'POST' })
  },
  redo(id) {
    return request(`/api/plans/${id}/fixes/redo`, { method: 'POST' })
  },
  edit(id, op) {
    return request(`/api/plans/${id}/edit`, json(op))
  },
  editPreview(id, op) {
    return request(`/api/plans/${id}/edit`, json({ ...op, dry_run: true }))
  },
  saveProject(id) {
    return request(`/api/plans/${id}/project`)
  },
  openProject(file) {
    const fd = new FormData()
    fd.append('file', file)
    return request('/api/projects', { method: 'POST', body: fd })
  },
  editWall(id, wall, end, x, y, dryRun = false) {
    return request(`/api/plans/${id}/edits`, json({ wall, end, x, y, dry_run: dryRun }))
  },
  setConfig(id, topologyGuard, scaleLock, detection) {
    return request(`/api/plans/${id}/config`, json({ topology_guard: topologyGuard, scale_lock: scaleLock, detection }))
  },
  aiStatus() {
    return request('/api/ai/status')
  },
  compare(id) {
    return request(`/api/plans/${id}/compare`)
  },
  evaluate(id, file) {
    const fd = new FormData()
    fd.append('file', file)
    return request(`/api/plans/${id}/evaluate`, { method: 'POST', body: fd })
  },
  annotationDraft(id) {
    return request(`/api/plans/${id}/annotation-draft`)
  },
  benchmark() {
    return request('/api/benchmark')
  },
}
