import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../../api'

// ── Confidence bar ─────────────────────────────────────────────
function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? '#3ecf8e' : pct >= 55 ? '#f5c842' : '#55556a'
  const label = pct >= 80 ? 'HIGH' : pct >= 55 ? 'MEDIUM' : 'LOW'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '160px' }}>
      <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: '2px', transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, color }}>{pct}%</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', letterSpacing: '0.08em' }}>{label}</span>
      </div>
    </div>
  )
}

// ── Skeleton loader ────────────────────────────────────────────
function SkeletonCard({ delay = 0 }) {
  return (
    <div style={{
      padding: '28px 32px', background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '12px', animation: 'pulse 1.5s infinite',
      animationDelay: `${delay}s`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div style={{ height: '18px', width: '200px', background: 'var(--surface2)', borderRadius: '4px' }} />
        <div style={{ height: '32px', width: '72px', background: 'var(--surface2)', borderRadius: '6px' }} />
      </div>
      <div style={{ height: '12px', width: '100%', background: 'var(--surface2)', borderRadius: '3px', marginBottom: '8px' }} />
      <div style={{ height: '12px', width: '75%', background: 'var(--surface2)', borderRadius: '3px', marginBottom: '20px' }} />
      <div style={{ height: '4px', width: '100%', background: 'var(--surface2)', borderRadius: '2px' }} />
    </div>
  )
}

// ── Match card ────────────────────────────────────────────────
function MatchCard({ match, isTop, onRun, index }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${index * 0.07}s`, animationFillMode: 'both', opacity: 0,
        padding: '28px 32px',
        background: hovered
          ? (isTop ? 'rgba(79,110,247,0.06)' : 'var(--surface2)')
          : (isTop ? 'rgba(79,110,247,0.03)' : 'var(--surface)'),
        border: `1px solid ${isTop ? (hovered ? 'var(--accent)' : 'rgba(79,110,247,0.4)') : (hovered ? 'var(--border2)' : 'var(--border)')}`,
        borderRadius: '12px',
        transition: 'background 0.15s, border-color 0.15s',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isTop && (
        <div style={{
          position: 'absolute', top: '-1px', left: '24px',
          fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '0.1em',
          background: 'var(--accent)', color: '#fff',
          padding: '2px 8px', borderRadius: '0 0 5px 5px',
        }}>
          BEST MATCH
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
        <div style={{ flex: 1, minWidth: 0, paddingTop: isTop ? '10px' : '0' }}>
          <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px', letterSpacing: '-0.01em' }}>
            {match.flow_name}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.6, marginBottom: '18px' }}>
            {match.reasoning}
          </div>
          <ConfidenceBar value={match.confidence} />
        </div>

        <button
          onClick={() => onRun(match.flow_id, match.active_version_id)}
          style={{
            flexShrink: 0, marginTop: isTop ? '10px' : '0',
            padding: '9px 20px',
            background: isTop ? 'var(--accent)' : 'var(--surface2)',
            color: isTop ? '#fff' : 'var(--text2)',
            border: isTop ? 'none' : '1px solid var(--border)',
            borderRadius: '7px', fontSize: '13px', fontWeight: 500,
            transition: 'opacity 0.15s, transform 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          ▶ Run flow
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function FlowSuggestions() {
  const navigate = useNavigate()
  const location = useLocation()

  // Issue text passed via router state from the modal
  const issue = location.state?.issue || ''

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!issue) { navigate('/', { replace: true }); return }
    runSearch(issue)
  }, [issue])

  async function runSearch(text) {
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await api.suggestFlow(text.trim(), 'groq')
      setResult(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const allMatches = result
    ? [result.top_match, ...(result.alternatives || [])].filter(Boolean)
    : []

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '48px 56px' }}>

      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)',
            letterSpacing: '0.06em', marginBottom: '24px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
        >
          ← BACK TO FLOWS
        </button>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: '10px' }}>
          AI FLOW MATCH
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: 400, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: '16px' }}>
          Flow Suggestions
        </h1>

        {/* Issue summary card */}
        <div style={{
          padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '8px', maxWidth: '720px',
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: '6px' }}>ISSUE</div>
          <div style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{issue}</div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', letterSpacing: '0.08em', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', border: '2px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            Searching {' '}<span style={{ color: 'var(--accent)' }}>published flows</span>…
          </div>
          <SkeletonCard delay={0} />
          <SkeletonCard delay={0.1} />
          <SkeletonCard delay={0.2} />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{ maxWidth: '720px', padding: '24px', background: 'rgba(242,92,92,0.06)', border: '1px solid rgba(242,92,92,0.3)', borderRadius: '10px' }}>
          <div style={{ fontSize: '13px', color: 'var(--red)', marginBottom: '12px' }}>{error}</div>
          <button
            onClick={() => runSearch(issue)}
            style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', color: 'var(--text2)' }}
          >
            ↺ Retry
          </button>
        </div>
      )}

      {/* No match */}
      {result?.no_match && !loading && (
        <div style={{ maxWidth: '720px', padding: '40px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '14px' }}>◇</div>
          <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>No strong match found</div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', maxWidth: '360px', margin: '0 auto' }}>
            Try rephrasing the issue, or publish more flows that cover this topic.
          </div>
          <button
            onClick={() => navigate('/')}
            style={{ marginTop: '24px', padding: '9px 20px', background: 'var(--accent)', color: '#fff', borderRadius: '7px', fontSize: '13px', fontWeight: 500 }}
          >
            ← Go back
          </button>
        </div>
      )}

      {/* Results */}
      {result && !result.no_match && !loading && (
        <div style={{ maxWidth: '720px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {allMatches.map((match, i) => (
              <MatchCard
                key={match.flow_id}
                match={match}
                isTop={i === 0}
                index={i}
                onRun={(flowId, versionId) => navigate(`/execute/${flowId}/${versionId}`)}
              />
            ))}
          </div>

          {/* Footer meta */}
          <div style={{
            marginTop: '24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
            fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.06em',
          }}>
            <span>{result.meta?.flows_searched} published flows searched</span>
            <span style={{ color: 'var(--border2)' }}>·</span>
            <span>{result.meta?.model}</span>
            <span style={{ color: 'var(--border2)' }}>·</span>
            <span style={{ color: 'var(--accent)', opacity: 0.7 }}>groq</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}