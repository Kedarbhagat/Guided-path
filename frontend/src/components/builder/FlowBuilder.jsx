import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useToast } from '../../hooks'
import { ToastContainer, Modal, ConfirmDialog, ToolbarBtn, PanelField } from '../ui'

const NODE_W = 210
const NODE_H = 90

export default function FlowBuilder() {
  const { flowId, versionId } = useParams()
  const navigate = useNavigate()
  const { toasts, add: toast } = useToast()

  const [version, setVersion] = useState(null)
  const [flow, setFlow] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingNode, setEditingNode] = useState(null)
  const [addingEdge, setAddingEdge] = useState(null)
  const [edgeModal, setEdgeModal] = useState(null)
  const [editingEdge, setEditingEdge] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishModal, setPublishModal] = useState(false)
  const [publishNotes, setPublishNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [showFlowAnalytics, setShowFlowAnalytics] = useState(false)
  const [flowAnalytics, setFlowAnalytics] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const nodePositions = useRef({})
  const nodeRefs = useRef({})
  const svgRef = useRef(null)
  const canvasRef = useRef(null)
  const transformLayerRef = useRef(null)
  const bgPatternRef = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const spaceDown = useRef(false)
  const dragging = useRef(null)
  const dragStart = useRef(null)

  // Load data
  useEffect(() => {
    Promise.all([api.getVersion(flowId, versionId), api.getFlow(flowId)])
      .then(([v, f]) => {
        setVersion(v)
        setFlow(f)
        const ns = v.nodes || []
        setNodes(ns)
        setEdges(v.edges || [])
        ns.forEach(n => { nodePositions.current[n.id] = { x: n.position?.x || 0, y: n.position?.y || 0 } })
      })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [flowId, versionId])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setAddingEdge(null)
      if (e.key === 'Delete' && editingNode) setDeleteConfirm(editingNode.id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingNode])

  // Space bar pan mode
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !e.target.matches('input,textarea')) {
        e.preventDefault()
        if (!spaceDown.current) {
          spaceDown.current = true
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
        }
      }
    }
    const onKeyUp = (e) => {
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

  // Scroll to zoom
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const next = Math.min(3, Math.max(0.2, zoomRef.current * delta))
      zoomRef.current = next
      setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading])

  // Mouse move / up handlers
  useEffect(() => {
    function onMouseMove(e) {
      if (isPanning.current) {
        const dx = e.clientX - panStart.current.mx
        const dy = e.clientY - panStart.current.my
        const nx = panStart.current.px + dx
        const ny = panStart.current.py + dy
        panRef.current = { x: nx, y: ny }
        if (transformLayerRef.current)
          transformLayerRef.current.style.transform = `translate(${nx}px, ${ny}px) scale(${zoomRef.current})`
        if (bgPatternRef.current) {
          bgPatternRef.current.setAttribute('x', nx % 20)
          bgPatternRef.current.setAttribute('y', ny % 20)
        }
        return
      }
      if (!dragging.current) return
      const dx = (e.clientX - dragStart.current.mx) / zoomRef.current
      const dy = (e.clientY - dragStart.current.my) / zoomRef.current
      const newX = Math.max(0, dragStart.current.x + dx)
      const newY = Math.max(0, dragStart.current.y + dy)
      nodePositions.current[dragging.current] = { x: newX, y: newY }
      const el = nodeRefs.current[dragging.current]
      if (el) { el.style.left = newX + 'px'; el.style.top = newY + 'px' }
      redrawEdges()
    }

    function onMouseUp() {
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

  function redrawEdges() {
    if (!svgRef.current) return
    svgRef.current.querySelectorAll('[data-edge-path]').forEach(path => {
      const srcId = path.getAttribute('data-src')
      const tgtId = path.getAttribute('data-tgt')
      const edgeId = path.getAttribute('data-edge-path')
      const srcPos = nodePositions.current[srcId] || {}
      const tgtPos = nodePositions.current[tgtId] || {}
      const x1 = (srcPos.x || 0) + NODE_W
      const y1 = (srcPos.y || 0) + NODE_H / 2
      const x2 = tgtPos.x || 0
      const y2 = (tgtPos.y || 0) + NODE_H / 2
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
      path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`)
      const label = svgRef.current.querySelector(`[data-edge-label="${edgeId}"]`)
      if (label) { label.setAttribute('x', mx); label.setAttribute('y', my - 9) }
      const rect = svgRef.current.querySelector(`[data-edge-label-rect="${edgeId}"]`)
      if (rect) { rect.setAttribute('x', mx - 32); rect.setAttribute('y', my - 22) }
      const btn = svgRef.current.querySelector(`[data-edge-del="${edgeId}"]`)
      if (btn) { btn.setAttribute('cx', mx); btn.setAttribute('cy', my + 10) }
      const bx = svgRef.current.querySelector(`[data-edge-delx="${edgeId}"]`)
      if (bx) { bx.setAttribute('x', mx); bx.setAttribute('y', my + 15) }
    })
  }

  function onCanvasMouseDown(e) {
    const tag = e.target.tagName.toLowerCase()
    const isBackground = tag === 'rect' || tag === 'svg' || e.target === canvasRef.current
    const isMiddleClick = e.button === 1
    const isSpacePan = spaceDown.current && e.button === 0
    if (!isBackground && !isMiddleClick && !isSpacePan) return
    if (addingEdge) return
    e.preventDefault()
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  function onNodeMouseDown(e, nodeId) {
    if (e.button !== 0) return
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

  const isPublished = version?.status === 'published'
  const hasStart = nodes.some(n => n.is_start)

  async function addNode(type) {
    const pos = { x: 60 + Math.random() * 350, y: 60 + Math.random() * 250 }
    try {
      const node = await api.createNode(versionId, { title: type === 'result' ? 'Resolution' : 'New question', type, is_start: !hasStart, position: pos })
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

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>Loading…</div>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <ToastContainer toasts={toasts} />

      {/* Modals */}
      {publishModal && (
        <Modal title="PUBLISH VERSION" onClose={() => setPublishModal(false)}>
          <p style={{ color: 'var(--text3)', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
            Publishing will make this version live. Agents can immediately start using it.
          </p>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '6px' }}>CHANGE NOTES (OPTIONAL)</label>
            <textarea value={publishNotes} onChange={e => setPublishNotes(e.target.value)} rows={3}
              placeholder="What changed in this version?"
              style={{ width: '100%', padding: '9px 11px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={publish} disabled={publishing}
              style={{ flex: 1, padding: '10px', background: 'var(--green)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, opacity: publishing ? 0.7 : 1 }}>
              {publishing ? 'Publishing…' : '⬆ Publish Now'}
            </button>
            <button onClick={() => setPublishModal(false)} style={{ padding: '10px 16px', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', fontSize: '13px' }}>Cancel</button>
          </div>
        </Modal>
      )}

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
        <button onClick={() => navigate('/')}
          style={{ color: 'var(--text3)', fontSize: '12px', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '5px', marginRight: '8px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
          ← Back
        </button>

        <FlowNameEditor flow={flow} onRename={async (newName) => {
          try {
            const updated = await api.updateFlow(flowId, { name: newName })
            setFlow(prev => ({ ...prev, name: updated.name }))
            toast('Flow renamed', 'success')
          } catch (e) { toast(e.message, 'error') }
        }} />

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
          <>
            <button onClick={() => hasStart && navigate(`/execute/${flowId}/${versionId}`)} disabled={!hasStart}
              title={hasStart ? 'Test this draft flow' : 'Set a start node first'}
              style={{ padding: '6px 14px', background: hasStart ? '#eff6ff' : 'var(--surface2)', color: hasStart ? 'var(--accent2)' : 'var(--text3)', border: `1px solid ${hasStart ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', fontSize: '12px', fontWeight: 500, opacity: hasStart ? 1 : 0.5, cursor: hasStart ? 'pointer' : 'not-allowed' }}>
              ▶ Test
            </button>
            <button onClick={() => setPublishModal(true)} disabled={!hasStart}
              style={{ padding: '6px 14px', background: hasStart ? 'var(--green)' : 'var(--surface2)', color: hasStart ? '#fff' : 'var(--text3)', border: `1px solid ${hasStart ? 'var(--green)' : 'var(--border)'}`, borderRadius: '5px', fontSize: '12px', fontWeight: 600, opacity: hasStart ? 1 : 0.6 }}>
              ⬆ Publish
            </button>
          </>
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
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #3a3510', padding: '8px 20px', fontFamily: 'var(--mono)', fontSize: '11px', color: '#b45309' }}>
          ⚠ No start node set. Click a node and mark it as start.
        </div>
      )}

      {/* Canvas + panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div ref={canvasRef} onMouseDown={onCanvasMouseDown}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'default', background: 'var(--bg)' }}>

          {/* Dot-grid background */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <pattern ref={bgPatternRef} id="dots" x={pan.x % 20} y={pan.y % 20} width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#dde3ed" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
            {[
              { label: '+', onClick: () => { const n = Math.min(3, zoomRef.current * 1.2); zoomRef.current = n; setZoom(n) }, radius: '6px 6px 0 0' },
            ].map(({ label, onClick, radius }) => (
              <button key={label} onClick={onClick}
                style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: radius, color: 'var(--text2)', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>{label}</button>
            ))}
            <div style={{ width: '32px', padding: '4px 0', background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderBottom: 'none', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text3)' }}>
              {Math.round(zoom * 100)}%
            </div>
            <button onClick={() => { const n = Math.max(0.2, zoomRef.current * 0.8); zoomRef.current = n; setZoom(n) }}
              style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderBottom: 'none', color: 'var(--text2)', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>−</button>
            <button onClick={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }) }}
              title="Reset view"
              style={{ width: '32px', height: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', color: 'var(--text3)', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>⊙</button>
          </div>

          <div style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 50, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', pointerEvents: 'none' }}>
            scroll to zoom · space+drag or middle-click to pan
          </div>

          {/* Transform layer */}
          <div ref={transformLayerRef}
            style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, willChange: 'transform' }}>

            {/* Edges SVG */}
            <svg ref={svgRef} style={{ position: 'absolute', left: 0, top: 0, width: '8000px', height: '8000px', pointerEvents: 'none', overflow: 'visible' }}>
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
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
                const hasLabel = edge.condition_label?.trim()

                return (
                  <g key={edge.id} style={{ pointerEvents: 'all' }}>
                    <path
                      data-edge-path={edge.id} data-src={src.id} data-tgt={tgt.id}
                      d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                      fill="none" stroke="var(--border2)" strokeWidth="1.5" markerEnd="url(#arrow)" />

                    {!isPublished && (
                      <g onClick={e => { e.stopPropagation(); setEditingEdge({ id: edge.id, label: edge.condition_label || '' }) }} style={{ cursor: 'pointer' }}>
                        <rect data-edge-label-rect={edge.id} x={mx - 32} y={my - 22} width="64" height="18" rx="4"
                          fill={hasLabel ? 'var(--surface2)' : 'var(--surface)'}
                          stroke={hasLabel ? 'var(--border2)' : 'var(--border)'} strokeWidth="1" opacity="0.95" />
                        <text data-edge-label={edge.id} x={mx} y={my - 9} textAnchor="middle"
                          style={{ fontSize: '9px', fill: hasLabel ? 'var(--text2)' : 'var(--text3)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
                          {hasLabel ? (edge.condition_label.length > 9 ? edge.condition_label.slice(0, 9) + '…' : edge.condition_label) : '+ label'}
                        </text>
                      </g>
                    )}
                    {isPublished && hasLabel && (
                      <text data-edge-label={edge.id} x={mx} y={my - 8} textAnchor="middle"
                        style={{ fontSize: '10px', fill: 'var(--text3)', fontFamily: 'var(--mono)', pointerEvents: 'none' }}>
                        {edge.condition_label}
                      </text>
                    )}

                    {!isPublished && (
                      <>
                        <circle data-edge-del={edge.id} cx={mx} cy={my + 10} r="9"
                          fill="var(--surface)" stroke="var(--border2)" strokeWidth="1"
                          style={{ cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); removeEdge(edge.id) }} />
                        <text data-edge-delx={edge.id} x={mx} y={my + 15} textAnchor="middle"
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
                  onMouseDown={e => onNodeMouseDown(e, node.id)}
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
                      {node.is_start && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--accent)', padding: '1px 5px', background: '#eff6ff', borderRadius: '3px', border: '1px solid #1a2a5a' }}>START</span>}
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
                        style={{ fontSize: '10px', color: addingEdge === node.id ? '#fff' : 'var(--accent)', fontFamily: 'var(--mono)', padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: '3px', background: addingEdge === node.id ? 'var(--accent)' : '#eff6ff', transition: 'all 0.15s' }}>
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
          </div>
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

      {/* Edge label modals */}
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

// ─── Sub-components ───────────────────────────────────────────

function FlowNameEditor({ flow, onRename }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  function startEdit() {
    setValue(flow?.name || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 30)
  }

  async function commit() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === flow?.name) { setEditing(false); return }
    setSaving(true)
    await onRename(trimmed)
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={commit} disabled={saving}
          style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: '4px', padding: '3px 8px', outline: 'none', minWidth: '160px', maxWidth: '300px' }} />
        {saving && <span style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>saving…</span>}
      </div>
    )
  }

  return (
    <button onClick={startEdit} title="Click to rename"
      style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text2)', marginRight: '4px', background: 'none', border: '1px solid transparent', borderRadius: '4px', padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'border-color 0.15s, background 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface2)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'none' }}>
      {flow?.name}
      <span style={{ fontSize: '10px', color: 'var(--text3)', opacity: 0.7 }}>✎</span>
    </button>
  )
}

function EdgeLabelModal({ onConfirm, onClose, initial = '', title = 'CONNECTION LABEL' }) {
  const [label, setLabel] = useState(initial)
  const inputRef = useRef(null)
  const isEdit = initial !== ''

  useEffect(() => {
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 50)
  }, [])

  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ color: 'var(--text3)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
        {isEdit ? 'Edit the connection label below. Leave blank to remove it.' : 'Label this connection. Leave blank for no label.'}
      </p>
      <input ref={inputRef} value={label} onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(label.trim()); if (e.key === 'Escape') onClose() }}
        placeholder="e.g. Card expired, Not resolved…"
        style={{ width: '100%', padding: '11px 13px', background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '20px' }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'} />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={() => onConfirm(label.trim())}
          style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
          {isEdit ? 'Update Label' : 'Add Connection'}
        </button>
        <button onClick={onClose} style={{ padding: '10px 16px', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '6px', fontSize: '13px' }}>Cancel</button>
      </div>
    </Modal>
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
    setIsStart(node.is_start || false); setDirty(false)
  }, [node.id])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && title.trim()) handleSave() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, title, body, type, resolution, escalateTo])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    const effectiveType = isStart && type === 'result' ? 'question' : type
    await onSave(node.id, {
      title: title.trim(), body: body.trim(), type: effectiveType, is_start: isStart,
      metadata: effectiveType === 'result' ? { resolution, escalate_to: escalateTo || null } : {},
    })
    setSaving(false)
    setDirty(false)
  }

  const inputStyle = { width: '100%', padding: '9px 11px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none', transition: 'border-color 0.15s', lineHeight: 1.5 }
  const mark = (setter) => (e) => { setter(e.target.value); setDirty(true) }

  return (
    <div style={{ width: '280px', flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.15s ease' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.08em' }}>
          EDIT NODE
          {dirty && <span style={{ marginLeft: '8px', color: '#b45309', fontSize: '9px' }}>● unsaved</span>}
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
                style={{ flex: 1, padding: '7px 4px', borderRadius: '5px', fontSize: '11px', fontFamily: 'var(--mono)', border: `1px solid ${type === t ? 'var(--accent)' : 'var(--border)'}`, background: type === t ? '#eff6ff' : 'var(--surface2)', color: type === t ? 'var(--accent2)' : 'var(--text3)', transition: 'all 0.15s' }}>
                {t}
              </button>
            ))}
          </div>
        </PanelField>

        <PanelField label="START NODE">
          <button onClick={() => { setIsStart(s => !s); setDirty(true) }}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'var(--mono)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', border: `1px solid ${isStart ? '#86efac' : 'var(--border)'}`, background: isStart ? '#f0fdf4' : 'var(--surface2)', color: isStart ? 'var(--green)' : 'var(--text3)', transition: 'all 0.15s', cursor: 'pointer' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${isStart ? '#16a34a' : 'var(--border2)'}`, background: isStart ? '#16a34a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
              {isStart && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff' }} />}
            </span>
            {isStart ? 'This is the START node' : 'Mark as START node'}
          </button>
          {isStart && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text3)', lineHeight: 1.5 }}>The previous start node will be unset automatically.</div>}
        </PanelField>

        <PanelField label="TITLE *">
          <textarea value={title} onChange={mark(setTitle)} rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'} />
        </PanelField>

        <PanelField label="DESCRIPTION">
          <textarea value={body} onChange={mark(setBody)} rows={3}
            placeholder="Additional context for the agent…"
            style={{ ...inputStyle, resize: 'vertical' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'} />
        </PanelField>

        {type === 'result' && (
          <>
            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 18px' }} />
            <PanelField label="RESOLUTION STEPS">
              <textarea value={resolution} onChange={mark(setResolution)} rows={5}
                placeholder="Steps to resolve this issue…"
                style={{ ...inputStyle, resize: 'vertical' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </PanelField>
            <PanelField label="ESCALATE TO">
              <input value={escalateTo} onChange={mark(setEscalateTo)}
                placeholder="e.g. Tier 2 Engineering" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
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