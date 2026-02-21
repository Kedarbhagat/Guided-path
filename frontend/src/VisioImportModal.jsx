import { useState, useRef, useCallback } from 'react'
import JSZip from 'jszip'

// ── API (mirrors App.jsx) ─────────────────────────────────────
const BASE = 'http://localhost:5000/api/v1'
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Visio XML parser ──────────────────────────────────────────
// Handles the full .vsdx XML structure:
//   masters.xml  → shape stencil definitions (Process, Decision, Terminator…)
//   page1.xml    → Shape[Type=Shape] nodes + Shape[Type=Edge] connectors + Connect wiring

// Shape masters that map to result/terminator nodes
const RESULT_MASTERS = new Set([
  'terminator', 'start/end', 'start', 'end', 'terminal',
])
// Shape masters that are connectors (skip as nodes)
const CONNECTOR_MASTERS = new Set([
  'dynamic connector', 'straight connector', 'curved connector',
  'elbow connector', 'connector',
])
// Shape masters that are decision/question nodes
const QUESTION_MASTERS = new Set([
  'decision', 'process', 'operation', 'predefined process',
  'alternate process', 'data', 'document', 'multi-document',
  'manual input', 'preparation', 'delay', 'stored data',
  'internal storage', 'sequential access storage', 'magnetic disk',
  'direct access storage', 'display', 'manual operation',
  'off-page reference', 'on-page reference',
])

function parseMasters(mastersXml) {
  // Returns Map<masterID, { nameU, name }>
  const masterMap = new Map()
  if (!mastersXml) return masterMap
  const doc = new DOMParser().parseFromString(mastersXml, 'text/xml')
  doc.querySelectorAll('Master').forEach(m => {
    const id = m.getAttribute('ID')
    const nameU = (m.getAttribute('NameU') || m.getAttribute('Name') || '').toLowerCase().trim()
    const name = (m.getAttribute('Name') || '').toLowerCase().trim()
    masterMap.set(id, { nameU, name })
  })
  return masterMap
}

function classifyShape(masterInfo, labelText) {
  const label = (labelText || '').toLowerCase()

  if (!masterInfo) {
    // No master info — fall back to label heuristics
    if (label.includes('escalat') || label.includes('resolv') || label.startsWith('result')) return 'result'
    return 'question'
  }

  const { nameU, name } = masterInfo
  const masterKey = nameU || name

  if (RESULT_MASTERS.has(masterKey)) return 'result'
  if (CONNECTOR_MASTERS.has(masterKey)) return 'connector' // will be skipped
  // Everything else (Decision, Process, etc.) → question
  return 'question'
}

function isStartShape(masterInfo, labelText) {
  const label = (labelText || '').toLowerCase()
  if (!masterInfo) return false
  const key = masterInfo.nameU || masterInfo.name
  // Visio "Start/End" master — first occurrence is the start
  if (key === 'start/end' || key === 'start' || key === 'terminator') return true
  return false
}

function parseVisioXml(pageXml, mastersXml) {
  const masterMap = parseMasters(mastersXml)
  const doc = new DOMParser().parseFromString(pageXml, 'text/xml')

  const nodes = []
  const edges = []
  const idMap = {}   // visio shape ID → tempId
  let nodeIndex = 0

  // ── Step 1: Build connector wire map from <Connects> ──────
  const connectorMap = {}
  doc.querySelectorAll('Connect').forEach(c => {
    const fromSheet = c.getAttribute('FromSheet')
    const toSheet   = c.getAttribute('ToSheet')
    const fromPart  = c.getAttribute('FromPart')
    if (!connectorMap[fromSheet]) connectorMap[fromSheet] = {}
    if (fromPart === '9')  connectorMap[fromSheet].from = toSheet
    if (fromPart === '12') connectorMap[fromSheet].to   = toSheet
  })

  // ── Step 2: Collect raw shapes (no type assignment yet) ────
  const rawShapes = []
  doc.querySelectorAll('Shape').forEach(shape => {
    const shapeId    = shape.getAttribute('ID')
    const shapeType  = shape.getAttribute('Type')
    const masterId   = shape.getAttribute('Master')
    const masterInfo = masterId ? masterMap.get(masterId) : null
    const textEl     = shape.querySelector('Text')
    const label      = (textEl ? textEl.textContent : '').trim().replace(/\s+/g, ' ')
    const isEdgeType = shapeType === 'Edge'
    const isConnectorMaster = masterInfo && CONNECTOR_MASTERS.has(masterInfo.nameU || masterInfo.name)
    const masterKey  = masterInfo ? (masterInfo.nameU || masterInfo.name) : ''
    const isTerminator = ['terminator', 'start/end', 'start', 'end', 'terminal'].includes(masterKey)

    if (isEdgeType || isConnectorMaster || connectorMap[shapeId]) {
      if (connectorMap[shapeId]?.from && connectorMap[shapeId]?.to) {
        edges.push({
          _visioSrcId: connectorMap[shapeId].from,
          _visioTgtId: connectorMap[shapeId].to,
          tempId: `import-edge-${edges.length}`,
          sourceId: null, targetId: null,
          label: label || '',
        })
      }
      return
    }
    if (!label) return

    const pinX = parseFloat(shape.querySelector('XForm > PinX')?.textContent || 0)
    const pinY = parseFloat(shape.querySelector('XForm > PinY')?.textContent || 0)
    rawShapes.push({ shapeId, masterInfo, masterKey, isTerminator, label, pinX, pinY })
  })

  // ── Step 3: Determine start node BEFORE assigning types ────
  // Strategy: the start node is the shape that NO connector points TO.
  // i.e. it has no incoming edges. This is graph-theoretically correct
  // regardless of position or shape type.
  const allTargetIds = new Set(
    edges.map(e => e._visioTgtId).filter(Boolean)
  )
  const nodeShapeIds = new Set(rawShapes.map(s => s.shapeId))

  // Find shapes with no incoming edges (not a target of any connector)
  const noIncoming = rawShapes.filter(s => !allTargetIds.has(s.shapeId))

  // Among those, prefer a terminator/start shape, else take topmost-leftmost
  const startShape =
    noIncoming.find(s => s.isTerminator) ||
    noIncoming.sort((a, b) => b.pinY - a.pinY || a.pinX - b.pinX)[0] ||
    rawShapes.sort((a, b) => b.pinY - a.pinY || a.pinX - b.pinX)[0]

  const startShapeId = startShape?.shapeId || null

  // ── Step 4: Build nodes with correct type assignment ───────
  rawShapes.forEach(({ shapeId, masterInfo, masterKey, isTerminator, label, pinX, pinY }) => {
    const x = Math.round(pinX * 96)
    const y = Math.round((11 - pinY) * 96)

    const isStart = shapeId === startShapeId

    // Type logic:
    // - START node → always 'question' (entry point, never an endpoint)
    // - Other terminators → 'result'
    // - Everything else → classifyShape
    let nodeType
    if (isStart) {
      nodeType = 'question'
    } else if (isTerminator) {
      nodeType = 'result'
    } else {
      nodeType = classifyShape(masterInfo, label)
    }
    if (nodeType === 'connector') return

    const tempId = `import-node-${nodeIndex++}`
    idMap[shapeId] = tempId

    nodes.push({
      tempId,
      visioId: shapeId,
      title: label,
      type: nodeType,
      position: { x: Math.max(20, x), y: Math.max(20, y) },
      body: '',
      is_start: isStart,
      _masterName: masterKey || 'unknown',
    })
  })

  // ── Step 3: Resolve edge node IDs ─────────────────────────
  edges.forEach(edge => {
    edge.sourceId = idMap[edge._visioSrcId] || null
    edge.targetId = idMap[edge._visioTgtId] || null
    delete edge._visioSrcId
    delete edge._visioTgtId
  })

  // Filter out edges where we couldn't resolve both endpoints
  const validEdges = edges.filter(e => e.sourceId && e.targetId)

  // ── Step 4: Fallback start node if none detected ───────────
  if (!nodes.some(n => n.is_start) && nodes.length > 0) {
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    const fallback = nodes.find(n => n.tempId === sorted[0].tempId)
    if (fallback) { fallback.is_start = true; fallback.type = 'question' }
  }

  return { nodes, edges: validEdges }
}

// ── Mini canvas preview ───────────────────────────────────────
const NODE_W = 200
const NODE_H = 80

function PreviewCanvas({ nodes, edges, selectedId, onSelect }) {
  const svgW = 8000
  const svgH = 4000

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0a0a0f', borderRadius: '8px', border: '1px solid var(--border)', position: 'relative', minHeight: '300px' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <defs>
          <pattern id="prev-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#1a1a2e" />
          </pattern>
          <marker id="prev-arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#3a4a6a" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#prev-dots)" />

        {/* Edges */}
        {edges.map(edge => {
          const src = nodes.find(n => n.tempId === edge.sourceId)
          const tgt = nodes.find(n => n.tempId === edge.targetId)
          if (!src || !tgt) return null
          const x1 = src.position.x + NODE_W
          const y1 = src.position.y + NODE_H / 2
          const x2 = tgt.position.x
          const y2 = tgt.position.y + NODE_H / 2
          const mx = (x1 + x2) / 2
          return (
            <g key={edge.tempId}>
              <path d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                fill="none" stroke="#3a4a6a" strokeWidth="1.5" markerEnd="url(#prev-arrow)" />
              {edge.label && (
                <text x={mx} y={(y1 + y2) / 2 - 8} textAnchor="middle"
                  style={{ fontSize: '10px', fill: '#6a7a9a', fontFamily: 'monospace' }}>
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const typeColor = node.type === 'result' ? '#22c55e' : '#4a8fff'
          const isSelected = selectedId === node.tempId
          return (
            <g key={node.tempId} onClick={() => onSelect(node.tempId)}
              style={{ cursor: 'pointer' }}>
              <rect x={node.position.x} y={node.position.y} width={NODE_W} height={NODE_H}
                rx="8" ry="8"
                fill={isSelected ? '#0d1a3a' : '#111827'}
                stroke={isSelected ? typeColor : '#2a3a5a'}
                strokeWidth={isSelected ? 2 : 1.5} />
              {/* type bar */}
              <rect x={node.position.x} y={node.position.y} width={4} height={NODE_H}
                rx="2" fill={typeColor} />
              {/* start badge */}
              {node.is_start && (
                <text x={node.position.x + 14} y={node.position.y + 16}
                  style={{ fontSize: '8px', fill: '#4a8fff', fontFamily: 'monospace', fontWeight: 'bold' }}>
                  START
                </text>
              )}
              {/* type label */}
              <text x={node.position.x + 14} y={node.position.y + (node.is_start ? 30 : 22)}
                style={{ fontSize: '9px', fill: typeColor, fontFamily: 'monospace', textTransform: 'uppercase' }}>
                {node.type}
              </text>
              {/* title */}
              <foreignObject x={node.position.x + 14} y={node.position.y + 36}
                width={NODE_W - 24} height={NODE_H - 44}>
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style={{ fontSize: '11px', color: '#c8d0e0', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {node.title}
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Node editor sidebar ───────────────────────────────────────
function NodeEditor({ node, edges, allNodes, onChange, onEdgeChange, onAddEdge, onDeleteEdge }) {
  if (!node) return (
    <div style={{ width: '260px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5a7a', fontSize: '12px', fontFamily: 'monospace' }}>
      ← click a node to edit
    </div>
  )

  const nodeEdges = edges.filter(e => e.sourceId === node.tempId || e.targetId === node.tempId)

  const inp = { width: '100%', padding: '7px 10px', background: '#0d1120', border: '1px solid #2a3a5a', borderRadius: '5px', color: '#c8d0e0', fontSize: '12px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }

  return (
    <div style={{ width: '260px', flexShrink: 0, borderLeft: '1px solid #1a2a4a', overflowY: 'auto', padding: '16px' }}>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#4a5a7a', letterSpacing: '0.08em', marginBottom: '6px' }}>EDIT NODE</div>
      {node._masterName && node._masterName !== 'unknown' && (
        <div style={{ fontSize: '10px', color: '#3a5a3a', background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: '4px', padding: '3px 8px', marginBottom: '12px', fontFamily: 'monospace' }}>
          Visio shape: <span style={{ color: '#4a9a4a' }}>{node._masterName}</span>
        </div>
      )}

      {/* Type toggle */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>TYPE</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {['question', 'result'].map(t => (
            <button key={t} onClick={() => onChange(node.tempId, { type: t })}
              style={{ flex: 1, padding: '6px', borderRadius: '5px', fontSize: '11px', fontFamily: 'monospace', border: `1px solid ${node.type === t ? '#4a8fff' : '#2a3a5a'}`, background: node.type === t ? '#0d1a3a' : '#0d1120', color: node.type === t ? '#7ab4ff' : '#4a5a7a', cursor: 'pointer' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Start toggle */}
      <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" id="is-start" checked={node.is_start}
          onChange={e => onChange(node.tempId, { is_start: e.target.checked })} />
        <label htmlFor="is-start" style={{ fontSize: '11px', color: '#8a9ab a', fontFamily: 'monospace', cursor: 'pointer' }}>Mark as START node</label>
      </div>

      {/* Title */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>TITLE</div>
        <textarea value={node.title} rows={3}
          onChange={e => onChange(node.tempId, { title: e.target.value })}
          style={{ ...inp, resize: 'vertical' }} />
      </div>

      {/* Description */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>DESCRIPTION</div>
        <textarea value={node.body} rows={2} placeholder="Optional context…"
          onChange={e => onChange(node.tempId, { body: e.target.value })}
          style={{ ...inp, resize: 'vertical' }} />
      </div>

      {node.type === 'result' && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>RESOLUTION STEPS</div>
          <textarea value={node.resolution || ''} rows={3} placeholder="Steps to resolve…"
            onChange={e => onChange(node.tempId, { resolution: e.target.value })}
            style={{ ...inp, resize: 'vertical' }} />
        </div>
      )}

      {/* Connections from this node */}
      <div style={{ marginTop: '8px' }}>
        <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '8px' }}>CONNECTIONS</div>
        {nodeEdges.length === 0 && (
          <div style={{ fontSize: '11px', color: '#3a4a6a', fontFamily: 'monospace' }}>No connections</div>
        )}
        {nodeEdges.map(edge => {
          const isSource = edge.sourceId === node.tempId
          const otherNode = allNodes.find(n => n.tempId === (isSource ? edge.targetId : edge.sourceId))
          return (
            <div key={edge.tempId} style={{ marginBottom: '8px', padding: '8px', background: '#0d1120', borderRadius: '6px', border: '1px solid #1a2a4a' }}>
              <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '4px' }}>
                {isSource ? '→ TO' : '← FROM'}: {otherNode?.title?.slice(0, 30) || 'unknown'}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input value={edge.label} placeholder="label (e.g. yes / no)"
                  onChange={e => onEdgeChange(edge.tempId, { label: e.target.value })}
                  style={{ ...inp, flex: 1, padding: '4px 8px', fontSize: '11px' }} />
                <button onClick={() => onDeleteEdge(edge.tempId)}
                  style={{ color: '#ef4444', fontSize: '14px', padding: '2px 6px', border: '1px solid #3a1a1a', borderRadius: '4px', background: '#1a0a0a', cursor: 'pointer' }}>×</button>
              </div>
            </div>
          )
        })}

        {/* Add edge from this node */}
        {node.type !== 'result' && (
          <AddEdgeRow node={node} allNodes={allNodes} edges={edges} onAdd={onAddEdge} />
        )}
      </div>
    </div>
  )
}

function AddEdgeRow({ node, allNodes, edges, onAdd }) {
  const [targetId, setTargetId] = useState('')
  const [label, setLabel] = useState('')
  const available = allNodes.filter(n => n.tempId !== node.tempId)
  const inp = { padding: '5px 8px', background: '#0d1120', border: '1px solid #2a3a5a', borderRadius: '5px', color: '#c8d0e0', fontSize: '11px', outline: 'none', fontFamily: 'inherit' }

  function add() {
    if (!targetId) return
    onAdd({ sourceId: node.tempId, targetId, label })
    setTargetId(''); setLabel('')
  }

  return (
    <div style={{ marginTop: '8px', padding: '8px', background: '#050810', borderRadius: '6px', border: '1px dashed #2a3a5a' }}>
      <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>+ ADD CONNECTION</div>
      <select value={targetId} onChange={e => setTargetId(e.target.value)}
        style={{ ...inp, width: '100%', marginBottom: '6px' }}>
        <option value="">— select target node —</option>
        {available.map(n => (
          <option key={n.tempId} value={n.tempId}>{n.title.slice(0, 40)}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input value={label} placeholder="label (optional)" onChange={e => setLabel(e.target.value)}
          style={{ ...inp, flex: 1 }} />
        <button onClick={add} disabled={!targetId}
          style={{ padding: '5px 10px', background: '#0d1a3a', border: '1px solid #4a8fff', borderRadius: '5px', color: '#4a8fff', fontSize: '11px', cursor: targetId ? 'pointer' : 'not-allowed', opacity: targetId ? 1 : 0.5 }}>
          Add
        </button>
      </div>
    </div>
  )
}

// ── Step indicators ───────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Upload', 'Review & Edit', 'Save']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '24px' }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontFamily: 'monospace', fontWeight: 600,
              background: i < current ? '#22c55e' : i === current ? '#4a8fff' : '#1a2a4a',
              color: i <= current ? '#fff' : '#4a5a7a',
            }}>{i < current ? '✓' : i + 1}</div>
            <span style={{ fontSize: '12px', color: i === current ? '#c8d0e0' : '#4a5a7a', fontFamily: 'monospace' }}>{s}</span>
          </div>
          {i < steps.length - 1 && <div style={{ width: '32px', height: '1px', background: '#1a2a4a', margin: '0 8px' }} />}
        </div>
      ))}
    </div>
  )
}

// ── Main VisioImportModal ─────────────────────────────────────
export default function VisioImportModal({ onClose, onImported }) {
  const [step, setStep] = useState(0) // 0=upload, 1=review, 2=saving
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [flowName, setFlowName] = useState('')
  const [flowDesc, setFlowDesc] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishAfterSave, setPublishAfterSave] = useState(true)
  const [parseWarnings, setParseWarnings] = useState([])
  const fileRef = useRef()

  // ── Parse uploaded .vsdx ──────────────────────────────────
  async function handleFile(file) {
    setError('')
    if (!file) return
    if (!file.name.endsWith('.vsdx') && !file.name.endsWith('.vsd')) {
      setError('Please upload a .vsdx file exported from Visio.')
      return
    }

    // Default flow name from filename
    setFlowName(file.name.replace(/\.(vsdx|vsd)$/i, '').replace(/[-_]/g, ' '))

    try {
      const zip = await JSZip.loadAsync(file)

      // Find the first page XML
      const pageFiles = Object.keys(zip.files).filter(f =>
        f.match(/visio\/pages\/page\d+\.xml/i)
      )

      if (pageFiles.length === 0) {
        setError('Could not find diagram pages in this file. Make sure it\'s a valid .vsdx file.')
        return
      }

      const warnings = []
      let allNodes = []
      let allEdges = []

      // Load masters.xml for shape type detection (Process, Decision, Terminator…)
      const masterFiles = Object.keys(zip.files).filter(f =>
        f.match(/visio\/masters\/masters\.xml/i)
      )
      let mastersXml = null
      if (masterFiles.length > 0) {
        mastersXml = await zip.files[masterFiles[0]].async('string')
      } else {
        warnings.push('No masters file found — shape types will be guessed from labels only.')
      }

      // Parse first page (most flows are single-page)
      const xmlStr = await zip.files[pageFiles[0]].async('string')
      const { nodes: parsedNodes, edges: parsedEdges } = parseVisioXml(xmlStr, mastersXml)

      allNodes = parsedNodes
      allEdges = parsedEdges

      if (allNodes.length === 0) {
        setError('No shapes with text found on this page. Make sure your shapes have labels.')
        return
      }

      if (allEdges.length === 0) {
        warnings.push('No connectors found — you can add connections manually in the next step.')
      }

      const noStart = !allNodes.some(n => n.is_start)
      if (noStart) warnings.push('Could not detect a start node — please mark one manually.')
      
      // Show detected shape types as info
      const resultCount = allNodes.filter(n => n.type === 'result').length
      const questionCount = allNodes.filter(n => n.type === 'question').length
      if (mastersXml) {
        warnings.push(`ℹ Detected ${questionCount} question node${questionCount !== 1 ? 's' : ''} and ${resultCount} result node${resultCount !== 1 ? 's' : ''} from shape types.`)
      }

      setParseWarnings(warnings)
      setNodes(allNodes)
      setEdges(allEdges)
      setSelectedId(allNodes[0]?.tempId || null)
      setStep(1)
    } catch (err) {
      setError(`Failed to parse file: ${err.message}`)
    }
  }

  // ── Node/edge update helpers ──────────────────────────────
  function updateNode(tempId, changes) {
    setNodes(prev => prev.map(n => {
      if (n.tempId !== tempId) return n
      // If marking as start, unmark all others first
      if (changes.is_start) {
        return { ...n, ...changes }
      }
      return { ...n, ...changes }
    }))
    // Ensure only one start node
    if (changes.is_start === true) {
      setNodes(prev => prev.map(n =>
        n.tempId === tempId ? { ...n, ...changes } : { ...n, is_start: false }
      ))
    }
  }

  function updateEdge(tempId, changes) {
    setEdges(prev => prev.map(e => e.tempId === tempId ? { ...e, ...changes } : e))
  }

  function deleteEdge(tempId) {
    setEdges(prev => prev.filter(e => e.tempId !== tempId))
  }

  function addEdge({ sourceId, targetId, label }) {
    const tempId = `import-edge-${Date.now()}`
    setEdges(prev => [...prev, { tempId, sourceId, targetId, label }])
  }

  function deleteNode(tempId) {
    setNodes(prev => prev.filter(n => n.tempId !== tempId))
    setEdges(prev => prev.filter(e => e.sourceId !== tempId && e.targetId !== tempId))
    setSelectedId(null)
  }

  // ── Save to backend ───────────────────────────────────────
  async function saveFlow() {
    if (!flowName.trim()) { setError('Please enter a flow name.'); return }
    const startNodes = nodes.filter(n => n.is_start)
    if (startNodes.length === 0) { setError('Please mark one node as the START node.'); return }
    if (startNodes.length > 1) { setError('Only one node can be the START node.'); return }

    setSaving(true)
    setError('')

    try {
      // 1. Create flow
      const flow = await req('POST', '/flows', { name: flowName.trim(), description: flowDesc.trim() })

      // 2. Get the auto-created draft version
      const flowFull = await req('GET', `/flows/${flow.id}`)
      const versionId = flowFull.draft_version_id || flowFull.versions?.[0]?.id
      if (!versionId) throw new Error('Could not find draft version')

      // 3. Create all nodes and build tempId → real id map
      const idMap = {}
      for (const node of nodes) {
        const created = await req('POST', `/versions/${versionId}/nodes`, {
          type: node.type,
          title: node.title,
          body: node.body || '',
          position: node.position,
          is_start: node.is_start,
          metadata: node.type === 'result' ? { resolution: node.resolution || '', escalate_to: null } : {},
        })
        idMap[node.tempId] = created.id
      }

      // 4. Create all edges
      for (const edge of edges) {
        const srcId = idMap[edge.sourceId]
        const tgtId = idMap[edge.targetId]
        if (!srcId || !tgtId) continue
        await req('POST', `/versions/${versionId}/edges`, {
          source: srcId,
          target: tgtId,
          condition_label: edge.label || '',
        })
      }

      // 5. Publish the version so it's immediately runnable
      if (publishAfterSave) {
        await req('POST', `/flows/${flow.id}/versions/${versionId}/publish`, {
          change_notes: 'Imported from Visio'
        })
      }

      onImported({ flowId: flow.id, versionId, flowName: flowName.trim(), published: publishAfterSave })
    } catch (err) {
      setError(`Save failed: ${err.message}`)
      setSaving(false)
    }
  }

  const selectedNode = nodes.find(n => n.tempId === selectedId)

  // ── Styles ────────────────────────────────────────────────
  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '20px',
  }
  const modalStyle = {
    background: '#080c14', border: '1px solid #1a2a4a', borderRadius: '12px',
    width: '100%', maxWidth: step === 1 ? '1100px' : '480px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modalStyle}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1a2a4a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: '#c8d0e0', letterSpacing: '0.05em' }}>
              IMPORT FROM VISIO
            </div>
            <div style={{ fontSize: '11px', color: '#4a5a7a', marginTop: '2px' }}>
              Upload a .vsdx file to generate your flow automatically
            </div>
          </div>
          <button onClick={onClose}
            style={{ color: '#4a5a7a', fontSize: '20px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#c8d0e0'}
            onMouseLeave={e => e.currentTarget.style.color = '#4a5a7a'}>×</button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Steps current={step === 0 ? 0 : step === 1 ? 1 : 2} />

          {/* ── STEP 0: Upload ── */}
          {step === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <input ref={fileRef} type="file" accept=".vsdx,.vsd" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />

              <div
                onClick={() => fileRef.current.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#4a8fff' }}
                onDragLeave={e => { e.currentTarget.style.borderColor = '#2a3a5a' }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#2a3a5a'; handleFile(e.dataTransfer.files[0]) }}
                style={{
                  width: '100%', maxWidth: '360px', padding: '48px 32px',
                  border: '2px dashed #2a3a5a', borderRadius: '12px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
                  cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s',
                  background: '#0a0e1a',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a8fff'; e.currentTarget.style.background = '#0d1220' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3a5a'; e.currentTarget.style.background = '#0a0e1a' }}>
                <div style={{ fontSize: '36px', opacity: 0.5 }}>⬡</div>
                <div style={{ fontSize: '14px', color: '#8a9aba', fontWeight: 500 }}>Drop your .vsdx file here</div>
                <div style={{ fontSize: '12px', color: '#4a5a7a' }}>or click to browse</div>
                <div style={{ marginTop: '8px', padding: '6px 14px', background: '#0d1a3a', border: '1px solid #4a8fff', borderRadius: '6px', fontSize: '12px', color: '#4a8fff', fontFamily: 'monospace' }}>
                  Choose File
                </div>
              </div>

              <div style={{ marginTop: '20px', padding: '12px 16px', background: '#0a0e1a', border: '1px solid #1a2a3a', borderRadius: '8px', maxWidth: '360px', width: '100%' }}>
                <div style={{ fontSize: '11px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '6px' }}>HOW TO EXPORT FROM VISIO</div>
                <div style={{ fontSize: '12px', color: '#6a7a9a', lineHeight: 1.6 }}>
                  File → Save As → <strong style={{ color: '#8a9aba' }}>Visio Drawing (.vsdx)</strong>
                </div>
              </div>

              {error && (
                <div style={{ marginTop: '16px', padding: '10px 14px', background: '#1a0a0a', border: '1px solid #5a2a2a', borderRadius: '6px', color: '#ef4444', fontSize: '12px', maxWidth: '360px', width: '100%' }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1: Review & Edit ── */}
          {step === 1 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>

              {/* Warnings */}
              {parseWarnings.length > 0 && (
                <div style={{ padding: '10px 14px', background: '#1a1500', border: '1px solid #3a3000', borderRadius: '6px' }}>
                  {parseWarnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#facc15', lineHeight: 1.6 }}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {/* Flow name + description */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '5px' }}>FLOW NAME *</div>
                  <input value={flowName} onChange={e => setFlowName(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: '#0d1120', border: '1px solid #2a3a5a', borderRadius: '6px', color: '#c8d0e0', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#4a5a7a', fontFamily: 'monospace', marginBottom: '5px' }}>DESCRIPTION</div>
                  <input value={flowDesc} onChange={e => setFlowDesc(e.target.value)} placeholder="Optional…"
                    style={{ width: '100%', padding: '8px 10px', background: '#0d1120', border: '1px solid #2a3a5a', borderRadius: '6px', color: '#c8d0e0', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }} />
                </div>
              </div>

              {/* Stats bar */}
              <div style={{ display: 'flex', gap: '16px', padding: '10px 14px', background: '#0a0e1a', borderRadius: '8px', border: '1px solid #1a2a4a' }}>
                {[
                  { label: 'NODES', value: nodes.length },
                  { label: 'EDGES', value: edges.length },
                  { label: 'QUESTIONS', value: nodes.filter(n => n.type === 'question').length },
                  { label: 'RESULTS', value: nodes.filter(n => n.type === 'result').length },
                  { label: 'START SET', value: nodes.some(n => n.is_start) ? '✓' : '✗' },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '9px', color: '#4a5a7a', fontFamily: 'monospace' }}>{s.label}</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: s.value === '✗' ? '#ef4444' : s.value === '✓' ? '#22c55e' : '#c8d0e0', fontFamily: 'monospace' }}>{s.value}</div>
                  </div>
                ))}
                <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#4a5a7a', alignSelf: 'center', fontFamily: 'monospace' }}>
                  click any node to edit →
                </div>
              </div>

              {/* Canvas + editor */}
              <div style={{ flex: 1, display: 'flex', gap: '0', minHeight: '380px', border: '1px solid #1a2a4a', borderRadius: '8px', overflow: 'hidden' }}>
                <PreviewCanvas nodes={nodes} edges={edges} selectedId={selectedId} onSelect={setSelectedId} />
                <NodeEditor
                  node={selectedNode}
                  edges={edges}
                  allNodes={nodes}
                  onChange={updateNode}
                  onEdgeChange={updateEdge}
                  onAddEdge={addEdge}
                  onDeleteEdge={deleteEdge}
                />
              </div>

              {error && (
                <div style={{ padding: '10px 14px', background: '#1a0a0a', border: '1px solid #5a2a2a', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => { setStep(0); setNodes([]); setEdges([]) }}
                  style={{ padding: '9px 18px', border: '1px solid #2a3a5a', borderRadius: '6px', color: '#8a9aba', fontSize: '13px', background: 'transparent', cursor: 'pointer' }}>
                  ← Re-upload
                </button>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button onClick={() => { setPublishAfterSave(false); saveFlow() }} disabled={saving}
                    style={{ padding: '9px 16px', background: 'transparent', border: '1px solid #2a3a5a', borderRadius: '6px', color: '#8a9aba', fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer' }}>
                    Save as Draft
                  </button>
                  <button onClick={() => { setPublishAfterSave(true); saveFlow() }} disabled={saving}
                    style={{ padding: '9px 20px', background: saving ? '#1a2a4a' : '#4a8fff', border: 'none', borderRadius: '6px', color: saving ? '#4a5a7a' : '#fff', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving…' : `⬇ Save & Publish (${nodes.length} nodes)`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}