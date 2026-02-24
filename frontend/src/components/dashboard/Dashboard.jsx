import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useToast, useKeyboardShortcut } from '../../hooks'
import { ToastContainer, Modal, ConfirmDialog, FilterBtn, MenuItemBtn, StatMini } from '../ui'
import VisioImportModal from '../../VisioImportModal'

export default function Dashboard() {
  const navigate = useNavigate()
  const { toasts, add: toast } = useToast()

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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [showArchived, setShowArchived] = useState(false)
  const [archivedFlows, setArchivedFlows] = useState([])
  const [showVisioImport, setShowVisioImport] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestIssue, setSuggestIssue] = useState('')

  const inputRef = useRef(null)
  const searchRef = useRef(null)
  const suggestRef = useRef(null)

  useKeyboardShortcut('n', () => setCreating(true), { meta: true })
  useKeyboardShortcut('/', () => searchRef.current?.focus())
  useKeyboardShortcut('k', () => { setSuggestIssue(''); setShowSuggest(true) }, { meta: true })

  // Debounce search by 300ms — avoids an API call on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { load() }, [debouncedSearch, statusFilter, categoryFilter, sort])
  useEffect(() => { api.getCategories().then(setCategories).catch(() => {}) }, [])
  useEffect(() => { if (creating) setTimeout(() => inputRef.current?.focus(), 50) }, [creating])
  useEffect(() => { if (showSuggest) setTimeout(() => suggestRef.current?.focus(), 50) }, [showSuggest])
  useEffect(() => {
    if (showArchived) api.getArchivedFlows().then(setArchivedFlows).catch(e => toast(e.message, 'error'))
  }, [showArchived])

  async function load() {
    setLoading(true)
    try {
      const params = { stats: '1' }
      if (debouncedSearch) params.search = debouncedSearch
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

  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setStatusFilter('')
    setCategoryFilter('')
    setSort('newest')
  }

  const hasActiveFilters = search || statusFilter || categoryFilter || sort !== 'newest'

  const inputStyle = {
    width: '100%', padding: '10px 12px', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)',
    fontSize: '14px', outline: 'none', transition: 'border-color 0.15s',
  }
  const focusBlur = {
    onFocus: e => e.target.style.borderColor = 'var(--accent)',
    onBlur: e => e.target.style.borderColor = 'var(--border)',
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '48px 56px' }}>
      <ToastContainer toasts={toasts} />

      {showVisioImport && (
        <VisioImportModal
          onClose={() => setShowVisioImport(false)}
          onImported={({ flowId, versionId, flowName, published }) => {
            setShowVisioImport(false)
            if (published) {
              toast(`Flow "${flowName}" imported and published!`, 'success')
              load()
            } else {
              toast(`Flow "${flowName}" saved — opening editor…`, 'success')
              navigate(`/build/${flowId}/${versionId}`)
            }
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
          <button
            onClick={() => { setSuggestIssue(''); setShowSuggest(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '7px', fontSize: '13px', fontWeight: 500, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
            ✦ AI Suggest
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.5 }}>⌘K</span>
          </button>
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

      {/* Filters */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '360px' }}>
          <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: '13px', pointerEvents: 'none' }}>⌕</span>
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search flows… (press /)"
            style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
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
        {hasActiveFilters && (
          <button onClick={clearFilters}
            style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--red)', fontSize: '12px', transition: 'all 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* AI Suggest Modal */}
      {showSuggest && (
        <Modal title="AI FLOW SUGGEST" onClose={() => setShowSuggest(false)}>
          <div style={{ marginBottom: '14px', fontSize: '13px', color: 'var(--text3)', lineHeight: 1.6 }}>
            Describe the customer's issue and AI will find the best matching published flow.
          </div>
          <textarea
            ref={suggestRef}
            value={suggestIssue}
            onChange={e => setSuggestIssue(e.target.value)}
            placeholder="e.g. Customer says their payment was charged twice this month but their subscription still shows as cancelled…"
            rows={4}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && suggestIssue.trim().length >= 10) {
                setShowSuggest(false)
                navigate('/flow-suggestions', { state: { issue: suggestIssue.trim() } })
              }
            }}
            style={{ ...inputStyle, fontSize: '13px', resize: 'vertical', lineHeight: 1.6, marginBottom: '8px' }}
            {...focusBlur}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: suggestIssue.length > 1800 ? 'var(--red)' : 'var(--text3)' }}>
              {suggestIssue.length}/2000 chars · ⌘↵ to search
            </span>
            {suggestIssue.trim().length > 0 && suggestIssue.trim().length < 10 && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--yellow)' }}>
                Add a bit more detail
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              disabled={suggestIssue.trim().length < 10 || suggestIssue.length > 2000}
              onClick={() => {
                setShowSuggest(false)
                navigate('/flow-suggestions', { state: { issue: suggestIssue.trim() } })
              }}
              style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500, opacity: (suggestIssue.trim().length < 10 || suggestIssue.length > 2000) ? 0.5 : 1, transition: 'opacity 0.15s', cursor: suggestIssue.trim().length < 10 ? 'not-allowed' : 'pointer' }}>
              ✦ Find matching flow
            </button>
            <button type="button" onClick={() => setShowSuggest(false)}
              style={{ padding: '10px 16px', color: 'var(--text2)', fontSize: '13px', border: '1px solid var(--border)', borderRadius: '6px' }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Create Modal */}
      {creating && (
        <Modal title="NEW FLOW" onClose={() => setCreating(false)}>
          <form onSubmit={createFlow}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>NAME *</label>
              <input ref={inputRef} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Missing Milestone"
                style={inputStyle} {...focusBlur} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>DESCRIPTION</label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What does this flow resolve?" rows={2}
                style={{ ...inputStyle, fontSize: '13px', resize: 'none', lineHeight: 1.5 }} {...focusBlur} />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>CATEGORY</label>
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Billing, Technical"
                list="category-list"
                style={{ ...inputStyle, fontSize: '13px' }} {...focusBlur} />
              <datalist id="category-list">
                {categories.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={submitting || !newName.trim()}
                style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500, opacity: (!newName.trim() || submitting) ? 0.6 : 1, cursor: !newName.trim() ? 'not-allowed' : 'pointer' }}>
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

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: '220px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', animation: 'pulse 1.5s infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && flows.length === 0 && !showArchived && (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '22px' }}>◆</div>
          <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '8px', color: 'var(--text)' }}>
            {hasActiveFilters ? 'No flows match your filters' : 'No flows yet'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '24px' }}>
            {hasActiveFilters ? 'Try adjusting your search or filters' : 'Create your first resolution flow to get started'}
          </div>
          {hasActiveFilters ? (
            <button onClick={clearFilters}
              style={{ padding: '10px 20px', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}>
              ✕ Clear filters
            </button>
          ) : (
            <button onClick={() => setCreating(true)}
              style={{ padding: '10px 20px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
              + Create first flow
            </button>
          )}
        </div>
      )}

      {/* Flow grid */}
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
          <button
            disabled={!pagination.has_prev}
            style={{ padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: pagination.has_prev ? 'var(--text2)' : 'var(--text3)', fontSize: '12px', cursor: pagination.has_prev ? 'pointer' : 'not-allowed', opacity: pagination.has_prev ? 1 : 0.4 }}>
            ← Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
            Page {pagination.page} of {pagination.pages}
          </span>
          <button
            disabled={!pagination.has_next}
            style={{ padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: pagination.has_next ? 'var(--text2)' : 'var(--text3)', fontSize: '12px', cursor: pagination.has_next ? 'pointer' : 'not-allowed', opacity: pagination.has_next ? 1 : 0.4 }}>
            Next →
          </button>
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
                  {flow.description && <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '10px' }}>{flow.description}</div>}
                  <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '12px' }}>
                    Archived {new Date(flow.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
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

// ─── FlowCard ─────────────────────────────────────────────────

function FlowCard({ flow, index, onDelete, onDuplicate, toast }) {
  const navigate = useNavigate()
  const hasPublished = !!flow.active_version_id
  const draftVersion = flow.versions?.find(v => v.status === 'draft')
  const [hovered, setHovered] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false)
  const stats = flow.stats

  // Close dropdown when clicking anywhere outside
  useEffect(() => {
    if (!showMenu) return
    const handler = () => setShowMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMenu])

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
    try { await api.deleteFlow(flow.id); onDelete(); toast('Flow archived') }
    catch (e) { toast(e.message, 'error') }
  }

  async function handlePermanentDelete() {
    setConfirmPermanentDelete(false)
    try { await api.permanentDeleteFlow(flow.id); onDelete(); toast('Flow permanently deleted') }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      {confirmDelete && (
        <ConfirmDialog title="ARCHIVE FLOW" message={`Archive "${flow.name}"? It will be moved to the archive and can be restored later.`}
          confirmLabel="Archive" confirmColor="var(--red)"
          onConfirm={handleDelete} onClose={() => setConfirmDelete(false)} />
      )}
      {confirmPermanentDelete && (
        <ConfirmDialog title="PERMANENTLY DELETE" message={`Permanently delete "${flow.name}"? This cannot be undone — all versions, nodes, and data will be lost forever.`}
          confirmLabel="Delete Forever" confirmColor="#dc2626"
          onConfirm={handlePermanentDelete} onClose={() => setConfirmPermanentDelete(false)} />
      )}

      <div className="fade-up"
        style={{ animationDelay: `${index * 0.04}s`, animationFillMode: 'both', opacity: 0, padding: '22px', background: hovered ? 'var(--surface2)' : 'var(--surface)', border: `1px solid ${hovered ? 'var(--border2)' : 'var(--border)'}`, borderRadius: '10px', transition: 'border-color 0.15s, background 0.15s', display: 'flex', flexDirection: 'column', position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setShowMenu(false) }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: '4px', background: hasPublished ? 'rgba(62,207,142,0.1)' : 'rgba(245,200,66,0.1)', color: hasPublished ? 'var(--green)' : 'var(--yellow)', border: `1px solid ${hasPublished ? 'rgba(62,207,142,0.3)' : 'rgba(245,200,66,0.3)'}` }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' }} />
              {hasPublished ? 'LIVE' : 'DRAFT'}
            </span>
            {flow.category && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '3px' }}>
                {flow.category}
              </span>
            )}
            {flow.tags?.slice(0, 2).map(tag => (
              <span key={tag} style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '3px', opacity: 0.7 }}>
                {tag}
              </span>
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <button onClick={e => { e.stopPropagation(); setShowMenu(s => !s) }}
              style={{ color: 'var(--text3)', fontSize: '16px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'color 0.1s, background 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.background = 'transparent' }}>⋯</button>
            {showMenu && (
              <div style={{ position: 'absolute', right: 0, top: '30px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', padding: '6px', zIndex: 100, width: '160px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                <MenuItemBtn label="⊕ Duplicate" onClick={handleDuplicate} />
                {draftVersion && <MenuItemBtn label="✎ Edit draft" onClick={() => { setShowMenu(false); navigate(`/build/${flow.id}/${draftVersion.id}`) }} />}
                {hasPublished && <MenuItemBtn label="▶ Run" onClick={() => { setShowMenu(false); navigate(`/execute/${flow.id}`) }} />}
                <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
                <MenuItemBtn label="⊘ Archive" onClick={() => { setShowMenu(false); setConfirmDelete(true) }} color="var(--red)" />
                <MenuItemBtn label="✕ Delete forever" onClick={() => { setShowMenu(false); setConfirmPermanentDelete(true) }} color="#ef4444" />
              </div>
            )}
          </div>
        </div>

        <h3 style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px', color: 'var(--text)', letterSpacing: '-0.01em' }}>{flow.name}</h3>
        {flow.description
          ? <p style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.5, flex: 1, marginBottom: '14px' }}>{flow.description}</p>
          : <div style={{ flex: 1, marginBottom: '14px' }} />
        }

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
          {draftVersion && !hasPublished && (
            <button onClick={() => navigate(`/build/${flow.id}/${draftVersion.id}`)}
              style={{ flex: 1, padding: '8px 12px', background: 'rgba(62,207,142,0.08)', color: 'var(--green)', border: '1px solid rgba(62,207,142,0.25)', borderRadius: '6px', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(62,207,142,0.15)'; e.currentTarget.style.borderColor = 'rgba(62,207,142,0.5)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(62,207,142,0.08)'; e.currentTarget.style.borderColor = 'rgba(62,207,142,0.25)' }}>
              ✎ Edit Draft
            </button>
          )}
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