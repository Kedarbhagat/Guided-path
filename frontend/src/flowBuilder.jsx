import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

// Simple canvas-based flow builder without React Flow dependency issues
export default function FlowBuilder() {
  const { flowId, versionId } = useParams()
  const navigate = useNavigate()
  const [version, setVersion] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedNode, setSelectedNode] = useState(null)
  const [editingNode, setEditingNode] = useState(null)
  const [addingEdge, setAddingEdge] = useState(null) // source node id
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    api.getVersion(flowId, versionId)
      .then(v => {
        setVersion(v)
        setNodes(v.nodes || [])
        setEdges(v.edges || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [flowId, versionId])

  async function addNode(type) {
    const isFirstNode = nodes.length === 0
    try {
      const node = await api.createNode(versionId, {
        title: type === 'result' ? 'Resolution' : 'New Question',
        type,
        is_start: isFirstNode,
        position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 },
      })
      setNodes(prev => [...prev, node])
      setEditingNode(node)
    } catch (e) {
      setError(e.message)
    }
  }

  async function updateNode(nodeId, data) {
    try {
      const updated = await api.updateNode(versionId, nodeId, data)
      setNodes(prev => prev.map(n => n.id === nodeId ? updated : n))
      setEditingNode(updated)
    } catch (e) {
      setError(e.message)
    }
  }

  async function deleteNode(nodeId) {
    try {
      await api.deleteNode(versionId, nodeId)
      setNodes(prev => prev.filter(n => n.id !== nodeId))
      setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId))
      setSelectedNode(null)
      setEditingNode(null)
    } catch (e) {
      setError(e.message)
    }
  }

  async function addEdge(sourceId, targetId, label) {
    if (sourceId === targetId) return
    try {
      const edge = await api.createEdge(versionId, {
        source: sourceId,
        target: targetId,
        condition_label: label,
      })
      setEdges(prev => [...prev, edge])
    } catch (e) {
      setError(e.message)
    }
    setAddingEdge(null)
  }

  async function deleteEdge(edgeId) {
    try {
      await api.deleteEdge(versionId, edgeId)
      setEdges(prev => prev.filter(e => e.id !== edgeId))
    } catch (e) {
      setError(e.message)
    }
  }

  async function publish() {
    setSaving(true)
    setError(null)
    try {
      await api.publishVersion(flowId, versionId)
      setSuccess('Flow published! Agents can now run it.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', animation: 'pulse 1.5s infinite' }}>Loading...</div>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '16px',
        padding: '0 20px', height: '52px', flexShrink: 0,
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
      }}>
        <button onClick={() => navigate('/')} style={{ color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)' }}>
          ← Back
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
        <span style={{ fontSize: '13px', color: 'var(--text2)' }}>
          {version?.status === 'published' ? '📡 Published' : '✏️ Draft'}
        </span>
        <div style={{ flex: 1 }} />

        {/* Add node buttons */}
        <button onClick={() => addNode('question')} style={{
          padding: '7px 14px', background: 'var(--surface2)',
          border: '1px solid var(--border)', color: 'var(--text)',
          borderRadius: '5px', fontSize: '12px',
        }}>+ Question</button>
        <button onClick={() => addNode('result')} style={{
          padding: '7px 14px', background: 'var(--surface2)',
          border: '1px solid var(--border)', color: 'var(--green)',
          borderRadius: '5px', fontSize: '12px',
        }}>+ Result</button>
        <button onClick={() => addNode('conditional')} style={{
          padding: '7px 14px', background: 'var(--surface2)',
          border: '1px solid var(--border)', color: 'var(--yellow)',
          borderRadius: '5px', fontSize: '12px',
        }}>+ Conditional</button>

        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />

        {addingEdge && (
          <span style={{
            fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--accent)',
            padding: '5px 10px', background: '#0d1a3a', border: '1px solid var(--accent)',
            borderRadius: '4px', animation: 'pulse 1s infinite',
          }}>
            Click target node → or ESC to cancel
          </span>
        )}

        <button
          onClick={publish}
          disabled={saving || version?.status === 'published'}
          style={{
            padding: '7px 18px', background: 'var(--accent)',
            color: '#fff', borderRadius: '5px', fontSize: '12px',
            fontWeight: 500, opacity: (saving || version?.status === 'published') ? 0.5 : 1,
          }}
        >
          {saving ? 'Publishing...' : version?.status === 'published' ? 'Published' : 'Publish'}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div style={{
          padding: '10px 20px', background: '#2a1010',
          borderBottom: '1px solid var(--red)',
          color: 'var(--red)', fontSize: '13px', flexShrink: 0,
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '12px', color: 'var(--red)', opacity: 0.7 }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{
          padding: '10px 20px', background: '#0d2a1a',
          borderBottom: '1px solid var(--green)',
          color: 'var(--green)', fontSize: '13px', flexShrink: 0,
        }}>{success}</div>
      )}

      {/* Canvas + panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Canvas */}
        <div
          style={{ flex: 1, position: 'relative', overflow: 'auto', background: 'var(--bg)' }}
          onClick={() => { setSelectedNode(null); if (addingEdge) setAddingEdge(null) }}
          onKeyDown={e => e.key === 'Escape' && setAddingEdge(null)}
          tabIndex={0}
        >
          {/* Grid background */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Edges */}
            {edges.map(edge => {
              const src = nodes.find(n => n.id === edge.source)
              const tgt = nodes.find(n => n.id === edge.target)
              if (!src || !tgt) return null
              const x1 = src.position.x + 140, y1 = src.position.y + 30
              const x2 = tgt.position.x + 10, y2 = tgt.position.y + 30
              const mx = (x1 + x2) / 2
              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                    fill="none" stroke="var(--border2)" strokeWidth="1.5"
                  />
                  <text x={mx} y={(y1 + y2) / 2 - 6} textAnchor="middle"
                    style={{ fontSize: '10px', fill: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                    {edge.condition_label}
                  </text>
                  {/* Delete edge button */}
                  <circle cx={mx} cy={(y1 + y2) / 2} r="8" fill="var(--surface)" stroke="var(--border)" strokeWidth="1"
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onClick={e => { e.stopPropagation(); deleteEdge(edge.id) }}
                  />
                  <text x={mx} y={(y1 + y2) / 2 + 4} textAnchor="middle"
                    style={{ fontSize: '11px', fill: 'var(--red)', fontFamily: 'monospace', pointerEvents: 'none' }}>×</text>
                </g>
              )
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => (
            <NodeCard
              key={node.id}
              node={node}
              selected={selectedNode === node.id}
              addingEdge={addingEdge}
              onSelect={e => {
                e.stopPropagation()
                if (addingEdge) {
                  // Prompt for label then create edge
                  const label = window.prompt('Edge label (e.g. "Yes", "No"):')
                  if (label) addEdge(addingEdge, node.id, label)
                } else {
                  setSelectedNode(node.id)
                  setEditingNode(node)
                }
              }}
              onStartEdge={e => {
                e.stopPropagation()
                setAddingEdge(node.id)
              }}
              onEdit={e => {
                e.stopPropagation()
                setEditingNode(node)
              }}
              onDelete={e => {
                e.stopPropagation()
                if (window.confirm('Delete this node and its connections?')) deleteNode(node.id)
              }}
            />
          ))}

          {/* Empty state */}
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>⬡</div>
                <div style={{ fontSize: '14px', marginBottom: '6px', color: 'var(--text2)' }}>Empty canvas</div>
                <div style={{ fontSize: '12px' }}>Use the buttons above to add nodes</div>
              </div>
            </div>
          )}
        </div>

        {/* Edit panel */}
        {editingNode && (
          <NodeEditPanel
            node={editingNode}
            onUpdate={updateNode}
            onClose={() => setEditingNode(null)}
          />
        )}
      </div>
    </div>
  )
}

function NodeCard({ node, selected, addingEdge, onSelect, onStartEdge, onDelete }) {
  const typeColor = {
    question: 'var(--accent)',
    result: 'var(--green)',
    conditional: 'var(--yellow)',
  }[node.type] || 'var(--text3)'

  return (
    <div
      onClick={onSelect}
      style={{
        position: 'absolute',
        left: node.position?.x || 0,
        top: node.position?.y || 0,
        width: '200px',
        background: 'var(--surface)',
        border: `1px solid ${selected ? typeColor : addingEdge ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px',
        cursor: addingEdge ? 'crosshair' : 'pointer',
        boxShadow: selected ? `0 0 0 2px ${typeColor}22` : 'none',
        transition: 'border-color 0.15s',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {node.is_start && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--accent)',
              padding: '1px 5px', background: '#0d1a3a', borderRadius: '3px',
            }}>START</span>
          )}
          <span style={{
            fontFamily: 'var(--mono)', fontSize: '9px', color: typeColor,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>{node.type}</span>
        </div>
        <button onClick={onDelete} style={{ color: 'var(--text3)', fontSize: '14px', lineHeight: 1 }}>×</button>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.4, marginBottom: '8px' }}>
          {node.title}
        </div>
        {node.body && (
          <div style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4, marginBottom: '8px' }}>
            {node.body.slice(0, 60)}{node.body.length > 60 ? '...' : ''}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {node.type !== 'result' && (
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onStartEdge}
            style={{
              fontSize: '10px', color: 'var(--accent)', fontFamily: 'var(--mono)',
              padding: '3px 6px', border: '1px solid var(--accent)',
              borderRadius: '3px', background: '#0d1a3a',
            }}
          >
            + Connect
          </button>
        </div>
      )}
    </div>
  )
}

function NodeEditPanel({ node, onUpdate, onClose }) {
  const [title, setTitle] = useState(node.title || '')
  const [body, setBody] = useState(node.body || '')
  const [type, setType] = useState(node.type || 'question')
  const [resolution, setResolution] = useState(node.metadata?.resolution || '')
  const [escalateTo, setEscalateTo] = useState(node.metadata?.escalate_to || '')

  useEffect(() => {
    setTitle(node.title || '')
    setBody(node.body || '')
    setType(node.type || 'question')
    setResolution(node.metadata?.resolution || '')
    setEscalateTo(node.metadata?.escalate_to || '')
  }, [node.id])

  function save() {
    const meta = type === 'result'
      ? { resolution, escalate_to: escalateTo || null }
      : {}
    onUpdate(node.id, { title, body, type, metadata: meta })
  }

  return (
    <div style={{
      width: '300px', flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--surface)',
      padding: '24px', overflowY: 'auto',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)', letterSpacing: '0.08em' }}>
          EDIT NODE
        </div>
        <button onClick={onClose} style={{ color: 'var(--text3)', fontSize: '18px' }}>×</button>
      </div>

      <label style={{ display: 'block', marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>TYPE</div>
        <select value={type} onChange={e => setType(e.target.value)} style={{
          width: '100%', padding: '8px 10px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: '5px', color: 'var(--text)', fontSize: '13px',
        }}>
          <option value="question">Question</option>
          <option value="result">Result</option>
          <option value="conditional">Conditional</option>
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>TITLE</div>
        <textarea value={title} onChange={e => setTitle(e.target.value)} rows={3} style={{
          width: '100%', padding: '8px 10px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: '5px', color: 'var(--text)', fontSize: '13px',
          resize: 'vertical', lineHeight: 1.5,
        }} />
      </label>

      <label style={{ display: 'block', marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>DESCRIPTION</div>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} style={{
          width: '100%', padding: '8px 10px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: '5px', color: 'var(--text)', fontSize: '13px',
          resize: 'vertical', lineHeight: 1.5,
        }} />
      </label>

      {type === 'result' && (
        <>
          <label style={{ display: 'block', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>RESOLUTION TEXT</div>
            <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={4} style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '5px', color: 'var(--text)', fontSize: '13px',
              resize: 'vertical', lineHeight: 1.5,
            }} />
          </label>
          <label style={{ display: 'block', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>ESCALATE TO (optional)</div>
            <input value={escalateTo} onChange={e => setEscalateTo(e.target.value)} placeholder="e.g. Tier 2 Engineering" style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '5px', color: 'var(--text)', fontSize: '13px',
            }} />
          </label>
        </>
      )}

      <button onClick={save} style={{
        width: '100%', padding: '10px',
        background: 'var(--accent)', color: '#fff',
        borderRadius: '6px', fontSize: '13px', fontWeight: 500,
      }}>
        Save Changes
      </button>
    </div>
  )
}