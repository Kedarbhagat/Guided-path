import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import VisioImportModal from './VisioImportModal'

// ─── API ──────────────────────────────────────────────────────
const BASE = 'http://localhost:5000/api/v1'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const api = {
  getFlows: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return req('GET', `/flows${q ? '?' + q : ''}`)
  },
  createFlow: (d) => req('POST', '/flows', d),
  getFlow: (id) => req('GET', `/flows/${id}`),
  updateFlow: (id, d) => req('PUT', `/flows/${id}`, d),
  deleteFlow: (id) => req('DELETE', `/flows/${id}`),
  duplicateFlow: (id, d) => req('POST', `/flows/${id}/duplicate`, d),
  restoreFlow: (id) => req('POST', `/flows/${id}/restore`),
  getArchivedFlows: () => req('GET', '/flows/archived'),
  getVersion: (fId, vId) => req('GET', `/flows/${fId}/versions/${vId}`),
  publishVersion: (fId, vId, d) => req('POST', `/flows/${fId}/versions/${vId}/publish`, d),
  createVersion: (fId, d) => req('POST', `/flows/${fId}/versions`, d),
  createNode: (vId, d) => req('POST', `/versions/${vId}/nodes`, d),
  updateNode: (vId, nId, d) => req('PUT', `/versions/${vId}/nodes/${nId}`, d),
  deleteNode: (vId, nId) => req('DELETE', `/versions/${vId}/nodes/${nId}`),
  createEdge: (vId, d) => req('POST', `/versions/${vId}/edges`, d),
  updateEdge: (vId, eId, d) => req('PUT', `/versions/${vId}/edges/${eId}`, d),
  deleteEdge: (vId, eId) => req('DELETE', `/versions/${vId}/edges/${eId}`),
  startSession: (d) => req('POST', '/sessions', d),
  submitStep: (id, edgeId) => req('POST', `/sessions/${id}/step`, { edge_id: edgeId }),
  goBack: (id) => req('POST', `/sessions/${id}/back`),
  restartSession: (id) => req('POST', `/sessions/${id}/restart`),
  submitFeedback: (id, d) => req('POST', `/sessions/${id}/feedback`, d),
  exportSession: (id) => req('GET', `/sessions/${id}/export`),
  getCategories: () => req('GET', '/categories'),
  getAnalyticsOverview: () => req('GET', '/analytics/overview'),
  getFlowAnalytics: (id) => req('GET', `/analytics/flows/${id}`),
}

// ─── TOAST ────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([])
  const add = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])
  return { toasts, add }
}

function ToastContainer({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 18px', borderRadius: '8px', fontSize: '13px', fontFamily: 'var(--mono)',
          background: t.type === 'error' ? '#2a1010' : t.type === 'warn' ? '#2a2010' : '#0d2a1a',
          border: `1px solid ${t.type === 'error' ? 'var(--red)' : t.type === 'warn' ? 'var(--yellow)' : 'var(--green)'}`,
          color: t.type === 'error' ? 'var(--red)' : t.type === 'warn' ? 'var(--yellow)' : 'var(--green)',
          animation: 'fadeUp 0.2s ease', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>{t.type === 'error' ? '✕' : t.type === 'warn' ? '⚠' : '✓'}</span>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ─── MODAL ────────────────────────────────────────────────
function Modal({ title, children, onClose, width = '420px' }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.15s ease' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', padding: '28px', width, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', animation: 'fadeUp 0.2s ease', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', letterSpacing: '0.08em' }}>{title}</div>
          <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: '20px', lineHeight: 1, width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── CONFIRM DIALOG ───────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', confirmColor = 'var(--red)', onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ color: 'var(--text2)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>{message}</p>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={onConfirm}
          style={{ flex: 1, padding: '10px', background: confirmColor, color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
          {confirmLabel}
        </button>
        <button onClick={onClose}
          style={{ padding: '10px 16px', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', fontSize: '13px' }}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ─── NAV ──────────────────────────────────────────────────
function Nav() {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', padding: '0 24px', height: '52px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700, color: '#fff' }}>GR</span>
        </div>
        <span style={{ color: 'var(--text2)', fontSize: '13px', fontWeight: 400 }}>Guided Resolution</span>
      </Link>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Link to="/" style={{ fontSize: '13px', color: 'var(--text3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>Flows</Link>
        <Link to="/analytics" style={{ fontSize: '13px', color: 'var(--text3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>Analytics</Link>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', padding: '2px 7px', border: '1px solid var(--border)', borderRadius: '4px' }}>v1.0.0</span>
      </div>
    </nav>
  )
}

// ─── KEYBOARD SHORTCUT HOOK ───────────────────────────────
function useKeyboardShortcut(key, callback, { meta = false, ctrl = false } = {}) {
  useEffect(() => {
    const h = (e) => {
      if (meta && !e.metaKey) return
      if (ctrl && !e.ctrlKey) return
      if (e.key === key) { e.preventDefault(); callback() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [key, callback, meta, ctrl])
}

// ─── ANALYTICS DASHBOARD ──────────────────────────────────
function AnalyticsDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toasts, add: toast } = useToast()

  useEffect(() => {
    api.getAnalyticsOverview()
      .then(setData)
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  const Stat = ({ label, value, sub, color = 'var(--text)' }) => (
    <div style={{ padding: '20px 24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginBottom: '10px', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 300, color, letterSpacing: '-0.03em', marginBottom: '4px' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{sub}</div>}
    </div>
  )

  if (loading) return (
    <div style={{ padding: '48px 56px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[1,2,3,4].map(i => <div key={i} style={{ height: '100px', background: 'var(--surface)', borderRadius: '10px', animation: 'pulse 1.5s infinite' }} />)}
      </div>
    </div>
  )

  const d = data || {}
  const sessions = d.sessions || {}
  const flows = d.flows || {}
  const perf = d.performance || {}
  const over_time = d.sessions_over_time || []

  // Simple bar chart for sessions over time
  const maxCount = Math.max(...over_time.map(r => r.count), 1)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '48px 56px' }}>
      <ToastContainer toasts={toasts} />
      <div style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: '10px' }}>OVERVIEW</div>
        <h1 style={{ fontSize: '26px', fontWeight: 400, color: 'var(--text)', letterSpacing: '-0.02em' }}>Analytics</h1>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <Stat label="TOTAL FLOWS" value={flows.total} sub={`${flows.live || 0} live · ${flows.draft || 0} draft`} />
        <Stat label="TOTAL SESSIONS" value={sessions.total} sub={`${sessions.completion_rate || 0}% completion rate`} color="var(--accent2)" />
        <Stat label="ESCALATION RATE" value={sessions.escalation_rate != null ? `${sessions.escalation_rate}%` : null} sub="of completed sessions" color="var(--yellow)" />
        <Stat label="AVG HANDLE TIME" value={perf.avg_duration_seconds != null ? `${perf.avg_duration_seconds}s` : null} sub={perf.avg_feedback_rating ? `★ ${perf.avg_feedback_rating} avg rating` : 'No ratings yet'} color="var(--green)" />
      </div>

      {/* Sessions over time */}
      {over_time.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '24px', marginBottom: '32px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: '20px' }}>SESSIONS — LAST 30 DAYS</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
            {over_time.map((r, i) => (
              <div key={i} title={`${r.date}: ${r.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'default' }}>
                <div style={{ width: '100%', background: 'var(--accent)', borderRadius: '2px 2px 0 0', height: `${(r.count / maxCount) * 64}px`, minHeight: '2px', transition: 'opacity 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{over_time[0]?.date}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>{over_time[over_time.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {over_time.length === 0 && (
        <div style={{ padding: '60px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text3)' }}>No session data yet. Run some flows to see analytics here.</div>
        </div>
      )}
    </div>
  )
}

// ─── DASHBOARD ────────────────────────────────────────────
function Dashboard() {
  const [flows, setFlows] = useState([])
  const [pagination, setPagination] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [showArchived, setShowArchived] = useState(false)
  const [archivedFlows, setArchivedFlows] = useState([])
  const [showVisioImport, setShowVisioImport] = useState(false)
  const { toasts, add: toast } = useToast()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const searchRef = useRef(null)

  // Keyboard shortcut: Cmd/Ctrl+N → new flow
  useKeyboardShortcut('n', () => setCreating(true), { meta: true })
  // Focus search with /
  useKeyboardShortcut('/', () => searchRef.current?.focus())

  useEffect(() => { load() }, [search, statusFilter, categoryFilter, sort])
  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {})
  }, [])
  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 50)
  }, [creating])
  useEffect(() => {
    if (showArchived) {
      api.getArchivedFlows().then(setArchivedFlows).catch(e => toast(e.message, 'error'))
    }
  }, [showArchived])

  async function load() {
    setLoading(true)
    try {
      const params = { stats: '1' }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (categoryFilter) params.category = categoryFilter
      if (sort) params.sort = sort
      const res = await api.getFlows(params)
      setFlows(res.data || res)
      if (res.pagination) setPagination(res.pagination)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function createFlow(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      const flow = await api.createFlow({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        category: newCategory.trim() || undefined,
      })
      const full = await api.getFlow(flow.id)
      const draft = full.versions?.[0]
      setFlows(prev => [full, ...prev])
      setNewName(''); setNewDesc(''); setNewCategory(''); setCreating(false)
      if (draft) navigate(`/build/${flow.id}/${draft.id}`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const FilterBtn = ({ label, value, current, onChange }) => (
    <button onClick={() => onChange(current === value ? '' : value)}
      style={{
        padding: '5px 12px', borderRadius: '5px', fontSize: '12px',
        border: `1px solid ${current === value ? 'var(--accent)' : 'var(--border)'}`,
        background: current === value ? '#0d1a3a' : 'var(--surface2)',
        color: current === value ? 'var(--accent2)' : 'var(--text3)',
        transition: 'all 0.15s',
      }}>{label}</button>
  )

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '48px 56px' }}>
      <ToastContainer toasts={toasts} />

      {showVisioImport && (
        <VisioImportModal
          onClose={() => setShowVisioImport(false)}
          onImported={({ flowId, versionId, flowName }) => {
            setShowVisioImport(false)
            toast(`Flow "${flowName}" imported successfully!`, 'success')
            load()
          }}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: '10px' }}>
            {pagination ? `${pagination.total} flow${pagination.total !== 1 ? 's' : ''}` : `${flows.length} flows`}
          </div>
          <h1 style={{ fontSize: '26px', fontWeight: 400, color: 'var(--text)', letterSpacing: '-0.02em' }}>Resolution Flows</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowVisioImport(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '7px', fontSize: '13px', fontWeight: 500, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
            ⬡ Import Visio
          </button>
          <button onClick={() => setCreating(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px', background: 'var(--accent)', color: '#fff', borderRadius: '7px', fontSize: '13px', fontWeight: 500, transition: 'opacity 0.15s, transform 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> New Flow
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.6, marginLeft: '4px' }}>⌘N</span>
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '360px' }}>
          <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search flows… (press /)"
            style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'} />
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <FilterBtn label="All" value="" current={statusFilter} onChange={setStatusFilter} />
          <FilterBtn label="Live" value="live" current={statusFilter} onChange={setStatusFilter} />
          <FilterBtn label="Draft" value="draft" current={statusFilter} onChange={setStatusFilter} />
        </div>

        {categories.length > 0 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            style={{ padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '12px', outline: 'none' }}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
        )}

        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '12px', outline: 'none' }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>

        <button onClick={() => setShowArchived(s => !s)}
          style={{ padding: '6px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text3)', fontSize: '12px', transition: 'all 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
          {showArchived ? '▲ Hide archived' : '▼ Archived'}
        </button>
      </div>

      {/* Create Modal */}
      {creating && (
        <Modal title="NEW FLOW" onClose={() => setCreating(false)}>
          <form onSubmit={createFlow}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>NAME *</label>
              <input ref={inputRef} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Missing Milestone"
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>DESCRIPTION</label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What does this flow resolve?" rows={2}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', resize: 'none', lineHeight: 1.5, transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>CATEGORY</label>
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Billing, Technical, Onboarding"
                list="category-list"
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              <datalist id="category-list">
                {categories.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={submitting || !newName.trim()}
                style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500, opacity: (!newName.trim() || submitting) ? 0.6 : 1 }}>
                {submitting ? 'Creating...' : 'Create & Edit'}
              </button>
              <button type="button" onClick={() => setCreating(false)}
                style={{ padding: '10px 16px', color: 'var(--text2)', fontSize: '13px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: '180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && flows.length === 0 && !showArchived && (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '22px' }}>◆</div>
          <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '8px', color: 'var(--text)' }}>
            {search || statusFilter || categoryFilter ? 'No flows match your filters' : 'No flows yet'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '24px' }}>
            {search || statusFilter || categoryFilter ? 'Try adjusting your search or filters' : 'Create your first resolution flow to get started'}
          </div>
          {!search && !statusFilter && !categoryFilter && (
            <button onClick={() => setCreating(true)}
              style={{ padding: '10px 20px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
              + Create first flow
            </button>
          )}
        </div>
      )}

      {/* Flow Grid */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          {flows.map((flow, i) => (
            <FlowCard key={flow.id} flow={flow} index={i}
              onDelete={() => setFlows(p => p.filter(f => f.id !== flow.id))}
              onDuplicate={(newFlow) => setFlows(p => [newFlow, ...p])}
              toast={toast}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '32px' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', alignSelf: 'center' }}>
            Page {pagination.page} of {pagination.pages}
          </span>
        </div>
      )}

      {/* Archived */}
      {showArchived && (
        <div style={{ marginTop: '40px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: '16px' }}>ARCHIVED FLOWS</div>
          {archivedFlows.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: '13px' }}>No archived flows.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {archivedFlows.map(flow => (
                <div key={flow.id} style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', opacity: 0.6 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '6px' }}>{flow.name}</div>
                  {flow.description && <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' }}>{flow.description}</div>}
                  <button onClick={async () => {
                    try {
                      await api.restoreFlow(flow.id)
                      setArchivedFlows(p => p.filter(f => f.id !== flow.id))
                      load()
                      toast('Flow restored')
                    } catch (e) { toast(e.message, 'error') }
                  }} style={{ padding: '6px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '5px', fontSize: '12px' }}>
                    ↺ Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FlowCard({ flow, index, onDelete, onDuplicate, toast }) {
  const navigate = useNavigate()
  const hasPublished = !!flow.active_version_id
  const draftVersion = flow.versions?.find(v => v.status === 'draft')
  const [hovered, setHovered] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const stats = flow.stats

  async function handleDuplicate() {
    setShowMenu(false)
    try {
      const newFlow = await api.duplicateFlow(flow.id, { name: `Copy of ${flow.name}` })
      onDuplicate(newFlow)
      toast('Flow duplicated')
      const vId = newFlow.versions?.[0]?.id
      if (vId) navigate(`/build/${newFlow.id}/${vId}`)
    } catch (e) { toast(e.message, 'error') }
  }

  async function handleDelete() {
    setConfirmDelete(false)
    try {
      await api.deleteFlow(flow.id)
      onDelete()
      toast('Flow archived')
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      {confirmDelete && (
        <ConfirmDialog
          title="ARCHIVE FLOW"
          message={`Archive "${flow.name}"? It will be moved to the archive and can be restored later.`}
          confirmLabel="Archive"
          confirmColor="var(--red)"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      <div className="fade-up"
        style={{ animationDelay: `${index * 0.04}s`, animationFillMode: 'both', opacity: 0, padding: '22px', background: hovered ? 'var(--surface2)' : 'var(--surface)', border: `1px solid ${hovered ? 'var(--border2)' : 'var(--border)'}`, borderRadius: '10px', transition: 'border-color 0.15s, background 0.15s', display: 'flex', flexDirection: 'column', position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setShowMenu(false) }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: '4px', background: hasPublished ? '#0d2a1a' : '#1a1808', color: hasPublished ? 'var(--green)' : 'var(--yellow)', border: `1px solid ${hasPublished ? '#1a4a2a' : '#3a3510'}` }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' }} />
              {hasPublished ? 'LIVE' : 'DRAFT'}
            </span>
            {flow.category && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '3px' }}>
                {flow.category}
              </span>
            )}
          </div>

          {/* ⋯ context menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={e => { e.stopPropagation(); setShowMenu(s => !s) }}
              style={{ color: 'var(--text3)', fontSize: '16px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'color 0.1s, background 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.background = 'transparent' }}>⋯</button>
            {showMenu && (
              <div style={{ position: 'absolute', right: 0, top: '30px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', padding: '6px', zIndex: 100, width: '160px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                <MenuItemBtn label="⊕ Duplicate" onClick={handleDuplicate} />
                {draftVersion && <MenuItemBtn label="✎ Edit draft" onClick={() => { setShowMenu(false); navigate(`/build/${flow.id}/${draftVersion.id}`) }} />}
                {hasPublished && <MenuItemBtn label="▶ Run" onClick={() => { setShowMenu(false); navigate(`/execute/${flow.id}`) }} />}
                <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
                <MenuItemBtn label="⊘ Archive" onClick={() => { setShowMenu(false); setConfirmDelete(true) }} color="var(--red)" />
              </div>
            )}
          </div>
        </div>

        <h3 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px', color: 'var(--text)', letterSpacing: '-0.01em' }}>{flow.name}</h3>
        {flow.description
          ? <p style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.5, flex: 1, marginBottom: '14px' }}>{flow.description}</p>
          : <div style={{ flex: 1, marginBottom: '14px' }} />
        }

        {/* Stats bar */}
        {stats && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', padding: '10px 12px', background: 'var(--bg)', borderRadius: '6px' }}>
            <StatMini label="Sessions" value={stats.total_sessions} />
            <StatMini label="Completed" value={stats.completed_sessions} />
            <StatMini label="Avg time" value={stats.avg_duration_seconds != null ? `${stats.avg_duration_seconds}s` : '—'} />
            <StatMini label="Nodes" value={stats.node_count} />
          </div>
        )}

        <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '14px' }}>
          {new Date(flow.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}{flow.versions?.length || 0} {flow.versions?.length === 1 ? 'version' : 'versions'}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {hasPublished && (
            <button onClick={() => navigate(`/execute/${flow.id}`)}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              ▶ Run
            </button>
          )}
          {/* Draft-only flow: prominent accent Edit Draft button */}
          {draftVersion && !hasPublished && (
            <button onClick={() => navigate(`/build/${flow.id}/${draftVersion.id}`)}
              style={{ flex: 1, padding: '8px 12px', background: '#1a2a10', color: 'var(--yellow)', border: '1px solid #3a4a10', borderRadius: '6px', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#232f14'; e.currentTarget.style.borderColor = '#5a7a10' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1a2a10'; e.currentTarget.style.borderColor = '#3a4a10' }}>
              ✎ Edit Draft
            </button>
          )}
          {/* Published flow with a draft: secondary edit button */}
          {draftVersion && hasPublished && (
            <button onClick={() => navigate(`/build/${flow.id}/${draftVersion.id}`)}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px', transition: 'border-color 0.15s, color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
              ✎ Edit draft
            </button>
          )}
          {!draftVersion && hasPublished && (
            <button onClick={async () => {
              try {
                const newVer = await api.createVersion(flow.id, { change_notes: 'New version' })
                navigate(`/build/${flow.id}/${newVer.id}`)
              } catch (e) { toast(e.message, 'error') }
            }}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px', transition: 'border-color 0.15s, color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
              + New version
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function StatMini({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '2px', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>{value ?? '—'}</div>
    </div>
  )
}

function MenuItemBtn({ label, onClick, color = 'var(--text2)' }) {
  return (
    <button onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: '5px', fontSize: '12px', color, transition: 'background 0.1s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {label}
    </button>
  )
}

// ─── AGENT EXECUTION ──────────────────────────────────────
function AgentExecution() {
  const { flowId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stepping, setStepping] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [error, setError] = useState(null)
  const [ticketId, setTicketId] = useState('')
  const [agentName, setAgentName] = useState('')
  const [showStart, setShowStart] = useState(true)
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportData, setExportData] = useState(null)

  // Start session once user fills in ticket details
  async function startSession() {
    setLoading(true)
    setShowStart(false)
    try {
      const s = await api.startSession({ flow_id: flowId, ticket_id: ticketId || undefined, agent_name: agentName || undefined })
      setSession(s)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function selectOption(edgeId) {
    setSelectedEdge(edgeId)
    setStepping(true)
    try {
      const s = await api.submitStep(session.session_id, edgeId)
      setSession(s)
      setSelectedEdge(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setStepping(false)
    }
  }

  async function goBack() {
    setStepping(true)
    try {
      const s = await api.goBack(session.session_id)
      setSession(s)
    } catch (e) {
      setError(e.message)
    } finally {
      setStepping(false)
    }
  }

  async function restart() {
    setStepping(true)
    setFeedbackRating(0); setFeedbackNote(''); setFeedbackSubmitted(false)
    try {
      const s = await api.restartSession(session.session_id)
      setSession(s)
    } catch (e) {
      setError(e.message)
    } finally {
      setStepping(false)
    }
  }

  async function submitFeedback() {
    try {
      await api.submitFeedback(session.session_id, { rating: feedbackRating, note: feedbackNote })
      setFeedbackSubmitted(true)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleExport() {
    try {
      const data = await api.exportSession(session.session_id)
      setExportData(data)
      setShowExport(true)
    } catch (e) {
      setError(e.message)
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  if (showStart) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ width: '420px', animation: 'fadeUp 0.2s ease' }}>
          <button onClick={() => navigate('/')} style={{ color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>← Back to flows</button>

          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--accent)', marginBottom: '12px', letterSpacing: '0.1em' }}>START SESSION</div>
          <h2 style={{ fontSize: '22px', fontWeight: 400, color: 'var(--text)', marginBottom: '28px', letterSpacing: '-0.02em' }}>Session details</h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>TICKET ID (OPTIONAL)</label>
            <input value={ticketId} onChange={e => setTicketId(e.target.value)} placeholder="e.g. TKT-12345"
              onKeyDown={e => e.key === 'Enter' && startSession()}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'} />
          </div>
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>AGENT NAME (OPTIONAL)</label>
            <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Your name"
              onKeyDown={e => e.key === 'Enter' && startSession()}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'} />
          </div>
          <button onClick={startSession}
            style={{ width: '100%', padding: '12px', background: 'var(--accent)', color: '#fff', borderRadius: '7px', fontSize: '14px', fontWeight: 500, transition: 'opacity 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
            Start Session ↵
          </button>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>Starting session…</div>
    </div>
  )

  if (!session) return null
  const isCompleted = session.status === 'completed'
  const node = session.current_node
  const breadcrumb = session.breadcrumb || []

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg)' }}>

      {/* Export Modal */}
      {showExport && exportData && (
        <Modal title="EXPORT SESSION" onClose={() => setShowExport(false)} width="540px">
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
            <button onClick={() => copyToClipboard(JSON.stringify(exportData, null, 2))}
              style={{ padding: '7px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '12px' }}>
              ⎘ Copy JSON
            </button>
            <button onClick={() => {
              const lines = [`Session: ${exportData.session_id}`, `Ticket: ${exportData.ticket_id || '—'}`, `Agent: ${exportData.agent_name || '—'}`, `Status: ${exportData.status}`, `Duration: ${exportData.duration_seconds}s`, '', 'Transcript:',
                ...(exportData.transcript || []).map(t => `  ${t.step}. ${t.question}\n     → ${t.answer}`),
                '', exportData.resolution ? `Resolution: ${exportData.resolution.title}` : '']
              copyToClipboard(lines.join('\n'))
            }} style={{ padding: '7px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '12px' }}>
              ⎘ Copy text
            </button>
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: '6px', padding: '14px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', lineHeight: 1.7, maxHeight: '380px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(exportData, null, 2)}
          </div>
        </Modal>
      )}

      {/* Sidebar */}
      <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 0' }}>
          <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text3)', fontSize: '11px', fontFamily: 'var(--mono)', marginBottom: '24px' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
            ← Back
          </button>

          {(session.ticket_id || session.agent_name) && (
            <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: '6px', marginBottom: '20px' }}>
              {session.ticket_id && <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>TICKET</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent2)', marginBottom: session.agent_name ? '8px' : 0 }}>{session.ticket_id}</div>
              </>}
              {session.agent_name && <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>AGENT</div>
                <div style={{ fontSize: '12px', color: 'var(--text)' }}>{session.agent_name}</div>
              </>}
            </div>
          )}

          <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: '14px' }}>PATH TAKEN</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {breadcrumb.map((crumb, i) => {
            const isLast = i === breadcrumb.length - 1
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', marginTop: '5px', flexShrink: 0, background: isLast ? 'var(--accent)' : 'var(--border2)' }} />
                  {!isLast && <div style={{ width: '1px', flex: 1, minHeight: '20px', background: 'var(--border)', margin: '3px 0' }} />}
                </div>
                <div style={{ fontSize: '12px', paddingBottom: '14px', color: isLast ? 'var(--text)' : 'var(--text3)', lineHeight: 1.45 }}>{crumb}</div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginBottom: isCompleted ? '10px' : 0 }}>
            <span>step {session.step_number}</span>
            <span style={{ color: isCompleted ? 'var(--green)' : 'var(--text3)' }}>{isCompleted ? 'done' : 'in progress'}</span>
          </div>
          {isCompleted && (
            <button onClick={handleExport}
              style={{ width: '100%', padding: '7px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '11px', fontFamily: 'var(--mono)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
              ↓ Export session
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', overflowY: 'auto' }}>
        {error && (
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 16px', background: '#2a1010', border: '1px solid var(--red)', borderRadius: '6px', color: 'var(--red)', fontSize: '13px', zIndex: 10, whiteSpace: 'nowrap' }}>
            {error} <button onClick={() => setError(null)} style={{ marginLeft: '10px', opacity: 0.6, color: 'var(--red)' }}>✕</button>
          </div>
        )}
        {isCompleted
          ? <ResultCard node={node} session={session} onRestart={restart}
              feedbackRating={feedbackRating} setFeedbackRating={setFeedbackRating}
              feedbackNote={feedbackNote} setFeedbackNote={setFeedbackNote}
              feedbackSubmitted={feedbackSubmitted} onSubmitFeedback={submitFeedback} />
          : <QuestionCard key={node?.id} node={node} options={session.options || []} onSelect={selectOption} onBack={session.step_number > 1 ? goBack : null} onRestart={restart} stepping={stepping} selectedEdge={selectedEdge} />
        }
      </div>
    </div>
  )
}

function QuestionCard({ node, options, onSelect, onBack, onRestart, stepping, selectedEdge }) {
  // Keyboard: 1-9 to pick options
  useEffect(() => {
    const h = (e) => {
      const n = parseInt(e.key)
      if (!isNaN(n) && n >= 1 && n <= options.length && !stepping) {
        onSelect(options[n - 1].edge_id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [options, stepping, onSelect])

  return (
    <div style={{ width: '100%', maxWidth: '580px', animation: 'fadeUp 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 7px', border: '1px solid var(--border)', borderRadius: '3px' }}>
          {node.type}
        </span>
      </div>

      <h2 style={{ fontSize: '24px', fontWeight: 400, lineHeight: 1.35, marginBottom: '14px', letterSpacing: '-0.02em', color: 'var(--text)' }}>
        {node.title}
      </h2>

      {node.body && (
        <p style={{ color: 'var(--text2)', fontSize: '14px', lineHeight: 1.65, marginBottom: '36px' }}>
          {node.body}
        </p>
      )}
      {!node.body && <div style={{ marginBottom: '36px' }} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
        {options.map((opt, i) => {
          const isSelected = selectedEdge === opt.edge_id
          return (
            <button key={opt.edge_id} onClick={() => onSelect(opt.edge_id)} disabled={stepping}
              style={{
                padding: '15px 20px', background: isSelected ? 'var(--accent)' : 'var(--surface)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '8px', color: isSelected ? '#fff' : 'var(--text)', fontSize: '14px',
                textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.15s', opacity: (stepping && !isSelected) ? 0.4 : 1,
                cursor: stepping ? 'default' : 'pointer',
              }}
              onMouseEnter={e => { if (!stepping && !isSelected) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--surface2)' } }}
              onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)' } }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ width: '22px', height: '22px', borderRadius: '50%', border: `1px solid ${isSelected ? 'rgba(255,255,255,0.4)' : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span>{opt.label}</span>
              </div>
              <span style={{ color: isSelected ? 'rgba(255,255,255,0.6)' : 'var(--text3)', fontSize: '14px' }}>
                {isSelected ? '●' : '→'}
              </span>
            </button>
          )
        })}
      </div>

      {options.length === 0 && (
        <div style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text3)', fontSize: '13px', textAlign: 'center', marginBottom: '32px' }}>
          No options available for this node
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {onBack && (
          <button onClick={onBack} disabled={stepping}
            style={{ padding: '8px 16px', color: 'var(--text3)', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px', fontFamily: 'var(--mono)', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text2)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}>
            ← Back
          </button>
        )}
        <button onClick={onRestart} disabled={stepping}
          style={{ padding: '8px 16px', color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
          ↺ Restart
        </button>
        {options.length > 0 && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginLeft: 'auto' }}>
            Press 1–{options.length} to answer
          </span>
        )}
      </div>
    </div>
  )
}

function ResultCard({ node, session, onRestart, feedbackRating, setFeedbackRating, feedbackNote, setFeedbackNote, feedbackSubmitted, onSubmitFeedback }) {
  const navigate = useNavigate()
  const isEscalation = !!node.metadata?.escalate_to
  const [copied, setCopied] = useState(false)

  function copyResolution() {
    const text = [node.title, node.metadata?.resolution, isEscalation ? `Escalate to: ${node.metadata.escalate_to}` : ''].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ width: '100%', maxWidth: '580px', animation: 'fadeUp 0.2s ease' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderRadius: '20px', marginBottom: '28px', background: isEscalation ? '#2a1010' : '#0d2a1a', border: `1px solid ${isEscalation ? '#5a2020' : '#1a5a2a'}`, color: isEscalation ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.08em' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', animation: 'pulse 2s infinite' }} />
        {isEscalation ? 'ESCALATION REQUIRED' : 'RESOLVED'}
      </div>

      <h2 style={{ fontSize: '24px', fontWeight: 400, lineHeight: 1.35, marginBottom: '20px', letterSpacing: '-0.02em' }}>{node.title}</h2>

      {node.metadata?.resolution && (
        <div style={{ position: 'relative', padding: '20px 22px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text2)', marginBottom: '16px' }}>
          {node.metadata.resolution}
          <button onClick={copyResolution}
            style={{ position: 'absolute', top: '12px', right: '12px', padding: '4px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text3)', fontSize: '11px', transition: 'all 0.15s' }}>
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        </div>
      )}

      {isEscalation && (
        <div style={{ padding: '16px 20px', background: '#180808', border: '1px solid #5a2020', borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#2a1010', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>⚠</div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--red)', marginBottom: '4px', letterSpacing: '0.08em' }}>ESCALATE TO</div>
            <div style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 500 }}>{node.metadata.escalate_to}</div>
          </div>
        </div>
      )}

      <div style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
        <span>{session.step_number} steps · {session.duration_seconds != null ? `${session.duration_seconds}s` : '—'}</span>
        <span>Session {session.session_id?.slice(0, 8)}</span>
      </div>

      {/* Feedback */}
      {!feedbackSubmitted ? (
        <div style={{ padding: '18px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginBottom: '12px', letterSpacing: '0.08em' }}>RATE THIS RESOLUTION</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setFeedbackRating(n)}
                style={{ fontSize: '20px', transition: 'transform 0.1s', transform: feedbackRating >= n ? 'scale(1.15)' : 'scale(1)', opacity: feedbackRating > 0 && feedbackRating < n ? 0.4 : 1 }}>
                ★
              </button>
            ))}
          </div>
          {feedbackRating > 0 && (
            <>
              <textarea value={feedbackNote} onChange={e => setFeedbackNote(e.target.value)} placeholder="Any comments? (optional)" rows={2}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '13px', outline: 'none', resize: 'none', marginBottom: '10px', lineHeight: 1.5 }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              <button onClick={onSubmitFeedback}
                style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', borderRadius: '5px', fontSize: '12px', fontWeight: 500 }}>
                Submit feedback
              </button>
            </>
          )}
        </div>
      ) : (
        <div style={{ padding: '14px 18px', background: '#0d2a1a', border: '1px solid #1a5a2a', borderRadius: '8px', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '12px', marginBottom: '20px' }}>
          ✓ Feedback submitted — thank you!
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={onRestart}
          style={{ padding: '10px 18px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '7px', fontSize: '13px', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
          ↺ New Session
        </button>
        <button onClick={() => navigate('/')}
          style={{ padding: '10px 18px', background: 'var(--accent)', color: '#fff', borderRadius: '7px', fontSize: '13px', fontWeight: 500, transition: 'opacity 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
          ← All Flows
        </button>
      </div>
    </div>
  )
}

// ─── FLOW BUILDER ─────────────────────────────────────────────
const NODE_W = 210
const NODE_H = 90

function FlowBuilder() {
  const { flowId, versionId } = useParams()
  const navigate = useNavigate()
  const [version, setVersion] = useState(null)
  const [flow, setFlow] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingNode, setEditingNode] = useState(null)
  const [addingEdge, setAddingEdge] = useState(null)
  const [edgeModal, setEdgeModal] = useState(null)
  const [editingEdge, setEditingEdge] = useState(null) // { id, label } for rename
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishModal, setPublishModal] = useState(false)
  const [publishNotes, setPublishNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [showFlowAnalytics, setShowFlowAnalytics] = useState(false)
  const [flowAnalytics, setFlowAnalytics] = useState(null)
  const { toasts, add: toast } = useToast()

  const nodePositions = useRef({})
  const nodeRefs = useRef({})
  const svgRef = useRef(null)
  const canvasRef = useRef(null)
  const transformLayerRef = useRef(null)
  const bgPatternRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const spaceDown = useRef(false)

  useEffect(() => {
    Promise.all([api.getVersion(flowId, versionId), api.getFlow(flowId)])
      .then(([v, f]) => {
        setVersion(v)
        setFlow(f)
        const ns = v.nodes || []
        const es = v.edges || []
        setNodes(ns)
        setEdges(es)
        ns.forEach(n => { nodePositions.current[n.id] = { x: n.position?.x || 0, y: n.position?.y || 0 } })
      })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [flowId, versionId])

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') setAddingEdge(null)
      if (e.key === 'Delete' && editingNode) setDeleteConfirm(editingNode.id)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [editingNode])

  // ── Zoom via scroll wheel ──────────────────────────────
  // Space bar = pan mode (Figma-style)
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === 'Space' && !e.target.matches('input,textarea')) {
        e.preventDefault()
        if (!spaceDown.current) {
          spaceDown.current = true
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
        }
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') {
        spaceDown.current = false
        if (!isPanning.current && canvasRef.current) canvasRef.current.style.cursor = ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const next = Math.min(3, Math.max(0.2, zoomRef.current * delta))
      zoomRef.current = next
      setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading])

  // ── Pan by dragging canvas background ──────────────────
  function onCanvasMouseDown(e) {
    const tag = e.target.tagName.toLowerCase()
    const isBackground = tag === 'rect' || tag === 'svg' || e.target === canvasRef.current
    const isMiddleClick = e.button === 1
    const isSpacePan = spaceDown.current && e.button === 0

    // Pan modes:
    //   1. Click on bare background (original)
    //   2. Middle mouse button — anywhere on canvas
    //   3. Space + left click — anywhere on canvas (Figma-style)
    if (!isBackground && !isMiddleClick && !isSpacePan) return
    if (addingEdge) return
    e.preventDefault()
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  function applyZoom(delta, center) {
    const next = Math.min(3, Math.max(0.2, zoomRef.current * delta))
    zoomRef.current = next
    setZoom(next)
  }

  // Imperatively redraw SVG edge paths from current nodePositions — no React re-render
  function redrawEdges() {
    if (!svgRef.current) return
    const paths = svgRef.current.querySelectorAll('[data-edge-path]')
    const texts = svgRef.current.querySelectorAll('[data-edge-label]')
    const delBtns = svgRef.current.querySelectorAll('[data-edge-del]')
    const delXs = svgRef.current.querySelectorAll('[data-edge-delx]')
    paths.forEach(path => {
      const edgeId = path.getAttribute('data-edge-path')
      const srcId = path.getAttribute('data-src')
      const tgtId = path.getAttribute('data-tgt')
      const srcPos = nodePositions.current[srcId] || {}
      const tgtPos = nodePositions.current[tgtId] || {}
      const x1 = (srcPos.x || 0) + NODE_W
      const y1 = (srcPos.y || 0) + NODE_H / 2
      const x2 = tgtPos.x || 0
      const y2 = (tgtPos.y || 0) + NODE_H / 2
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
      path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`)
      // label text
      const label = svgRef.current.querySelector(`[data-edge-label="${edgeId}"]`)
      if (label) { label.setAttribute('x', mx); label.setAttribute('y', my - 9) }
      // label pill rect
      const rect = svgRef.current.querySelector(`[data-edge-label-rect="${edgeId}"]`)
      if (rect) { rect.setAttribute('x', mx - 32); rect.setAttribute('y', my - 22) }
      // delete circle
      const btn = svgRef.current.querySelector(`[data-edge-del="${edgeId}"]`)
      if (btn) { btn.setAttribute('cx', mx); btn.setAttribute('cy', my + 10) }
      // delete ×
      const bx = svgRef.current.querySelector(`[data-edge-delx="${edgeId}"]`)
      if (bx) { bx.setAttribute('x', mx); bx.setAttribute('y', my + 15) }
    })
  }

  const isPublished = version?.status === 'published'
  const hasStart = nodes.some(n => n.is_start)

  async function addNode(type) {
    const pos = { x: 60 + Math.random() * 350, y: 60 + Math.random() * 250 }
    try {
      const node = await api.createNode(versionId, {
        title: type === 'result' ? 'Resolution' : 'New question',
        type, is_start: !hasStart, position: pos,
      })
      nodePositions.current[node.id] = { x: node.position?.x || 0, y: node.position?.y || 0 }
      setNodes(prev => [...prev, node])
      setEditingNode(node)
      toast(`${type} node added`)
    } catch (e) { toast(e.message, 'error') }
  }

  async function saveNode(nodeId, data) {
    try {
      const updated = await api.updateNode(versionId, nodeId, data)
      setNodes(prev => prev.map(n => {
        if (n.id === nodeId) return { ...updated, position: n.position }
        // If this save marked a new start node, clear is_start on all others
        if (data.is_start) return { ...n, is_start: false }
        return n
      }))
      setEditingNode(prev => prev?.id === nodeId ? { ...updated, position: prev.position } : prev)
      toast('Node saved')
    } catch (e) { toast(e.message, 'error') }
  }

  async function removeNode(nodeId) {
    try {
      await api.deleteNode(versionId, nodeId)
      delete nodePositions.current[nodeId]
      setNodes(prev => prev.filter(n => n.id !== nodeId))
      setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId))
      if (editingNode?.id === nodeId) setEditingNode(null)
      setDeleteConfirm(null)
      toast('Node deleted')
    } catch (e) { toast(e.message, 'error') }
  }

  async function addEdge(sourceId, targetId, label) {
    try {
      const edge = await api.createEdge(versionId, { source: sourceId, target: targetId, condition_label: label })
      setEdges(prev => [...prev, edge])
      setEdgeModal(null)
      setAddingEdge(null)
      toast('Connection added')
    } catch (e) { toast(e.message, 'error') }
  }

  async function removeEdge(edgeId) {
    try {
      await api.deleteEdge(versionId, edgeId)
      setEdges(prev => prev.filter(e => e.id !== edgeId))
      toast('Connection removed')
    } catch (e) { toast(e.message, 'error') }
  }

  async function renameEdge(edgeId, label) {
    try {
      await api.updateEdge(versionId, edgeId, { condition_label: label })
      setEdges(prev => prev.map(e => e.id === edgeId ? { ...e, condition_label: label } : e))
      setEditingEdge(null)
      toast('Label updated')
    } catch (e) { toast(e.message, 'error') }
  }

  async function publish() {
    if (!hasStart) return toast('Add a start node first', 'warn')
    setPublishing(true)
    try {
      await api.publishVersion(flowId, versionId, { change_notes: publishNotes || undefined })
      setVersion(v => ({ ...v, status: 'published' }))
      setPublishModal(false)
      toast('Version published!')
    } catch (e) { toast(e.message, 'error') }
    finally { setPublishing(false) }
  }

  async function loadAnalytics() {
    try {
      const data = await api.getFlowAnalytics(flowId)
      setFlowAnalytics(data)
      setShowFlowAnalytics(true)
    } catch (e) { toast(e.message, 'error') }
  }

  // --- Drag logic ---
  const dragging = useRef(null)
  const dragStart = useRef(null)
  const [, forceRender] = useState(0)

  function onMouseDown(e, nodeId) {
    if (e.button !== 0) return
    // Space held = pan mode, let event bubble to canvas handler
    if (spaceDown.current) return
    if (addingEdge && addingEdge !== nodeId) {
      setEdgeModal({ sourceId: addingEdge, targetId: nodeId })
      return
    }
    if (addingEdge === nodeId) return
    e.stopPropagation()
    dragging.current = nodeId
    dragStart.current = { mx: e.clientX, my: e.clientY, ...nodePositions.current[nodeId] }
    setEditingNode(nodes.find(n => n.id === nodeId) || null)
  }

  useEffect(() => {
    function onMouseMove(e) {
      // Pan canvas — only update pan state (does not unmount NodeEditPanel)
      if (isPanning.current) {
        const dx = e.clientX - panStart.current.mx
        const dy = e.clientY - panStart.current.my
        const nx = panStart.current.px + dx
        const ny = panStart.current.py + dy
        panRef.current = { x: nx, y: ny }
        // Directly mutate the transform layer DOM — zero React re-renders
        if (transformLayerRef.current) {
          transformLayerRef.current.style.transform = `translate(${nx}px, ${ny}px) scale(${zoomRef.current})`
        }
        // Update dot grid offset directly
        if (bgPatternRef.current) {
          bgPatternRef.current.setAttribute('x', nx % 20)
          bgPatternRef.current.setAttribute('y', ny % 20)
        }
        return
      }
      // Drag node — zero React state updates, pure DOM mutation
      if (!dragging.current) return
      const dx = (e.clientX - dragStart.current.mx) / zoomRef.current
      const dy = (e.clientY - dragStart.current.my) / zoomRef.current
      const newX = Math.max(0, dragStart.current.x + dx)
      const newY = Math.max(0, dragStart.current.y + dy)
      nodePositions.current[dragging.current] = { x: newX, y: newY }
      // Move node div
      const el = nodeRefs.current[dragging.current]
      if (el) { el.style.left = newX + 'px'; el.style.top = newY + 'px' }
      // Redraw only the affected edges directly in SVG DOM
      redrawEdges()
    }
    function onMouseUp(e) {
      if (isPanning.current) {
        isPanning.current = false
        if (canvasRef.current) canvasRef.current.style.cursor = ''
        document.body.style.userSelect = ''
        setPan({ ...panRef.current })
        return
      }
      if (!dragging.current) return
      const id = dragging.current
      const pos = nodePositions.current[id]
      api.updateNode(versionId, id, { position: pos }).catch(() => {})
      setNodes(prev => prev.map(n => n.id === id ? { ...n, position: pos } : n))
      dragging.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [versionId])

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>Loading…</div>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <ToastContainer toasts={toasts} />

      {/* Publish modal */}
      {publishModal && (
        <Modal title="PUBLISH VERSION" onClose={() => setPublishModal(false)}>
          <p style={{ color: 'var(--text3)', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
            Publishing will make this version live. Agents can immediately start using it.
          </p>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>CHANGE NOTES (OPTIONAL)</label>
            <textarea value={publishNotes} onChange={e => setPublishNotes(e.target.value)} rows={3} placeholder="What changed in this version?"
              style={{ width: '100%', padding: '9px 11px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={publish} disabled={publishing}
              style={{ flex: 1, padding: '10px', background: 'var(--green)', color: '#000', borderRadius: '6px', fontSize: '13px', fontWeight: 600, opacity: publishing ? 0.7 : 1 }}>
              {publishing ? 'Publishing…' : '⬆ Publish Now'}
            </button>
            <button onClick={() => setPublishModal(false)} style={{ padding: '10px 16px', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', fontSize: '13px' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Analytics modal */}
      {showFlowAnalytics && flowAnalytics && (
        <Modal title="FLOW ANALYTICS" onClose={() => setShowFlowAnalytics(false)} width="480px">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {[
              { label: 'Total sessions', value: flowAnalytics.sessions.total },
              { label: 'Completed', value: flowAnalytics.sessions.completed },
              { label: 'Escalated', value: flowAnalytics.sessions.escalated },
              { label: 'Avg duration', value: flowAnalytics.avg_duration_seconds != null ? `${flowAnalytics.avg_duration_seconds}s` : '—' },
              { label: 'Avg steps', value: flowAnalytics.avg_steps ?? '—' },
              { label: 'Avg rating', value: flowAnalytics.avg_rating ? `${flowAnalytics.avg_rating} / 5` : '—' },
            ].map(s => (
              <div key={s.label} style={{ padding: '12px 16px', background: 'var(--surface2)', borderRadius: '7px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '4px' }}>{s.label.toUpperCase()}</div>
                <div style={{ fontSize: '18px', color: 'var(--text)', fontWeight: 300 }}>{s.value}</div>
              </div>
            ))}
          </div>
          {flowAnalytics.top_result_nodes.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginBottom: '10px', letterSpacing: '0.08em' }}>TOP RESOLUTIONS</div>
              {flowAnalytics.top_result_nodes.map(r => (
                <div key={r.node_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text2)' }}>{r.title}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{r.count}× ({r.pct}%)</span>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <ConfirmDialog
          title="DELETE NODE"
          message="Delete this node and all its connections? This cannot be undone."
          confirmLabel="Delete"
          confirmColor="var(--red)"
          onConfirm={() => removeNode(deleteConfirm)}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {/* Toolbar */}
      <div style={{ padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button onClick={() => navigate('/')} style={{ color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '5px', marginRight: '8px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>← Back</button>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text2)', marginRight: '4px', letterSpacing: '-0.01em' }}>
          {flow?.name}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '3px' }}>
          v{version?.version_number} · {isPublished ? 'published' : 'draft'}
        </div>

        <div style={{ flex: 1 }} />

        {!isPublished && (
          <>
            <ToolbarBtn onClick={() => addNode('question')} label="+ Question" />

            <ToolbarBtn onClick={() => addNode('result')} label="+ Result" color="var(--green)" />
          </>
        )}
        <ToolbarBtn onClick={loadAnalytics} label="⊞ Stats" />
        {!isPublished && (
          <button onClick={() => setPublishModal(true)} disabled={!hasStart}
            style={{ padding: '6px 14px', background: hasStart ? 'var(--green)' : 'var(--surface2)', color: hasStart ? '#000' : 'var(--text3)', border: `1px solid ${hasStart ? 'var(--green)' : 'var(--border)'}`, borderRadius: '5px', fontSize: '12px', fontWeight: 600, transition: 'all 0.15s', opacity: hasStart ? 1 : 0.6 }}>
            ⬆ Publish
          </button>
        )}
        {isPublished && (
          <button onClick={() => navigate(`/execute/${flowId}`)}
            style={{ padding: '6px 14px', background: 'var(--accent)', color: '#fff', borderRadius: '5px', fontSize: '12px', fontWeight: 500 }}>
            ▶ Run
          </button>
        )}
      </div>

      {/* Validation hint */}
      {!isPublished && nodes.length > 0 && !hasStart && (
        <div style={{ background: '#2a2010', borderBottom: '1px solid #3a3510', padding: '8px 20px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--yellow)' }}>
          ⚠ No start node set. Click a node and mark it as start, or delete and recreate — first node auto-becomes start.
        </div>
      )}

      {/* Canvas + panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Outer canvas viewport ── */}
        <div ref={canvasRef} onMouseDown={onCanvasMouseDown}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'default', background: 'var(--bg)' }}>

          {/* Fixed dot-grid background — does NOT zoom/pan */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <pattern ref={bgPatternRef} id="dots" x={pan.x % 20} y={pan.y % 20} width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--border)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>

          {/* Zoom controls — fixed to viewport */}
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '0px' }}>
            <button onClick={() => { const n = Math.min(3, zoomRef.current * 1.2); zoomRef.current = n; setZoom(n) }}
              style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px 6px 0 0', color: 'var(--text2)', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>+</button>
            <div style={{ width: '32px', padding: '4px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderBottom: 'none', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)' }}>
              {Math.round(zoom * 100)}%
            </div>
            <button onClick={() => { const n = Math.max(0.2, zoomRef.current * 0.8); zoomRef.current = n; setZoom(n) }}
              style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderBottom: 'none', color: 'var(--text2)', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>−</button>
            <button onClick={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }) }}
              title="Reset view"
              style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', color: 'var(--text3)', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>⊙</button>
          </div>

          {/* Hint — fixed to viewport */}
          <div style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 50, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', pointerEvents: 'none' }}>
            scroll to zoom · space+drag or middle-click to pan
          </div>

          {/* ── Transform layer — zoom + pan applied here ── */}
          <div ref={transformLayerRef} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, willChange: 'transform' }}>

            {/* Edges SVG — large canvas so edges always render */}
            <svg ref={svgRef} style={{ position: 'absolute', left: 0, top: 0, width: '8000px', height: '8000px', pointerEvents: 'none', overflow: 'visible' }}>
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="var(--border2)" />
                </marker>
              </defs>

              {edges.map(edge => {
                const src = nodes.find(n => n.id === edge.source)
                const tgt = nodes.find(n => n.id === edge.target)
                if (!src || !tgt) return null
                const srcPos = nodePositions.current[src.id] || src.position || {}
                const tgtPos = nodePositions.current[tgt.id] || tgt.position || {}
                const x1 = (srcPos.x || 0) + NODE_W
                const y1 = (srcPos.y || 0) + NODE_H / 2
                const x2 = tgtPos.x || 0
                const y2 = (tgtPos.y || 0) + NODE_H / 2
                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                const hasLabel = edge.condition_label && edge.condition_label.trim()

                return (
                  <g key={edge.id} style={{ pointerEvents: 'all' }}>
                    {/* data-* attrs are read by redrawEdges() during drag for zero-render updates */}
                    <path
                      data-edge-path={edge.id}
                      data-src={src.id}
                      data-tgt={tgt.id}
                      d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                      fill="none" stroke="var(--border2)" strokeWidth="1.5" markerEnd="url(#arrow)" />

                    {/* Clickable label pill — click to edit */}
                    {!isPublished && (
                      <g onClick={e => { e.stopPropagation(); setEditingEdge({ id: edge.id, label: edge.condition_label || '' }) }}
                        style={{ cursor: 'pointer' }}>
                        <rect
                          data-edge-label-rect={edge.id}
                          x={mx - 32} y={my - 22} width="64" height="18" rx="4"
                          fill={hasLabel ? 'var(--surface2)' : 'var(--surface)'}
                          stroke={hasLabel ? 'var(--border2)' : 'var(--border)'}
                          strokeWidth="1" opacity="0.95"
                        />
                        <text
                          data-edge-label={edge.id}
                          x={mx} y={my - 9} textAnchor="middle"
                          style={{ fontSize: '9px', fill: hasLabel ? 'var(--text2)' : 'var(--text3)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
                          {hasLabel ? (edge.condition_label.length > 9 ? edge.condition_label.slice(0, 9) + '…' : edge.condition_label) : '+ label'}
                        </text>
                      </g>
                    )}
                    {/* Published: just show label text, no interaction */}
                    {isPublished && hasLabel && (
                      <text
                        data-edge-label={edge.id}
                        x={mx} y={my - 8} textAnchor="middle"
                        style={{ fontSize: '10px', fill: 'var(--text3)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
                        {edge.condition_label}
                      </text>
                    )}

                    {/* Delete button */}
                    {!isPublished && (
                      <>
                        <circle
                          data-edge-del={edge.id}
                          cx={mx} cy={my + 10} r="9" fill="var(--surface)" stroke="var(--border2)" strokeWidth="1"
                          style={{ cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); removeEdge(edge.id) }} />
                        <text
                          data-edge-delx={edge.id}
                          x={mx} y={my + 15} textAnchor="middle"
                          style={{ fontSize: '12px', fill: 'var(--red)', pointerEvents: 'none' }}>×</text>
                      </>
                    )}
                  </g>
                )
              })}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const typeColor = { question: 'var(--accent)', result: 'var(--green)' }[node.type] || 'var(--text3)'
              const isEditing = editingNode?.id === node.id
              const pos = nodePositions.current[node.id] || node.position || {}

              return (
                <div key={node.id}
                  ref={el => { if (el) nodeRefs.current[node.id] = el }}
                  onMouseDown={e => onMouseDown(e, node.id)}
                  style={{
                    position: 'absolute', left: pos.x || 0, top: pos.y || 0, width: `${NODE_W}px`,
                    background: isEditing ? 'var(--surface2)' : 'var(--surface)',
                    border: `1.5px solid ${isEditing ? typeColor : addingEdge && addingEdge !== node.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '10px',
                    cursor: addingEdge && addingEdge !== node.id ? 'crosshair' : 'grab',
                    userSelect: 'none',
                    boxShadow: isEditing ? `0 0 0 3px ${typeColor}22` : '0 2px 8px rgba(0,0,0,0.3)',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}>
                  <div style={{ padding: '9px 10px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: typeColor, flexShrink: 0 }} />
                      {node.is_start && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--accent)', padding: '1px 5px', background: '#0d1a3a', borderRadius: '3px', border: '1px solid #1a2a5a' }}>START</span>}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{node.type}</span>
                    </div>
                    {!isPublished && (
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirm(node.id) }}
                        style={{ color: 'var(--text3)', fontSize: '16px', lineHeight: 1, width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '3px', transition: 'color 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>×</button>
                    )}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: '12px', lineHeight: 1.45, color: 'var(--text)', fontWeight: 500 }}>{node.title}</div>
                    {node.body && <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px', lineHeight: 1.4 }}>{node.body.slice(0, 50)}{node.body.length > 50 ? '…' : ''}</div>}
                  </div>
                  {!isPublished && node.type !== 'result' && (
                    <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <button onClick={e => { e.stopPropagation(); setAddingEdge(node.id) }}
                        style={{ fontSize: '10px', color: addingEdge === node.id ? '#fff' : 'var(--accent)', fontFamily: 'var(--mono)', padding: '3px 8px', border: `1px solid var(--accent)`, borderRadius: '3px', background: addingEdge === node.id ? 'var(--accent)' : '#0d1a3a', transition: 'all 0.15s' }}>
                        {addingEdge === node.id ? '● connecting…' : '+ connect'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {nodes.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
                  <div style={{ fontSize: '28px', marginBottom: '14px', opacity: 0.4 }}>◈</div>
                  <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '6px' }}>Empty canvas</div>
                  <div style={{ fontSize: '12px' }}>Add a Question node to start building</div>
                </div>
              </div>
            )}

          </div>{/* end transform layer */}
        </div>

        {/* Edit panel */}
        {editingNode && !isPublished && (
          <NodeEditPanel key={editingNode.id} node={editingNode} onSave={saveNode} onClose={() => setEditingNode(null)} />
        )}

        {/* View panel (published) */}
        {editingNode && isPublished && (
          <div style={{ width: '280px', flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', padding: '24px', overflowY: 'auto', animation: 'fadeIn 0.15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.08em' }}>NODE DETAILS</div>
              <button onClick={() => setEditingNode(null)} style={{ color: 'var(--text3)', fontSize: '18px' }}>×</button>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '4px' }}>{editingNode.type?.toUpperCase()}</div>
            <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>{editingNode.title}</div>
            {editingNode.body && <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.6, marginBottom: '12px' }}>{editingNode.body}</div>}
            {editingNode.metadata?.resolution && (
              <div style={{ fontSize: '12px', color: 'var(--text3)', lineHeight: 1.6, padding: '10px', background: 'var(--surface2)', borderRadius: '5px' }}>
                {editingNode.metadata.resolution}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edge label modal */}
      {edgeModal && (
        <EdgeLabelModal
          onConfirm={(label) => addEdge(edgeModal.sourceId, edgeModal.targetId, label)}
          onClose={() => { setEdgeModal(null); setAddingEdge(null) }}
        />
      )}

      {editingEdge && (
        <EdgeLabelModal
          title="EDIT CONNECTION LABEL"
          initial={editingEdge.label}
          onConfirm={(label) => renameEdge(editingEdge.id, label)}
          onClose={() => setEditingEdge(null)}
        />
      )}
    </div>
  )
}

function ToolbarBtn({ onClick, label, color }) {
  return (
    <button onClick={onClick}
      style={{ padding: '6px 13px', background: 'var(--surface2)', border: '1px solid var(--border)', color: color || 'var(--text2)', borderRadius: '5px', fontSize: '12px', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color || 'var(--border2)'; e.currentTarget.style.color = color || 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = color || 'var(--text2)' }}>
      {label}
    </button>
  )
}

function EdgeLabelModal({ onConfirm, onClose, initial = '', title = 'CONNECTION LABEL' }) {
  const [label, setLabel] = useState(initial)
  const inputRef = useRef(null)
  const isEdit = initial !== ''

  useEffect(() => {
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select() // select all so user can type to replace or edit
      }
    }, 50)
  }, [])

  function handleSubmit() {
    onConfirm(label.trim())
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ color: 'var(--text3)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
        {isEdit
          ? 'Edit the connection label below. Leave blank to remove it.'
          : 'Label this connection — describe the path (e.g. "Card expired", "Escalate to billing"). Leave blank for no label.'}
      </p>
      <input
        ref={inputRef}
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose() }}
        placeholder="e.g. Card expired, Not resolved, Try again…"
        style={{ width: '100%', padding: '11px 13px', background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s', marginBottom: '20px' }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={handleSubmit}
          style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
          {isEdit ? 'Update Label' : 'Add Connection'}
        </button>
        <button onClick={onClose}
          style={{ padding: '10px 16px', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', fontSize: '13px' }}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ── Field must be defined OUTSIDE any component so it is never re-created ──
function PanelField({ label, children }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px', letterSpacing: '0.08em' }}>{label}</div>
      {children}
    </div>
  )
}

function NodeEditPanel({ node, onSave, onClose }) {
  const [title, setTitle] = useState(node.title || '')
  const [body, setBody] = useState(node.body || '')
  const [type, setType] = useState(node.type || 'question')
  const [resolution, setResolution] = useState(node.metadata?.resolution || '')
  const [escalateTo, setEscalateTo] = useState(node.metadata?.escalate_to || '')
  const [isStart, setIsStart] = useState(node.is_start || false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setTitle(node.title || ''); setBody(node.body || ''); setType(node.type || 'question')
    setResolution(node.metadata?.resolution || ''); setEscalateTo(node.metadata?.escalate_to || '')
    setIsStart(node.is_start || false)
    setDirty(false)
  }, [node.id])

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && title.trim()) handleSave() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [dirty, title, body, type, resolution, escalateTo])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    const effectiveType = isStart && type === 'result' ? 'question' : type
    await onSave(node.id, {
      title: title.trim(), body: body.trim(), type: effectiveType,
      is_start: isStart,
      metadata: effectiveType === 'result' ? { resolution, escalate_to: escalateTo || null } : {},
    })
    setSaving(false)
    setDirty(false)
  }

  const inputStyle = { width: '100%', padding: '9px 11px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s', lineHeight: 1.5 }
  const focusStyle = (e) => e.target.style.borderColor = 'var(--accent)'
  const blurStyle = (e) => e.target.style.borderColor = 'var(--border)'

  return (
    <div style={{ width: '280px', flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.15s ease' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.08em' }}>
          EDIT NODE
          {dirty && <span style={{ marginLeft: '8px', color: 'var(--yellow)', fontSize: '9px' }}>● unsaved</span>}
        </div>
        <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: '18px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>×</button>
      </div>

      <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        <PanelField label="TYPE">
          <div style={{ display: 'flex', gap: '6px' }}>
            {['question', 'result'].map(t => (
              <button key={t} onClick={() => { setType(t); setDirty(true) }}
                style={{ flex: 1, padding: '7px 4px', borderRadius: '5px', fontSize: '11px', fontFamily: 'var(--mono)', border: `1px solid ${type === t ? 'var(--accent)' : 'var(--border)'}`, background: type === t ? '#0d1a3a' : 'var(--surface2)', color: type === t ? 'var(--accent2)' : 'var(--text3)', transition: 'all 0.15s' }}>
                {t}
              </button>
            ))}
          </div>
        </PanelField>

        <PanelField label="START NODE">
          <button
            onClick={() => { setIsStart(s => !s); setDirty(true) }}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
              fontFamily: 'var(--mono)', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '10px',
              border: `1px solid ${isStart ? '#1a4a2a' : 'var(--border)'}`,
              background: isStart ? '#0a2a14' : 'var(--surface2)',
              color: isStart ? 'var(--green)' : 'var(--text3)',
              transition: 'all 0.15s', cursor: 'pointer',
            }}>
            <span style={{
              width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${isStart ? 'var(--green)' : 'var(--border2)'}`,
              background: isStart ? 'var(--green)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              {isStart && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff' }} />}
            </span>
            {isStart ? 'This is the START node' : 'Mark as START node'}
          </button>
          {isStart && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text3)', lineHeight: 1.5 }}>
              The previous start node will be unset automatically.
            </div>
          )}
        </PanelField>

        <PanelField label="TITLE *">
          <textarea value={title} onChange={e => { setTitle(e.target.value); setDirty(true) }} rows={3}
            style={{ ...inputStyle, resize: 'vertical' }} onFocus={focusStyle} onBlur={blurStyle} />
        </PanelField>

        <PanelField label="DESCRIPTION">
          <textarea value={body} onChange={e => { setBody(e.target.value); setDirty(true) }} rows={3}
            placeholder="Additional context for the agent…"
            style={{ ...inputStyle, resize: 'vertical' }} onFocus={focusStyle} onBlur={blurStyle} />
        </PanelField>

        {type === 'result' && (
          <>
            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 18px' }} />
            <PanelField label="RESOLUTION STEPS">
              <textarea value={resolution} onChange={e => { setResolution(e.target.value); setDirty(true) }} rows={5}
                placeholder="Steps to resolve this issue…"
                style={{ ...inputStyle, resize: 'vertical' }} onFocus={focusStyle} onBlur={blurStyle} />
            </PanelField>
            <PanelField label="ESCALATE TO">
              <input value={escalateTo} onChange={e => { setEscalateTo(e.target.value); setDirty(true) }}
                placeholder="e.g. Tier 2 Engineering"
                style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
            </PanelField>
          </>
        )}
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '8px', textAlign: 'right' }}>⌘S to save</div>
        <button onClick={handleSave} disabled={saving || !title.trim()}
          style={{ width: '100%', padding: '10px', background: dirty ? 'var(--accent)' : 'var(--surface2)', color: dirty ? '#fff' : 'var(--text3)', borderRadius: '7px', fontSize: '13px', fontWeight: 500, border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`, transition: 'all 0.2s', opacity: (!title.trim() || saving) ? 0.5 : 1 }}>
          {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved ✓'}
        </button>
      </div>
    </div>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────
export default function App() {
  const location = useLocation()
  const isExecution = location.pathname.startsWith('/execute')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!isExecution && <Nav />}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/build/:flowId/:versionId" element={<FlowBuilder />} />
          <Route path="/execute/:flowId" element={<AgentExecution />} />
        </Routes>
      </div>
    </div>
  )
}