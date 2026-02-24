import { Link } from 'react-router-dom'

export default function Nav() {
  return (
    <nav style={{
      display: 'flex', alignItems: 'center', padding: '0 24px',
      height: '52px', borderBottom: '1px solid var(--border)',
      background: 'var(--surface)', flexShrink: 0,
    }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '35px', height: '35px', borderRadius: '50%',
          background: '#1a56db', display: 'flex', alignItems: 'center',
          justifyContent: 'center', overflow: 'hidden',
        }}>
          <svg viewBox="0 0 40 40" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle"
              fontFamily="'DM Sans', system-ui, sans-serif" fontWeight="900"
              fontSize="22" fill="#ffffff" letterSpacing="-0.5">P44</text>
          </svg>
        </div>
        <span style={{ color: 'var(--text2)', fontSize: '13px', fontWeight: 400 }}>
          Project44 : Guided Path
        </span>
      </Link>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <NavLink to="/">Flows</NavLink>
        <NavLink to="/analytics">Analytics</NavLink>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)',
          padding: '2px 7px', border: '1px solid var(--border)', borderRadius: '4px',
        }}>v1.0.0</span>
      </div>
    </nav>
  )
}

function NavLink({ to, children }) {
  return (
    <Link to={to}
      style={{ fontSize: '13px', color: 'var(--text3)' }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
      {children}
    </Link>
  )
}