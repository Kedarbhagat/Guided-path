import { useState, useEffect } from 'react'
import { api } from '../../api'
import { useToast } from '../../hooks'
import { ToastContainer } from '../ui'

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toasts, add: toast } = useToast()

  useEffect(() => {
    api.getAnalyticsOverview()
      .then(setData)
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ padding: '48px 56px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ height: '100px', background: 'var(--surface)', borderRadius: '10px', animation: 'pulse 1.5s infinite' }} />)}
      </div>
    </div>
  )

  const d = data || {}
  const sessions = d.sessions || {}
  const flows = d.flows || {}
  const perf = d.performance || {}
  const over_time = d.sessions_over_time || []
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
        <StatCard label="TOTAL FLOWS" value={flows.total} sub={`${flows.live || 0} live · ${flows.draft || 0} draft`} />
        <StatCard label="TOTAL SESSIONS" value={sessions.total} sub={`${sessions.completion_rate || 0}% completion rate`} color="var(--accent2)" />
        <StatCard label="ESCALATION RATE" value={sessions.escalation_rate != null ? `${sessions.escalation_rate}%` : null} sub="of completed sessions" color="var(--yellow)" />
        <StatCard label="AVG HANDLE TIME" value={perf.avg_duration_seconds != null ? `${perf.avg_duration_seconds}s` : null} sub={perf.avg_feedback_rating ? `★ ${perf.avg_feedback_rating} avg rating` : 'No ratings yet'} color="var(--green)" />
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

function StatCard({ label, value, sub, color = 'var(--text)' }) {
  return (
    <div style={{ padding: '20px 24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginBottom: '10px', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 300, color, letterSpacing: '-0.03em', marginBottom: '4px' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{sub}</div>}
    </div>
  )
}