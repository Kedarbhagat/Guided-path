import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export default function Dashboard() {
  const [flows, setFlows] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.getFlows()
      .then(setFlows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function createFlow(e) {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      const flow = await api.createFlow({ name: newName.trim() })
      const version = flow.active_version_id || null
      // Get the draft version id
      const full = await api.getFlow(flow.id)
      const draftVersion = full.versions?.[0]
      setFlows(prev => [full, ...prev])
      setNewName('')
      setCreating(false)
      if (draftVersion) navigate(`/build/${flow.id}/${draftVersion.id}`)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '40px 48px' }}>

      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px'
            }}>Decision Flows</div>
            <h1 style={{ fontSize: '28px', fontWeight: 300, color: 'var(--text)', lineHeight: 1.2 }}>
              Resolution Flows
            </h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', background: 'var(--accent)',
              color: '#fff', borderRadius: '6px', fontSize: '13px',
              fontWeight: 500, transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.target.style.opacity = '0.85'}
            onMouseLeave={e => e.target.style.opacity = '1'}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> New Flow
          </button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={createFlow} style={{
          display: 'flex', gap: '12px', marginBottom: '32px',
          padding: '20px', background: 'var(--surface)',
          border: '1px solid var(--accent)', borderRadius: '8px',
          animation: 'fadeUp 0.2s ease',
        }}>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Flow name — e.g. Missing Milestone"
            style={{
              flex: 1, padding: '10px 14px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '6px', color: 'var(--text)', fontSize: '14px',
              outline: 'none',
            }}
          />
          <button type="submit" style={{
            padding: '10px 20px', background: 'var(--accent)',
            color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
          }}>Create</button>
          <button type="button" onClick={() => setCreating(false)} style={{
            padding: '10px 16px', color: 'var(--text2)', fontSize: '13px',
          }}>Cancel</button>
        </form>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', background: '#2a1010', border: '1px solid var(--red)',
          borderRadius: '6px', color: 'var(--red)', fontSize: '13px', marginBottom: '24px',
        }}>{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
          Loading flows...
        </div>
      )}

      {/* Empty */}
      {!loading && flows.length === 0 && !creating && (
        <div style={{
          textAlign: 'center', padding: '80px 0',
          color: 'var(--text3)',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>⬡</div>
          <div style={{ fontSize: '15px', marginBottom: '8px', color: 'var(--text2)' }}>No flows yet</div>
          <div style={{ fontSize: '13px' }}>Create your first resolution flow to get started</div>
        </div>
      )}

      {/* Flow grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {flows.map((flow, i) => (
          <FlowCard key={flow.id} flow={flow} index={i} />
        ))}
      </div>
    </div>
  )
}

function FlowCard({ flow, index }) {
  const navigate = useNavigate()
  const hasPublished = !!flow.active_version_id
  const draftVersion = flow.versions?.find(v => v.status === 'draft')

  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${index * 0.05}s`,
        animationFillMode: 'both',
        opacity: 0,
        padding: '24px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border2)'
        e.currentTarget.style.background = 'var(--surface2)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--surface)'
      }}
    >
      {/* Status + category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.08em',
          padding: '3px 8px', borderRadius: '4px',
          background: hasPublished ? '#0d2a1a' : '#1a1a0a',
          color: hasPublished ? 'var(--green)' : 'var(--yellow)',
          border: `1px solid ${hasPublished ? '#1a4a2a' : '#3a3a10'}`,
        }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' }} />
          {hasPublished ? 'LIVE' : 'DRAFT'}
        </span>
        {flow.category && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>
            {flow.category}
          </span>
        )}
      </div>

      <h3 style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px', color: 'var(--text)' }}>
        {flow.name}
      </h3>
      {flow.description && (
        <p style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '20px', lineHeight: 1.5 }}>
          {flow.description}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
        {hasPublished && (
          <button
            onClick={() => navigate(`/execute/${flow.id}`)}
            style={{
              flex: 1, padding: '8px', background: 'var(--accent)',
              color: '#fff', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
            }}
          >
            ▶ Run Flow
          </button>
        )}
        {draftVersion && (
          <button
            onClick={() => navigate(`/build/${flow.id}/${draftVersion.id}`)}
            style={{
              flex: 1, padding: '8px',
              background: 'var(--surface2)', color: 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: '5px', fontSize: '12px',
            }}
          >
            ✎ Edit
          </button>
        )}
      </div>
    </div>
  )
}