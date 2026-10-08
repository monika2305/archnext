// Saved / unsaved state of the open plan and the "last session" remembered by the browser.
//
// The backend autosaves every committed change (result.autosave tells which revision is on disk). What can still be
// lost is what has not reached it: an edit request in flight, a preview that was not applied, a drag in progress,
// or a change whose autosave failed. With autosave switched off on the server, everything since the last
// downloaded project file is unsaved.

const LAST_KEY = 'archnext.lastPlan'     // localStorage: the plan to offer on the next visit
const TAB_KEY = 'archnext.tabPlan'       // sessionStorage: this tab's plan and page, restored on refresh

/**
 * @param result   the plan result (or null)
 * @param pending  null | 'saving' | 'preview' | 'drag'  (reported by the Fix2Build workspace)
 * @param fileRevision  revision at the last downloaded project file (used when autosave is off)
 * @returns {{ status: string, unsaved: boolean, label: string, detail: string }}
 */
export function saveState(result, pending = null, fileRevision = null) {
  if (!result) return { status: 'none', unsaved: false, label: '', detail: '' }
  if (pending === 'saving') return { status: 'saving', unsaved: true, label: 'Saving…', detail: 'An edit is being applied.' }
  if (pending === 'preview') {
    return { status: 'pending', unsaved: true, label: 'Unsaved preview', detail: 'Apply or cancel the previewed change.' }
  }
  if (pending === 'drag') return { status: 'pending', unsaved: true, label: 'Editing…', detail: 'Release to apply the change.' }
  const a = result.autosave || {}
  const rev = result.revision ?? 0
  if (a.enabled === false) {
    return rev > (fileRevision ?? 0)
      ? { status: 'unsaved', unsaved: true, label: 'Unsaved changes',
          detail: 'Autosave is off on this server. Use Save file to keep your edits.' }
      : { status: 'saved', unsaved: false, label: 'Saved to file', detail: 'Autosave is off on this server.' }
  }
  if (a.ok && a.revision === rev) {
    return { status: 'saved', unsaved: false, label: 'All changes saved', detail: a.saved_at ? `Autosaved ${formatTime(a.saved_at)}` : 'Autosaved' }
  }
  return { status: 'error', unsaved: true, label: 'Not saved',
           detail: a.error ? `Autosave failed (${a.error}). Use Save file to keep your edits.` : 'Your latest change is not saved yet.' }
}

export function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? `at ${time}` : `${d.toLocaleDateString()} ${time}`
}

function read(storage, key) {
  try { return JSON.parse(storage?.getItem(key) || 'null') } catch { return null }
}
function write(storage, key, value) {
  try { value ? storage?.setItem(key, JSON.stringify(value)) : storage?.removeItem(key) } catch { /* storage unavailable */ }
}

/** Remember the open plan: for this tab (refresh → same plan and page) and for the next visit. */
export function rememberPlan(local, session, result, view) {
  if (!result?.id) return
  write(session, TAB_KEY, { id: result.id, view })
  write(local, LAST_KEY, { id: result.id, filename: result.filename, view })
}

/** The plan this tab had open before a refresh (restored automatically), or null. */
export function tabPlan(session) {
  const v = read(session, TAB_KEY)
  return v && typeof v.id === 'string' ? v : null
}

/** The plan to offer on the Upload page, or null. */
export function lastPlan(local) {
  const v = read(local, LAST_KEY)
  return v && typeof v.id === 'string' ? v : null
}

/** "New plan": this tab no longer reopens the old plan on refresh (it stays in the recent list). */
export function forgetTabPlan(session) {
  write(session, TAB_KEY, null)
}

/**
 * Plans to offer for reopening: the autosaved list from the server, the one this browser used last first.
 * Plans the server no longer has are not offered.
 */
export function restoreOffers(recent, last, currentId = null) {
  const list = (recent || []).filter((s) => s.id !== currentId)
  const i = last ? list.findIndex((s) => s.id === last.id) : -1
  if (i > 0) list.unshift(...list.splice(i, 1))
  return list
}

/** Leaving the page or replacing the plan: ask first when something would be lost. */
export function confirmDiscard(state, confirmFn = globalThis.confirm) {
  if (!state.unsaved) return true
  return !!confirmFn?.(`${state.label}: ${state.detail}\n\nIf you continue, this change will be lost. Continue?`)
}
