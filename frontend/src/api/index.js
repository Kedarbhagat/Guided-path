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

export const api = {
  // Flows
  getFlows: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return req('GET', `/flows${q ? '?' + q : ''}`)
  },
  createFlow: (d) => req('POST', '/flows', d),
  getFlow: (id) => req('GET', `/flows/${id}`),
  updateFlow: (id, d) => req('PUT', `/flows/${id}`, d),
  deleteFlow: (id) => req('DELETE', `/flows/${id}`),
  permanentDeleteFlow: (id) => req('DELETE', `/flows/${id}/permanent`),
  duplicateFlow: (id, d) => req('POST', `/flows/${id}/duplicate`, d),
  restoreFlow: (id) => req('POST', `/flows/${id}/restore`),
  getArchivedFlows: () => req('GET', '/flows/archived'),

  // Versions
  getVersion: (fId, vId) => req('GET', `/flows/${fId}/versions/${vId}`),
  publishVersion: (fId, vId, d) => req('POST', `/flows/${fId}/versions/${vId}/publish`, d),
  createVersion: (fId, d) => req('POST', `/flows/${fId}/versions`, d),

  // Nodes
  createNode: (vId, d) => req('POST', `/versions/${vId}/nodes`, d),
  updateNode: (vId, nId, d) => req('PUT', `/versions/${vId}/nodes/${nId}`, d),
  deleteNode: (vId, nId) => req('DELETE', `/versions/${vId}/nodes/${nId}`),

  // Edges
  createEdge: (vId, d) => req('POST', `/versions/${vId}/edges`, d),
  updateEdge: (vId, eId, d) => req('PUT', `/versions/${vId}/edges/${eId}`, d),
  deleteEdge: (vId, eId) => req('DELETE', `/versions/${vId}/edges/${eId}`),

  // Sessions
  startSession: (d) => req('POST', '/sessions', d),
  submitStep: (id, edgeId) => req('POST', `/sessions/${id}/step`, { edge_id: edgeId }),
  goBack: (id) => req('POST', `/sessions/${id}/back`),
  restartSession: (id) => req('POST', `/sessions/${id}/restart`),
  submitFeedback: (id, d) => req('POST', `/sessions/${id}/feedback`, d),
  exportSession: (id) => req('GET', `/sessions/${id}/export`),

  // Misc
  getCategories: () => req('GET', '/categories'),
  getAnalyticsOverview: () => req('GET', '/analytics/overview'),
  getFlowAnalytics: (id) => req('GET', `/analytics/flows/${id}`),
}