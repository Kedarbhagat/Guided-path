import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Modal } from '../ui'

export default function AgentExecution() {
  const { flowId, versionId: testVersionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stepping, setStepping] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [error, setError] = useState(null)
  const [ticketId, setTicketId] = useState('')
  const [agentName, setAgentName] = useState('')
  const [showStart, setShowStart] = useState(!testVersionId)
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportData, setExportData] = useState(null)

  useEffect(() => {
    if (testVersionId) startSession()
  }, [])

  async function startSession() {
    setLoading(true)
    setShowStart(false)
    try {
      const s = await api.startSession({
        flow_id: flowId,
        version_id: testVersionId || undefined,
        ticket_id: ticketId || undefined,
        agent_name: agentName || undefined,
      })
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
    setFeedbackRating(0)
    setFeedbackNote('')
    setFeedbackSubmitted(false)
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
    return <SessionStartScreen
      ticketId={ticketId} setTicketId={setTicketId}
      agentName={agentName} setAgentName={setAgentName}
      onStart={startSession}
      onBack={() => testVersionId ? navigate(`/build/${flowId}/${testVersionId}`) : navigate('/')}
      isTestMode={!!testVersionId}
    />
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

      {showExport && exportData && (
        <Modal title="EXPORT SESSION" onClose={() => setShowExport(false)} width="540px">
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
            <button onClick={() => copyToClipboard(JSON.stringify(exportData, null, 2))}
              style={{ padding: '7px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '12px' }}>
              ⎘ Copy JSON
            </button>
            <button onClick={() => {
              const lines = [
                `Session: ${exportData.session_id}`,
                `Ticket: ${exportData.ticket_id || '—'}`,
                `Agent: ${exportData.agent_name || '—'}`,
                `Status: ${exportData.status}`,
                `Duration: ${exportData.duration_seconds}s`,
                '', 'Transcript:',
                ...(exportData.transcript || []).map(t => `  ${t.step}. ${t.question}\n     → ${t.answer}`),
                '', exportData.resolution ? `Resolution: ${exportData.resolution.title}` : '',
              ]
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
      <SessionSidebar
        session={session}
        breadcrumb={breadcrumb}
        isCompleted={isCompleted}
        testVersionId={testVersionId}
        flowId={flowId}
        onExport={handleExport}
        onBack={() => testVersionId ? navigate(`/build/${flowId}/${testVersionId}`) : navigate('/')}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', overflowY: 'auto' }}>
        {error && (
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 16px', background: '#fef2f2', border: '1px solid var(--red)', borderRadius: '6px', color: 'var(--red)', fontSize: '13px', zIndex: 10, whiteSpace: 'nowrap' }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: '10px', opacity: 0.6, color: 'var(--red)' }}>✕</button>
          </div>
        )}

        {isCompleted
          ? <ResultCard
              node={node} session={session}
              onRestart={restart}
              feedbackRating={feedbackRating} setFeedbackRating={setFeedbackRating}
              feedbackNote={feedbackNote} setFeedbackNote={setFeedbackNote}
              feedbackSubmitted={feedbackSubmitted}
              onSubmitFeedback={submitFeedback}
            />
          : <QuestionCard
              key={node?.id}
              node={node}
              options={session.options || []}
              onSelect={selectOption}
              onBack={session.step_number > 1 ? goBack : null}
              onRestart={restart}
              stepping={stepping}
              selectedEdge={selectedEdge}
            />
        }
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function SessionStartScreen({ ticketId, setTicketId, agentName, setAgentName, onStart, onBack }) {
  const inputStyle = {
    width: '100%', padding: '10px 12px', background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: '6px',
    color: 'var(--text)', fontSize: '14px', outline: 'none',
    transition: 'border-color 0.15s',
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '420px', animation: 'fadeUp 0.2s ease' }}>
        <button onClick={onBack}
          style={{ color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
          ← Back to flows
        </button>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--accent)', marginBottom: '12px', letterSpacing: '0.1em' }}>START SESSION</div>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: 'var(--text)', marginBottom: '28px', letterSpacing: '-0.02em' }}>Session details</h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>TICKET ID (OPTIONAL)</label>
          <input value={ticketId} onChange={e => setTicketId(e.target.value)}
            placeholder="e.g. TKT-12345"
            onKeyDown={e => e.key === 'Enter' && onStart()}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'} />
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>AGENT NAME (OPTIONAL)</label>
          <input value={agentName} onChange={e => setAgentName(e.target.value)}
            placeholder="Your name"
            onKeyDown={e => e.key === 'Enter' && onStart()}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'} />
        </div>

        <button onClick={onStart}
          style={{ width: '100%', padding: '12px', background: 'var(--accent)', color: '#fff', borderRadius: '7px', fontSize: '14px', fontWeight: 500, transition: 'opacity 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
          Start Session ↵
        </button>
      </div>
    </div>
  )
}

function SessionSidebar({ session, breadcrumb, isCompleted, testVersionId, flowId, onExport, onBack }) {
  return (
    <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 0' }}>
        <button onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text3)', fontSize: '11px', fontFamily: 'var(--mono)', marginBottom: '16px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
          ← {testVersionId ? 'Back to Builder' : 'Back'}
        </button>

        {testVersionId && (
          <div style={{ marginBottom: '16px', padding: '8px 10px', background: '#fffbeb', border: '1px solid #3a2e00', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>⚠</span>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#b45309', letterSpacing: '0.1em', fontWeight: 600 }}>TEST MODE</div>
              <div style={{ fontSize: '10px', color: '#92400e', marginTop: '1px' }}>Running draft — not the published version</div>
            </div>
          </div>
        )}

        {(session.ticket_id || session.agent_name) && (
          <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: '6px', marginBottom: '20px' }}>
            {session.ticket_id && (
              <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>TICKET</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent2)', marginBottom: session.agent_name ? '8px' : 0 }}>{session.ticket_id}</div>
              </>
            )}
            {session.agent_name && (
              <>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', marginBottom: '2px' }}>AGENT</div>
                <div style={{ fontSize: '12px', color: 'var(--text)' }}>{session.agent_name}</div>
              </>
            )}
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
          <button onClick={onExport}
            style={{ width: '100%', padding: '7px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text2)', fontSize: '11px', fontFamily: 'var(--mono)', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
            ↓ Export session
          </button>
        )}
      </div>
    </div>
  )
}

function QuestionCard({ node, options, onSelect, onBack, onRestart, stepping, selectedEdge }) {
  useEffect(() => {
    const handler = (e) => {
      const n = parseInt(e.key)
      if (!isNaN(n) && n >= 1 && n <= options.length && !stepping) {
        onSelect(options[n - 1].edge_id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
                padding: '15px 20px',
                background: isSelected ? 'var(--accent)' : 'var(--surface)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '8px', color: isSelected ? '#fff' : 'var(--text)',
                fontSize: '14px', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.15s',
                opacity: (stepping && !isSelected) ? 0.4 : 1,
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
    const text = [node.title, node.metadata?.resolution, isEscalation ? `Escalate to: ${node.metadata.escalate_to}` : '']
      .filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ width: '100%', maxWidth: '580px', animation: 'fadeUp 0.2s ease' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderRadius: '20px', marginBottom: '28px', background: isEscalation ? '#fef2f2' : '#f0fdf4', border: `1px solid ${isEscalation ? '#fca5a5' : '#86efac'}`, color: isEscalation ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.08em' }}>
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
        <div style={{ padding: '16px 20px', background: '#fef2f2', border: '1px solid #5a2020', borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>⚠</div>
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
              <textarea value={feedbackNote} onChange={e => setFeedbackNote(e.target.value)}
                placeholder="Any comments? (optional)" rows={2}
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
        <div style={{ padding: '14px 18px', background: '#f0fdf4', border: '1px solid #1a5a2a', borderRadius: '8px', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '12px', marginBottom: '20px' }}>
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