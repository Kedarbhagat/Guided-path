import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export default function AgentExecution() {
  const { flowId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stepping, setStepping] = useState(false)
  const [error, setError] = useState(null)
  const [ticketId, setTicketId] = useState('')
  const [started, setStarted] = useState(false)

  async function startSession() {
    setLoading(true)
    setError(null)
    try {
      const s = await api.startSession({ flow_id: flowId, ticket_id: ticketId || undefined })
      setSession(s)
      setStarted(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function selectOption(edgeId) {
    if (stepping) return
    setStepping(true)
    try {
      const s = await api.submitStep(session.session_id, edgeId)
      setSession(s)
    } catch (e) {
      setError(e.message)
    } finally {
      setStepping(false)
    }
  }

  async function goBack() {
    try {
      const s = await api.goBack(session.session_id)
      setSession(s)
    } catch (e) {
      setError(e.message)
    }
  }

  async function restart() {
    try {
      const s = await api.restartSession(session.session_id)
      setSession(s)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    setLoading(false)
  }, [])

  // Start screen
  if (!started) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div style={{
          width: '440px', padding: '48px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '12px', animation: 'fadeUp 0.3s ease',
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '16px',
          }}>Agent Mode</div>
          <h2 style={{ fontSize: '22px', fontWeight: 400, marginBottom: '8px' }}>Start Resolution Session</h2>
          <p style={{ color: 'var(--text2)', fontSize: '13px', marginBottom: '32px' }}>
            Enter a ticket ID to associate this session with a support ticket.
          </p>

          {error && (
            <div style={{
              padding: '12px', background: '#2a1010', border: '1px solid var(--red)',
              borderRadius: '6px', color: 'var(--red)', fontSize: '13px', marginBottom: '20px',
            }}>{error}</div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text2)', marginBottom: '8px', fontFamily: 'var(--mono)' }}>
              TICKET ID (optional)
            </label>
            <input
              value={ticketId}
              onChange={e => setTicketId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startSession()}
              placeholder="e.g. ZD-12345"
              style={{
                width: '100%', padding: '10px 14px',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text)', fontSize: '14px',
                outline: 'none', fontFamily: 'var(--mono)',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={startSession}
              style={{
                flex: 1, padding: '12px',
                background: 'var(--accent)', color: '#fff',
                borderRadius: '6px', fontSize: '14px', fontWeight: 500,
              }}
            >
              Start Session
            </button>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '12px 16px', color: 'var(--text2)', fontSize: '13px',
                border: '1px solid var(--border)', borderRadius: '6px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) return <Loader />
  if (!session) return null

  const isCompleted = session.status === 'completed'
  const node = session.current_node

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg)' }}>

      {/* Left sidebar - breadcrumb */}
      <div style={{
        width: '260px', flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '32px 24px',
        overflowY: 'auto',
      }}>
        <button onClick={() => navigate('/')} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          color: 'var(--text3)', fontSize: '12px', marginBottom: '32px',
          fontFamily: 'var(--mono)',
        }}>
          ← Back
        </button>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: '16px' }}>
          PATH TAKEN
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {(session.breadcrumb || []).map((crumb, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  background: i === (session.breadcrumb.length - 1) ? 'var(--accent)' : 'var(--border2)',
                  marginTop: '4px',
                }} />
                {i < session.breadcrumb.length - 1 && (
                  <div style={{ width: '1px', flex: 1, minHeight: '24px', background: 'var(--border)', margin: '4px 0' }} />
                )}
              </div>
              <div style={{
                fontSize: '12px', paddingBottom: '16px',
                color: i === (session.breadcrumb.length - 1) ? 'var(--text)' : 'var(--text3)',
                lineHeight: 1.4,
              }}>
                {crumb}
              </div>
            </div>
          ))}
        </div>

        {session.breadcrumb?.length > 0 && (
          <div style={{
            marginTop: '24px', paddingTop: '24px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)',
          }}>
            Step {session.step_number}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', overflowY: 'auto' }}>
        {isCompleted ? (
          <ResultCard node={node} session={session} onRestart={restart} onBack={() => navigate('/')} />
        ) : (
          <QuestionCard
            node={node}
            options={session.options || []}
            onSelect={selectOption}
            onBack={session.step_number > 1 ? goBack : null}
            onRestart={restart}
            stepping={stepping}
          />
        )}
      </div>
    </div>
  )
}

function QuestionCard({ node, options, onSelect, onBack, onRestart, stepping }) {
  return (
    <div style={{ width: '100%', maxWidth: '560px', animation: 'fadeUp 0.25s ease' }}>
      {/* Node type tag */}
      <div style={{
        fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)',
        letterSpacing: '0.1em', marginBottom: '24px',
      }}>
        QUESTION · {node.type?.toUpperCase()}
      </div>

      {/* Question */}
      <h2 style={{ fontSize: '22px', fontWeight: 400, lineHeight: 1.4, marginBottom: '12px', color: 'var(--text)' }}>
        {node.title}
      </h2>

      {node.body && (
        <p style={{ color: 'var(--text2)', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px' }}>
          {node.body}
        </p>
      )}

      {!node.body && <div style={{ marginBottom: '32px' }} />}

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '32px' }}>
        {options.map((opt, i) => (
          <button
            key={opt.edge_id}
            onClick={() => onSelect(opt.edge_id)}
            disabled={stepping}
            style={{
              padding: '16px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text)',
              fontSize: '14px',
              textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              transition: 'border-color 0.15s, background 0.15s',
              opacity: stepping ? 0.6 : 1,
              animationDelay: `${i * 0.05}s`,
            }}
            onMouseEnter={e => {
              if (!stepping) {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.background = 'var(--surface2)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.background = 'var(--surface)'
            }}
          >
            <span>{opt.label}</span>
            <span style={{ color: 'var(--text3)', fontSize: '16px' }}>→</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {onBack && (
          <button onClick={onBack} style={{
            padding: '8px 16px', color: 'var(--text2)', fontSize: '12px',
            border: '1px solid var(--border)', borderRadius: '5px',
            fontFamily: 'var(--mono)',
          }}>
            ← Back
          </button>
        )}
        <button onClick={onRestart} style={{
          padding: '8px 16px', color: 'var(--text3)', fontSize: '12px',
          fontFamily: 'var(--mono)',
        }}>
          ↺ Restart
        </button>
      </div>
    </div>
  )
}

function ResultCard({ node, session, onRestart, onBack }) {
  const isEscalation = node.metadata?.escalate_to
  return (
    <div style={{ width: '100%', maxWidth: '560px', animation: 'fadeUp 0.25s ease' }}>
      {/* Status */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '6px 12px', borderRadius: '6px', marginBottom: '28px',
        background: isEscalation ? '#2a1010' : '#0d2a1a',
        border: `1px solid ${isEscalation ? '#4a2020' : '#1a4a2a'}`,
        color: isEscalation ? 'var(--red)' : 'var(--green)',
        fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.08em',
      }}>
        <span>{isEscalation ? '⚠' : '✓'}</span>
        {isEscalation ? 'ESCALATION REQUIRED' : 'RESOLVED'}
      </div>

      <h2 style={{ fontSize: '22px', fontWeight: 400, lineHeight: 1.4, marginBottom: '20px' }}>
        {node.title}
      </h2>

      {node.metadata?.resolution && (
        <div style={{
          padding: '20px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: '8px',
          fontSize: '14px', lineHeight: 1.7, color: 'var(--text2)',
          marginBottom: '20px',
        }}>
          {node.metadata.resolution}
        </div>
      )}

      {isEscalation && (
        <div style={{
          padding: '16px 20px', background: '#1a0a0a',
          border: '1px solid #4a2020', borderRadius: '8px',
          marginBottom: '20px',
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--red)', marginBottom: '6px' }}>
            ESCALATE TO
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text)' }}>{node.metadata.escalate_to}</div>
        </div>
      )}

      <div style={{
        padding: '12px 16px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: '6px',
        fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)',
        marginBottom: '28px',
      }}>
        {session.step_number} steps · Session {session.session_id?.slice(0, 8)}
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={onRestart} style={{
          padding: '10px 20px', background: 'var(--surface)',
          border: '1px solid var(--border)', color: 'var(--text2)',
          borderRadius: '6px', fontSize: '13px',
        }}>
          ↺ New Session
        </button>
        <button onClick={onBack} style={{
          padding: '10px 20px', background: 'var(--accent)',
          color: '#fff', borderRadius: '6px', fontSize: '13px',
        }}>
          ← All Flows
        </button>
      </div>
    </div>
  )
}

function Loader() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text3)', animation: 'pulse 1.5s infinite' }}>
        Loading...
      </div>
    </div>
  )
}