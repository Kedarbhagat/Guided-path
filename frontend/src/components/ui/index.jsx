import { useEffect } from 'react'

// ─── TOAST ────────────────────────────────────────────────────

export function ToastContainer({ toasts }) {
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none',
    }}>
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  )
}

function Toast({ toast: t }) {
  const colors = {
    error: { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', icon: '✕' },
    warn:  { bg: '#fffbeb', border: '#fde68a', text: '#b45309', icon: '⚠' },
    success: { bg: '#f0fdf4', border: '#86efac', text: '#16a34a', icon: '✓' },
  }
  const c = colors[t.type] || colors.success

  return (
    <div style={{
      padding: '12px 18px', borderRadius: '8px', fontSize: '13px',
      fontFamily: 'var(--mono)', background: c.bg,
      border: `1px solid ${c.border}`, color: c.text,
      animation: 'fadeUp 0.2s ease', boxShadow: '0 4px 20px rgba(15,23,42,0.1)',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <span>{c.icon}</span>
      {t.msg}
    </div>
  )
}

// ─── MODAL ────────────────────────────────────────────────────

export function Modal({ title, children, onClose, width = '420px' }) {
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)',
        animation: 'fadeIn 0.15s ease',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: '12px', padding: '28px', width,
          maxWidth: 'calc(100vw - 48px)',
          boxShadow: '0 20px 60px rgba(15,23,42,0.08)',
          animation: 'fadeUp 0.2s ease', maxHeight: '90vh', overflowY: 'auto',
        }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: '20px',
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: '11px',
            color: 'var(--text3)', letterSpacing: '0.08em',
          }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              color: 'var(--text3)', fontSize: '20px', lineHeight: 1,
              width: '28px', height: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '4px',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────

export function ConfirmDialog({
  title, message,
  confirmLabel = 'Confirm',
  confirmColor = 'var(--red)',
  onConfirm, onClose,
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ color: 'var(--text2)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={onConfirm}
          style={{
            flex: 1, padding: '10px', background: confirmColor,
            color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
          }}>
          {confirmLabel}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '10px 16px', border: '1px solid var(--border)',
            color: 'var(--text2)', borderRadius: '6px', fontSize: '13px',
          }}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ─── MISC SMALL COMPONENTS ────────────────────────────────────

export function MenuItemBtn({ label, onClick, color = 'var(--text2)' }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: '5px',
        fontSize: '12px', color, transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {label}
    </button>
  )
}

export function FilterBtn({ label, value, current, onChange }) {
  const active = current === value
  return (
    <button
      onClick={() => onChange(active ? '' : value)}
      style={{
        padding: '5px 12px', borderRadius: '5px', fontSize: '12px',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? '#eff6ff' : 'var(--surface2)',
        color: active ? 'var(--accent2)' : 'var(--text3)',
        transition: 'all 0.15s',
      }}>
      {label}
    </button>
  )
}

export function ToolbarBtn({ onClick, label, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 13px', background: 'var(--surface2)',
        border: '1px solid var(--border)', color: color || 'var(--text2)',
        borderRadius: '5px', fontSize: '12px', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color || 'var(--border2)'; e.currentTarget.style.color = color || 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = color || 'var(--text2)' }}>
      {label}
    </button>
  )
}

export function StatMini({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)',
        marginBottom: '2px', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

export function PanelField({ label, children }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{
        fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)',
        marginBottom: '6px', letterSpacing: '0.08em',
      }}>{label}</div>
      {children}
    </div>
  )
}