const BASE = '/api/v1'

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
  getFlows: () => req('GET', '/flows'),
  createFlow: (data) => req('POST', '/flows', data),
  getFlow: (id) => req('GET', `/flows/${id}`),
  updateFlow: (id, data) => req('PUT', `/flows/${id}`, data),
  deleteFlow: (id) => req('DELETE', `/flows/${id}`),
  getVersion: (flowId, versionId) => req('GET', `/flows/${flowId}/versions/${versionId}`),
  publishVersion: (flowId, versionId) => req('POST', `/flows/${flowId}/versions/${versionId}/publish`),
  createNode: (versionId, data) => req('POST', `/versions/${versionId}/nodes`, data),
  updateNode: (versionId, nodeId, data) => req('PUT', `/versions/${versionId}/nodes/${nodeId}`, data),
  deleteNode: (versionId, nodeId) => req('DELETE', `/versions/${versionId}/nodes/${nodeId}`),
  createEdge: (versionId, data) => req('POST', `/versions/${versionId}/edges`, data),
  deleteEdge: (versionId, edgeId) => req('DELETE', `/versions/${versionId}/edges/${edgeId}`),
  startSession: (data) => req('POST', '/sessions', data),
  getSession: (id) => req('GET', `/sessions/${id}`),
  submitStep: (id, edgeId) => req('POST', `/sessions/${id}/step`, { edge_id: edgeId }),
  goBack: (id) => req('POST', `/sessions/${id}/back`),
  restartSession: (id) => req('POST', `/sessions/${id}/restart`),
}