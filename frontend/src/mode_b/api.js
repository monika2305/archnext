// Mode B API client (/api/mode-b/*). Independent of Mode A's client.

async function request(url, opts) {
  let res
  try {
    res = await fetch(url, opts)
  } catch {
    throw new Error('The processing service is not reachable. Make sure the backend is running and try again.')
  }
  if (!res.ok) {
    let detail = null
    try { detail = (await res.json())?.detail } catch { /* not JSON */ }
    const method = opts?.method || 'GET'
    if (res.status === 405 || (res.status === 404 && detail === 'Not Found')) {
      throw new Error(`${detail || 'Not available'} (HTTP ${res.status} on ${method} ${url}). The backend may be running ` +
        'older code without Mode B: restart it with start_backend.bat.')
    }
    throw new Error(typeof detail === 'string' && detail ? detail : `Request failed (${res.status})`)
  }
  if (!(res.headers.get('content-type') || '').includes('json')) {
    throw new Error(`The backend answered ${url} with a web page instead of data: restart it with start_backend.bat.`)
  }
  return res.json()
}

const base = '/api/mode-b'
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const modeB = {
  health: () => request(`${base}/health`),
  projects: () => request(`${base}/projects`),
  project: (id) => request(`${base}/projects/${id}`),
  status: (id) => request(`${base}/projects/${id}/status`),
  scene: (id, version) => request(`${base}/projects/${id}/scene${version != null ? `?version=${version}` : ''}`),
  cancel: (id) => request(`${base}/projects/${id}/cancel`, { method: 'POST' }),
  setScale: (id, body) => request(`${base}/projects/${id}/scale`, json(body)),
  research: () => request(`${base}/research`),
  demos: () => request(`${base}/demos`),
  createRgbd: (sequence) => request(`${base}/demos/rgbd`, json({ sequence })),
  upload(file, settings, name) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('settings', JSON.stringify(settings || {}))
    if (name) fd.append('name', name)
    return request(`${base}/projects`, { method: 'POST', body: fd })
  },
  extend(id, file) {
    const fd = new FormData()
    fd.append('file', file)
    return request(`${base}/projects/${id}/extend`, { method: 'POST', body: fd })
  },
  frameUrl: (id, folder, name) => `${base}/projects/${id}/frames/${folder}/${name}`,
  glbUrl: (id, version, include = 'all') => `${base}/projects/${id}/export.glb?include=${include}${version != null ? `&version=${version}` : ''}`,
}
