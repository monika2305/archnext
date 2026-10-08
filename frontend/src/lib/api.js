async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : msg
    } catch { /* not JSON */ }
    if (res.status === 502 || res.status === 504) msg = 'The processing service is not reachable. Make sure it is running and try again.'
    throw new Error(msg)
  }
  return res.json()
}

async function request(url, opts) {
  try {
    return await handle(await fetch(url, opts))
  } catch (e) {
    if (e instanceof TypeError) throw new Error('The processing service is not reachable. Make sure it is running and try again.')
    throw e
  }
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
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
  benchmark() {
    return request('/api/benchmark')
  },
}
