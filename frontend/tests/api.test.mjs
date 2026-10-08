// Error messages of failed API requests (src/lib/api.js).   Run: npm test
import assert from 'node:assert/strict'
import test from 'node:test'
import { failureMessage, STALE_BACKEND } from '../src/lib/api.js'

test('a missing endpoint names the request and the likely cause instead of a bare "Method Not Allowed"', () => {
  const m = failureMessage({ status: 405, detail: 'Method Not Allowed', method: 'POST', url: '/api/plans/abc/edit' })
  assert.match(m, /^Method Not Allowed \(HTTP 405 on POST \/api\/plans\/abc\/edit\)/)   // server text kept
  assert.ok(m.includes(STALE_BACKEND))
  const n = failureMessage({ status: 404, detail: 'Unknown API endpoint: POST /api/x (backend API version 3).', method: 'POST', url: '/api/x' })
  assert.ok(n.includes('HTTP 404 on POST /api/x') && n.includes(STALE_BACKEND))
})

test('ordinary errors keep the server message unchanged', () => {
  assert.equal(failureMessage({ status: 409, detail: 'The wall would cross another wall.', method: 'POST', url: '/api/plans/a/edit' }),
    'The wall would cross another wall.')
  assert.equal(failureMessage({ status: 404, detail: 'This plan is no longer available. Please upload it again.', method: 'GET', url: '/api/plans/a' }),
    'This plan is no longer available. Please upload it again.')
  assert.equal(failureMessage({ status: 500, detail: null, method: 'GET', url: '/api/plans/a' }), 'Request failed (500)')
  assert.match(failureMessage({ status: 502, method: 'GET', url: '/api/plans/a' }), /not reachable/)
})
