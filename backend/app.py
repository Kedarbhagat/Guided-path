import uuid
import time
import json
import re
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
from sqlalchemy import func, text, or_
import os

try:
    from google import genai as _genai
    from google.genai import types as _genai_types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///guided_resolution.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}
CORS(app, expose_headers=["X-Total-Count", "X-Request-Time", "X-API-Version"])

db = SQLAlchemy(app)


# ─── REQUEST HOOKS ────────────────────────────────────────
@app.before_request
def start_timer():
    g.start_time = time.time()

@app.after_request
def add_headers(response):
    if hasattr(g, "start_time"):
        elapsed = round((time.time() - g.start_time) * 1000, 2)
        response.headers["X-Request-Time"] = f"{elapsed}ms"
    response.headers["X-API-Version"] = "1.0.0"
    return response


# ─── MODELS ───────────────────────────────────────────────

class Flow(db.Model):
    __tablename__ = "flows"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category = db.Column(db.String(100), nullable=True)
    tags = db.Column(db.JSON, nullable=True, default=list)
    active_version_id = db.Column(db.String(36), nullable=True)
    is_archived = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())
    updated_at = db.Column(db.DateTime, default=lambda: datetime.utcnow(), onupdate=lambda: datetime.utcnow())

    def to_dict(self, include_stats=False):
        # Always include versions summary so frontend can find draft/published versions
        all_versions = FlowVersion.query.filter_by(flow_id=self.id).order_by(FlowVersion.version_number.desc()).all()
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tags": self.tags or [],
            "active_version_id": self.active_version_id,
            "is_archived": self.is_archived,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "versions": [{"id": v.id, "status": v.status, "version_number": v.version_number} for v in all_versions],
        }
        if include_stats:
            version_ids = [v.id for v in all_versions]
            sessions = Session.query.filter(Session.flow_version_id.in_(version_ids)).all() if version_ids else []
            completed = [s for s in sessions if s.status == "completed"]
            data["stats"] = {
                "total_sessions": len(sessions),
                "completed_sessions": len(completed),
                "avg_duration_seconds": (
                    round(sum(s.duration_seconds for s in completed if s.duration_seconds) / len(completed))
                    if completed else None
                ),
                "node_count": Node.query.filter(Node.flow_version_id.in_(version_ids)).count() if version_ids else 0,
            }
        return data


class FlowVersion(db.Model):
    __tablename__ = "flow_versions"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    flow_id = db.Column(db.String(36), db.ForeignKey("flows.id"), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="draft")
    graph_data = db.Column(db.JSON, nullable=False, default=lambda: {"nodes": [], "edges": []})
    change_notes = db.Column(db.Text, nullable=True)
    published_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())

    def to_dict(self, include_graph=False):
        data = {
            "id": self.id,
            "flow_id": self.flow_id,
            "version_number": self.version_number,
            "status": self.status,
            "change_notes": self.change_notes,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_graph:
            data["graph_data"] = self.graph_data
        return data


class Node(db.Model):
    __tablename__ = "nodes"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    flow_version_id = db.Column(db.String(36), db.ForeignKey("flow_versions.id"), nullable=False)
    type = db.Column(db.String(20), nullable=False, default="question")
    title = db.Column(db.String(500), nullable=False)
    body = db.Column(db.Text, nullable=True)
    position_x = db.Column(db.Float, default=0.0)
    position_y = db.Column(db.Float, default=0.0)
    node_metadata = db.Column(db.JSON, nullable=True, default=dict)
    is_start = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())

    def to_dict(self):
        return {
            "id": self.id,
            "flow_version_id": self.flow_version_id,
            "type": self.type,
            "title": self.title,
            "body": self.body,
            "position": {"x": self.position_x, "y": self.position_y},
            "metadata": self.node_metadata or {},
            "is_start": self.is_start,
        }


class Edge(db.Model):
    __tablename__ = "edges"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    flow_version_id = db.Column(db.String(36), db.ForeignKey("flow_versions.id"), nullable=False)
    source_node_id = db.Column(db.String(36), db.ForeignKey("nodes.id"), nullable=False)
    target_node_id = db.Column(db.String(36), db.ForeignKey("nodes.id"), nullable=False)
    condition_label = db.Column(db.String(255), nullable=False, default="")
    sort_order = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "flow_version_id": self.flow_version_id,
            "source": self.source_node_id,
            "target": self.target_node_id,
            "condition_label": self.condition_label,
            "sort_order": self.sort_order,
        }


class Session(db.Model):
    __tablename__ = "sessions"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    flow_version_id = db.Column(db.String(36), db.ForeignKey("flow_versions.id"), nullable=False)
    ticket_id = db.Column(db.String(100), nullable=True)
    agent_id = db.Column(db.String(100), nullable=True)
    agent_name = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(20), default="in_progress")
    current_node_id = db.Column(db.String(36), nullable=True)
    path_taken = db.Column(db.JSON, default=list)
    final_node_id = db.Column(db.String(36), nullable=True)
    resolution_type = db.Column(db.String(50), nullable=True)
    feedback_rating = db.Column(db.Integer, nullable=True)
    feedback_note = db.Column(db.Text, nullable=True)
    started_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())
    completed_at = db.Column(db.DateTime, nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "flow_version_id": self.flow_version_id,
            "ticket_id": self.ticket_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "status": self.status,
            "resolution_type": self.resolution_type,
            "current_node_id": self.current_node_id,
            "path_taken": self.path_taken,
            "final_node_id": self.final_node_id,
            "feedback_rating": self.feedback_rating,
            "feedback_note": self.feedback_note,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": self.duration_seconds,
        }


class SessionStep(db.Model):
    __tablename__ = "session_steps"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = db.Column(db.String(36), db.ForeignKey("sessions.id"), nullable=False)
    node_id = db.Column(db.String(36), nullable=False)
    edge_id = db.Column(db.String(36), nullable=False)
    answer_label = db.Column(db.String(255), nullable=False)
    step_number = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    action = db.Column(db.String(100), nullable=False)
    resource_type = db.Column(db.String(50), nullable=True)
    resource_id = db.Column(db.String(36), nullable=True)
    actor_id = db.Column(db.String(100), nullable=True)
    payload = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.utcnow())


# ─── HELPERS ──────────────────────────────────────────────

VALID_NODE_TYPES = {"question", "result"}


def audit(action, resource_type=None, resource_id=None, payload=None):
    actor = request.headers.get("X-Actor-Id")
    db.session.add(AuditLog(
        action=action, resource_type=resource_type,
        resource_id=resource_id, actor_id=actor, payload=payload,
    ))


def paginate_query(query, default_limit=50, max_limit=200):
    page = max(1, int(request.args.get("page", 1)))
    limit = min(max_limit, max(1, int(request.args.get("limit", default_limit))))
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    return items, {
        "total": total, "page": page, "limit": limit,
        "pages": (total + limit - 1) // limit,
        "has_next": page * limit < total, "has_prev": page > 1,
    }


def validate_required(data, *fields):
    missing = [f for f in fields if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400
    return None


def _copy_version_contents(source_version_id, new_version_id):
    """Copies nodes + edges from one version to another. Returns node id_map."""
    id_map = {}
    for n in Node.query.filter_by(flow_version_id=source_version_id).all():
        new_node = Node(
            flow_version_id=new_version_id, type=n.type, title=n.title, body=n.body,
            position_x=n.position_x, position_y=n.position_y,
            node_metadata=dict(n.node_metadata or {}), is_start=n.is_start,
        )
        db.session.add(new_node)
        db.session.flush()
        id_map[n.id] = new_node.id
    for e in Edge.query.filter_by(flow_version_id=source_version_id).all():
        if e.source_node_id in id_map and e.target_node_id in id_map:
            db.session.add(Edge(
                flow_version_id=new_version_id,
                source_node_id=id_map[e.source_node_id],
                target_node_id=id_map[e.target_node_id],
                condition_label=e.condition_label, sort_order=e.sort_order,
            ))
    return id_map


# ─── ERROR HANDLERS ───────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ─── HEALTH ───────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        db.session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return jsonify({
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
    })


# ─── FLOWS ────────────────────────────────────────────────

@app.get("/api/v1/flows")
def list_flows():
    query = Flow.query.filter_by(is_archived=False)
    search = request.args.get("search", "").strip()
    if search:
        query = query.filter(or_(Flow.name.ilike(f"%{search}%"), Flow.description.ilike(f"%{search}%")))
    category = request.args.get("category")
    if category:
        query = query.filter_by(category=category)
    status = request.args.get("status")
    if status == "live":
        query = query.filter(Flow.active_version_id.isnot(None))
    elif status == "draft":
        query = query.filter(Flow.active_version_id.is_(None))
    sort = request.args.get("sort", "newest")
    if sort == "oldest":
        query = query.order_by(Flow.created_at.asc())
    elif sort == "name":
        query = query.order_by(Flow.name.asc())
    else:
        query = query.order_by(Flow.created_at.desc())

    include_stats = request.args.get("stats") == "1"
    flows, pagination = paginate_query(query)
    resp = jsonify({
        "data": [f.to_dict(include_stats=include_stats) for f in flows],
        "pagination": pagination,
    })
    resp.headers["X-Total-Count"] = pagination["total"]
    return resp


@app.post("/api/v1/flows")
def create_flow():
    data = request.get_json(silent=True) or {}
    err = validate_required(data, "name")
    if err:
        return err
    if len(data["name"].strip()) > 255:
        return jsonify({"error": "Name must be 255 characters or fewer"}), 400
    flow = Flow(
        name=data["name"].strip(),
        description=data.get("description", "").strip() or None,
        category=data.get("category"),
        tags=data.get("tags", []),
    )
    db.session.add(flow)
    db.session.flush()
    version = FlowVersion(flow_id=flow.id, version_number=1, status="draft")
    db.session.add(version)
    audit("flow.created", "flow", flow.id, {"name": flow.name})
    db.session.commit()
    return jsonify(flow.to_dict()), 201


@app.get("/api/v1/flows/<flow_id>")
def get_flow(flow_id):
    flow = Flow.query.get_or_404(flow_id)
    versions = FlowVersion.query.filter_by(flow_id=flow_id).order_by(FlowVersion.version_number.desc()).all()
    data = flow.to_dict(include_stats=True)
    data["versions"] = [v.to_dict() for v in versions]
    return jsonify(data)


@app.put("/api/v1/flows/<flow_id>")
def update_flow(flow_id):
    flow = Flow.query.get_or_404(flow_id)
    data = request.get_json(silent=True) or {}
    if "name" in data:
        name = data["name"].strip()
        if not name:
            return jsonify({"error": "Name cannot be empty"}), 400
        flow.name = name
    if "description" in data:
        flow.description = data["description"].strip() or None
    if "category" in data:
        flow.category = data["category"]
    if "tags" in data:
        flow.tags = data["tags"]
    flow.updated_at = datetime.utcnow()
    audit("flow.updated", "flow", flow_id, {"fields": list(data.keys())})
    db.session.commit()
    return jsonify(flow.to_dict())


@app.delete("/api/v1/flows/<flow_id>")
def delete_flow(flow_id):
    """Soft-delete: archive the flow."""
    flow = Flow.query.get_or_404(flow_id)
    flow.is_archived = True
    flow.updated_at = datetime.utcnow()
    audit("flow.archived", "flow", flow_id)
    db.session.commit()
    return jsonify({"archived": True})


@app.delete("/api/v1/flows/<flow_id>/permanent")
def permanently_delete_flow(flow_id):
    """Hard delete — cascades to versions, nodes, edges."""
    flow = Flow.query.get_or_404(flow_id)
    audit("flow.deleted_permanent", "flow", flow_id, {"name": flow.name})
    # Manually delete versions, nodes, edges due to SQLite FK constraints
    version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
    if version_ids:
        node_ids = [n.id for n in Node.query.filter(Node.flow_version_id.in_(version_ids)).all()]
        if node_ids:
            Edge.query.filter(
                or_(Edge.source_node_id.in_(node_ids), Edge.target_node_id.in_(node_ids))
            ).delete(synchronize_session=False)
        Node.query.filter(Node.flow_version_id.in_(version_ids)).delete(synchronize_session=False)
        FlowVersion.query.filter_by(flow_id=flow_id).delete(synchronize_session=False)
    db.session.delete(flow)
    db.session.commit()
    return jsonify({"deleted": True})


@app.post("/api/v1/flows/<flow_id>/duplicate")
def duplicate_flow(flow_id):
    source = Flow.query.get_or_404(flow_id)
    data = request.get_json(silent=True) or {}
    source_version = (FlowVersion.query.get(source.active_version_id) if source.active_version_id else None) or \
        FlowVersion.query.filter_by(flow_id=flow_id).order_by(FlowVersion.version_number.desc()).first()
    if not source_version:
        return jsonify({"error": "No version found to duplicate"}), 400
    new_flow = Flow(
        name=data.get("name", f"Copy of {source.name}"),
        description=source.description,
        category=source.category,
        tags=list(source.tags or []),
    )
    db.session.add(new_flow)
    db.session.flush()
    new_version = FlowVersion(
        flow_id=new_flow.id, version_number=1, status="draft",
        change_notes=f"Duplicated from '{source.name}' v{source_version.version_number}",
    )
    db.session.add(new_version)
    db.session.flush()
    _copy_version_contents(source_version.id, new_version.id)
    audit("flow.duplicated", "flow", new_flow.id, {"source_flow_id": flow_id})
    db.session.commit()
    full = new_flow.to_dict()
    full["versions"] = [new_version.to_dict()]
    return jsonify(full), 201


@app.post("/api/v1/flows/<flow_id>/restore")
def restore_flow(flow_id):
    flow = Flow.query.get_or_404(flow_id)
    flow.is_archived = False
    flow.updated_at = datetime.utcnow()
    audit("flow.restored", "flow", flow_id)
    db.session.commit()
    return jsonify(flow.to_dict())


@app.get("/api/v1/flows/archived")
def list_archived_flows():
    flows = Flow.query.filter_by(is_archived=True).order_by(Flow.updated_at.desc()).all()
    return jsonify([f.to_dict() for f in flows])


# ─── CATEGORIES ───────────────────────────────────────────

@app.get("/api/v1/categories")
def list_categories():
    rows = db.session.query(Flow.category, func.count(Flow.id)).filter(
        Flow.is_archived == False, Flow.category.isnot(None)
    ).group_by(Flow.category).all()
    return jsonify([{"name": r[0], "count": r[1]} for r in rows])


# ─── VERSIONS ─────────────────────────────────────────────

@app.get("/api/v1/flows/<flow_id>/versions/<version_id>")
def get_version(flow_id, version_id):
    version = FlowVersion.query.filter_by(id=version_id, flow_id=flow_id).first_or_404()
    nodes = Node.query.filter_by(flow_version_id=version_id).all()
    edges = Edge.query.filter_by(flow_version_id=version_id).all()
    data = version.to_dict(include_graph=True)
    data["nodes"] = [n.to_dict() for n in nodes]
    data["edges"] = [e.to_dict() for e in edges]
    return jsonify(data)


@app.post("/api/v1/flows/<flow_id>/versions/<version_id>/publish")
def publish_version(flow_id, version_id):
    version = FlowVersion.query.filter_by(id=version_id, flow_id=flow_id).first_or_404()
    if version.status == "published":
        return jsonify({"error": "Version already published"}), 409
    start = Node.query.filter_by(flow_version_id=version_id, is_start=True).first()
    if not start:
        return jsonify({"error": "Flow must have a start node before publishing"}), 422
    data = request.get_json(silent=True) or {}
    version.status = "published"
    version.published_at = datetime.utcnow()
    version.change_notes = data.get("change_notes", version.change_notes)
    flow = Flow.query.get(flow_id)
    flow.active_version_id = version_id
    flow.updated_at = datetime.utcnow()
    audit("version.published", "flow_version", version_id,
          {"flow_id": flow_id, "version_number": version.version_number})
    db.session.commit()
    return jsonify(version.to_dict())


@app.post("/api/v1/flows/<flow_id>/versions")
def create_new_version(flow_id):
    """Create a new draft from the latest version (for iterating on published flows)."""
    Flow.query.get_or_404(flow_id)
    latest = FlowVersion.query.filter_by(flow_id=flow_id).order_by(FlowVersion.version_number.desc()).first()
    next_num = (latest.version_number + 1) if latest else 1
    data = request.get_json(silent=True) or {}
    new_version = FlowVersion(
        flow_id=flow_id, version_number=next_num, status="draft",
        change_notes=data.get("change_notes"),
    )
    db.session.add(new_version)
    db.session.flush()
    if latest:
        _copy_version_contents(latest.id, new_version.id)
    audit("version.created", "flow_version", new_version.id, {"flow_id": flow_id, "version_number": next_num})
    db.session.commit()
    return jsonify(new_version.to_dict()), 201


# ─── NODES ────────────────────────────────────────────────

@app.post("/api/v1/versions/<version_id>/nodes")
def create_node(version_id):
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    err = validate_required(data, "title")
    if err:
        return err
    if data.get("type") and data["type"] not in VALID_NODE_TYPES:
        return jsonify({"error": f"Invalid node type. Must be one of: {', '.join(VALID_NODE_TYPES)}"}), 400
    if data.get("is_start"):
        Node.query.filter_by(flow_version_id=version_id, is_start=True).update({"is_start": False})
    node = Node(
        flow_version_id=version_id,
        type=data.get("type", "question"),
        title=data["title"].strip(),
        body=(data.get("body") or "").strip() or None,
        position_x=data.get("position", {}).get("x", 0),
        position_y=data.get("position", {}).get("y", 0),
        node_metadata=data.get("metadata", {}),
        is_start=data.get("is_start", False),
    )
    db.session.add(node)
    db.session.commit()
    return jsonify(node.to_dict()), 201


@app.put("/api/v1/versions/<version_id>/nodes/<node_id>")
def update_node(version_id, node_id):
    node = Node.query.filter_by(id=node_id, flow_version_id=version_id).first_or_404()
    data = request.get_json(silent=True) or {}
    if "title" in data:
        title = data["title"].strip()
        if not title:
            return jsonify({"error": "Title cannot be empty"}), 400
        node.title = title
    if "body" in data:
        node.body = (data["body"] or "").strip() or None
    if "type" in data:
        if data["type"] not in VALID_NODE_TYPES:
            return jsonify({"error": "Invalid node type"}), 400
        node.type = data["type"]
    if "position" in data:
        node.position_x = data["position"].get("x", node.position_x)
        node.position_y = data["position"].get("y", node.position_y)
    if "metadata" in data:
        node.node_metadata = data["metadata"]
    if data.get("is_start"):
        Node.query.filter_by(flow_version_id=version_id, is_start=True).update({"is_start": False})
        node.is_start = True
    db.session.commit()
    return jsonify(node.to_dict())


@app.delete("/api/v1/versions/<version_id>/nodes/<node_id>")
def delete_node(version_id, node_id):
    node = Node.query.filter_by(id=node_id, flow_version_id=version_id).first_or_404()
    Edge.query.filter(
        or_(Edge.source_node_id == node_id, Edge.target_node_id == node_id)
    ).delete(synchronize_session=False)
    db.session.delete(node)
    db.session.commit()
    return jsonify({"deleted": True})


@app.put("/api/v1/versions/<version_id>/nodes/bulk-position")
def bulk_update_positions(version_id):
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    positions = data.get("positions", [])
    updated = 0
    for p in positions:
        node = Node.query.filter_by(id=p.get("id"), flow_version_id=version_id).first()
        if node:
            node.position_x = p.get("x", node.position_x)
            node.position_y = p.get("y", node.position_y)
            updated += 1
    db.session.commit()
    return jsonify({"updated": updated})


# ─── EDGES ────────────────────────────────────────────────

@app.post("/api/v1/versions/<version_id>/edges")
def create_edge(version_id):
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    err = validate_required(data, "source", "target")
    if err:
        return err
    if data["source"] == data["target"]:
        return jsonify({"error": "Source and target nodes cannot be the same"}), 400
    existing = Edge.query.filter_by(
        flow_version_id=version_id, source_node_id=data["source"],
        target_node_id=data["target"], condition_label=data.get("condition_label", ""),
    ).first()
    if existing:
        return jsonify({"error": "An identical connection already exists"}), 409
    edge = Edge(
        flow_version_id=version_id, source_node_id=data["source"], target_node_id=data["target"],
        condition_label=data.get("condition_label", "").strip(), sort_order=data.get("sort_order", 0),
    )
    db.session.add(edge)
    db.session.commit()
    return jsonify(edge.to_dict()), 201


@app.put("/api/v1/versions/<version_id>/edges/<edge_id>")
def update_edge(version_id, edge_id):
    edge = Edge.query.filter_by(id=edge_id, flow_version_id=version_id).first_or_404()
    data = request.get_json(silent=True) or {}
    if "condition_label" in data:
        edge.condition_label = data["condition_label"].strip()
    if "sort_order" in data:
        edge.sort_order = data["sort_order"]
    db.session.commit()
    return jsonify(edge.to_dict())


@app.delete("/api/v1/versions/<version_id>/edges/<edge_id>")
def delete_edge(version_id, edge_id):
    edge = Edge.query.filter_by(id=edge_id, flow_version_id=version_id).first_or_404()
    db.session.delete(edge)
    db.session.commit()
    return jsonify({"deleted": True})


# ─── SESSIONS ─────────────────────────────────────────────

@app.post("/api/v1/sessions")
def start_session():
    data = request.get_json(silent=True) or {}
    err = validate_required(data, "flow_id")
    if err:
        return err
    flow = Flow.query.get_or_404(data["flow_id"])
    # If caller passes version_id directly (test/draft mode), use that
    if data.get("version_id"):
        version_id = data["version_id"]
        version = FlowVersion.query.filter_by(id=version_id, flow_id=flow.id).first()
        if not version:
            return jsonify({"error": "Version not found"}), 404
    else:
        # Use published version if available, otherwise fall back to latest draft
        version_id = flow.active_version_id
        if not version_id:
            latest_draft = FlowVersion.query.filter_by(flow_id=flow.id, status="draft") \
                .order_by(FlowVersion.version_number.desc()).first()
            if not latest_draft:
                return jsonify({"error": "Flow has no published version and no draft"}), 400
            version_id = latest_draft.id
    start_node = Node.query.filter_by(flow_version_id=version_id, is_start=True).first()
    if not start_node:
        return jsonify({"error": "Flow has no start node"}), 400
    session = Session(
        flow_version_id=version_id,
        ticket_id=data.get("ticket_id"),
        agent_id=data.get("agent_id"),
        agent_name=data.get("agent_name"),
        current_node_id=start_node.id,
        path_taken=[start_node.id],
    )
    db.session.add(session)
    db.session.commit()
    return jsonify(_session_state(session)), 201


@app.get("/api/v1/sessions")
def list_sessions():
    query = Session.query
    flow_id = request.args.get("flow_id")
    if flow_id:
        version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
        query = query.filter(Session.flow_version_id.in_(version_ids))
    status = request.args.get("status")
    if status:
        query = query.filter_by(status=status)
    ticket = request.args.get("ticket_id")
    if ticket:
        query = query.filter(Session.ticket_id.ilike(f"%{ticket}%"))
    query = query.order_by(Session.started_at.desc())
    sessions, pagination = paginate_query(query)
    return jsonify({"data": [s.to_dict() for s in sessions], "pagination": pagination})


@app.get("/api/v1/sessions/<session_id>")
def get_session(session_id):
    session = Session.query.get_or_404(session_id)
    return jsonify(_session_state(session))


@app.post("/api/v1/sessions/<session_id>/step")
def submit_step(session_id):
    session = Session.query.get_or_404(session_id)
    if session.status == "completed":
        return jsonify({"error": "Session already completed"}), 400
    data = request.get_json(silent=True) or {}
    err = validate_required(data, "edge_id")
    if err:
        return err
    edge = Edge.query.filter_by(id=data["edge_id"], source_node_id=session.current_node_id).first()
    if not edge:
        return jsonify({"error": "Invalid edge for current node"}), 400
    db.session.add(SessionStep(
        session_id=session.id, node_id=session.current_node_id,
        edge_id=edge.id, answer_label=edge.condition_label,
        step_number=len(session.path_taken),
    ))
    next_node = Node.query.get(edge.target_node_id)
    if not next_node:
        return jsonify({"error": "Target node not found"}), 404
    session.current_node_id = next_node.id
    session.path_taken = session.path_taken + [next_node.id]
    if next_node.type == "result":
        session.status = "completed"
        session.final_node_id = next_node.id
        now = datetime.utcnow()
        session.completed_at = now
        started = session.started_at
        if started and getattr(started, "tzinfo", None):
            started = started.replace(tzinfo=None)
        if started:
            session.duration_seconds = int((now - started).total_seconds())
        session.resolution_type = (
            "escalated" if next_node.node_metadata and next_node.node_metadata.get("escalate_to")
            else "resolved"
        )
    db.session.commit()
    return jsonify(_session_state(session))


@app.post("/api/v1/sessions/<session_id>/back")
def go_back(session_id):
    session = Session.query.get_or_404(session_id)
    if len(session.path_taken) <= 1:
        return jsonify({"error": "Already at start"}), 400
    last_step = (
        SessionStep.query.filter_by(session_id=session.id)
        .order_by(SessionStep.step_number.desc()).first()
    )
    if last_step:
        db.session.delete(last_step)
    new_path = session.path_taken[:-1]
    session.path_taken = new_path
    session.current_node_id = new_path[-1]
    session.status = "in_progress"
    session.final_node_id = None
    session.completed_at = None
    session.duration_seconds = None
    session.resolution_type = None
    db.session.commit()
    return jsonify(_session_state(session))


@app.post("/api/v1/sessions/<session_id>/restart")
def restart_session(session_id):
    session = Session.query.get_or_404(session_id)
    start_node = Node.query.filter_by(flow_version_id=session.flow_version_id, is_start=True).first()
    if not start_node:
        return jsonify({"error": "Start node not found"}), 400
    SessionStep.query.filter_by(session_id=session.id).delete()
    session.current_node_id = start_node.id
    session.path_taken = [start_node.id]
    session.status = "in_progress"
    session.final_node_id = None
    session.completed_at = None
    session.duration_seconds = None
    session.resolution_type = None
    session.feedback_rating = None
    session.feedback_note = None
    db.session.commit()
    return jsonify(_session_state(session))


@app.post("/api/v1/sessions/<session_id>/feedback")
def submit_feedback(session_id):
    session = Session.query.get_or_404(session_id)
    if session.status != "completed":
        return jsonify({"error": "Can only rate completed sessions"}), 400
    data = request.get_json(silent=True) or {}
    rating = data.get("rating")
    if rating is not None:
        if not isinstance(rating, int) or not (1 <= rating <= 5):
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        session.feedback_rating = rating
    if "note" in data:
        session.feedback_note = data["note"]
    db.session.commit()
    return jsonify({"success": True, "rating": session.feedback_rating})


@app.get("/api/v1/sessions/<session_id>/export")
def export_session(session_id):
    """Full structured export of a session transcript."""
    session = Session.query.get_or_404(session_id)
    steps = SessionStep.query.filter_by(session_id=session.id).order_by(SessionStep.step_number).all()
    transcript = []
    for step in steps:
        node = Node.query.get(step.node_id)
        transcript.append({
            "step": step.step_number,
            "question": node.title if node else step.node_id,
            "answer": step.answer_label,
            "timestamp": step.created_at.isoformat() if step.created_at else None,
        })
    final_node = Node.query.get(session.final_node_id) if session.final_node_id else None
    return jsonify({
        "session_id": session.id,
        "ticket_id": session.ticket_id,
        "agent_id": session.agent_id,
        "agent_name": session.agent_name,
        "status": session.status,
        "resolution_type": session.resolution_type,
        "duration_seconds": session.duration_seconds,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "transcript": transcript,
        "resolution": {
            "title": final_node.title if final_node else None,
            "body": final_node.body if final_node else None,
            "metadata": final_node.node_metadata if final_node else {},
        } if final_node else None,
        "feedback_rating": session.feedback_rating,
        "feedback_note": session.feedback_note,
    })


# ─── ANALYTICS ────────────────────────────────────────────

@app.get("/api/v1/analytics/overview")
def analytics_overview():
    total_flows = Flow.query.filter_by(is_archived=False).count()
    live_flows = Flow.query.filter(Flow.is_archived == False, Flow.active_version_id.isnot(None)).count()
    total_sessions = Session.query.count()
    completed_sessions = Session.query.filter_by(status="completed").count()
    escalated = Session.query.filter_by(resolution_type="escalated").count()
    avg_dur = db.session.query(func.avg(Session.duration_seconds)).filter(
        Session.status == "completed", Session.duration_seconds.isnot(None)
    ).scalar()
    avg_rating = db.session.query(func.avg(Session.feedback_rating)).filter(
        Session.feedback_rating.isnot(None)
    ).scalar()
    cutoff = datetime.utcnow() - timedelta(days=30)
    recent = (
        db.session.query(func.date(Session.started_at).label("date"), func.count(Session.id).label("count"))
        .filter(Session.started_at >= cutoff)
        .group_by(func.date(Session.started_at))
        .order_by(func.date(Session.started_at))
        .all()
    )
    return jsonify({
        "flows": {"total": total_flows, "live": live_flows, "draft": total_flows - live_flows},
        "sessions": {
            "total": total_sessions,
            "completed": completed_sessions,
            "in_progress": total_sessions - completed_sessions,
            "completion_rate": round(completed_sessions / total_sessions * 100, 1) if total_sessions else 0,
            "escalation_rate": round(escalated / completed_sessions * 100, 1) if completed_sessions else 0,
        },
        "performance": {
            "avg_duration_seconds": round(avg_dur) if avg_dur else None,
            "avg_feedback_rating": round(float(avg_rating), 2) if avg_rating else None,
        },
        "sessions_over_time": [{"date": str(r.date), "count": r.count} for r in recent],
    })


@app.get("/api/v1/analytics/flows/<flow_id>")
def analytics_flow(flow_id):
    Flow.query.get_or_404(flow_id)
    version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
    sessions = Session.query.filter(Session.flow_version_id.in_(version_ids)).all() if version_ids else []
    completed = [s for s in sessions if s.status == "completed"]
    escalated = [s for s in completed if s.resolution_type == "escalated"]
    result_counts: dict = {}
    for s in completed:
        if s.final_node_id:
            result_counts[s.final_node_id] = result_counts.get(s.final_node_id, 0) + 1
    top_results = sorted(result_counts.items(), key=lambda x: -x[1])[:10]
    top_results_enriched = []
    for node_id, count in top_results:
        node = Node.query.get(node_id)
        top_results_enriched.append({
            "node_id": node_id,
            "title": node.title if node else "Unknown",
            "count": count,
            "pct": round(count / len(completed) * 100, 1) if completed else 0,
        })
    ratings: dict = {}
    for s in sessions:
        if s.feedback_rating:
            ratings[s.feedback_rating] = ratings.get(s.feedback_rating, 0) + 1
    return jsonify({
        "flow_id": flow_id,
        "sessions": {
            "total": len(sessions),
            "completed": len(completed),
            "in_progress": len(sessions) - len(completed),
            "escalated": len(escalated),
        },
        "avg_duration_seconds": (
            round(sum(s.duration_seconds for s in completed if s.duration_seconds) / len(completed))
            if completed else None
        ),
        "avg_steps": (
            round(sum(len(s.path_taken or []) for s in completed) / len(completed), 1)
            if completed else None
        ),
        "avg_rating": (
            round(sum(s.feedback_rating for s in sessions if s.feedback_rating) /
                  len([s for s in sessions if s.feedback_rating]), 2)
            if any(s.feedback_rating for s in sessions) else None
        ),
        "ratings_breakdown": ratings,
        "top_result_nodes": top_results_enriched,
    })


# ─── AUDIT LOG ────────────────────────────────────────────

@app.get("/api/v1/audit-logs")
def list_audit_logs():
    query = AuditLog.query.order_by(AuditLog.created_at.desc())
    if r := request.args.get("resource_type"):
        query = query.filter_by(resource_type=r)
    if r := request.args.get("resource_id"):
        query = query.filter_by(resource_id=r)
    logs, pagination = paginate_query(query, default_limit=100)
    return jsonify({
        "data": [{
            "id": l.id, "action": l.action, "resource_type": l.resource_type,
            "resource_id": l.resource_id, "actor_id": l.actor_id,
            "payload": l.payload, "created_at": l.created_at.isoformat(),
        } for l in logs],
        "pagination": pagination,
    })


# ─── SESSION STATE ────────────────────────────────────────

def _session_state(session):
    node = Node.query.get(session.current_node_id)
    if not node:
        return {"error": "Current node not found"}, 404
    steps = SessionStep.query.filter_by(session_id=session.id).order_by(SessionStep.step_number).all()
    step_map = {s.node_id: s.answer_label for s in steps}
    breadcrumb = []
    for node_id in session.path_taken[:-1]:
        past_node = Node.query.get(node_id)
        if past_node:
            answer = step_map.get(node_id, "")
            breadcrumb.append({
                "node_id": node_id,
                "question": past_node.title,
                "answer": answer,
                "label": f"{past_node.title} → {answer}" if answer else past_node.title,
            })
    response = {
        "session_id": session.id,
        "ticket_id": session.ticket_id,
        "agent_id": session.agent_id,
        "agent_name": session.agent_name,
        "status": session.status,
        "resolution_type": session.resolution_type,
        "step_number": len(session.path_taken),
        "current_node": node.to_dict(),
        "breadcrumb": [b["label"] for b in breadcrumb],
        "breadcrumb_structured": breadcrumb,
        "duration_seconds": session.duration_seconds,
        "feedback_rating": session.feedback_rating,
    }
    if node.type != "result":
        edges = Edge.query.filter_by(source_node_id=node.id).order_by(Edge.sort_order).all()
        response["options"] = [{"edge_id": e.id, "label": e.condition_label} for e in edges]
    else:
        response["options"] = []
    return response


# ─── TEXT TO FLOW (Google Gemini) ────────────────────────────

def _parse_ai_json(raw_text):
    """
    Robustly extract and parse a JSON object from AI output.
    Handles markdown fences, leading/trailing prose, trailing commas,
    and other common AI formatting quirks. Returns parsed dict or None.
    """
    if not raw_text:
        return None

    text = raw_text.strip()

    # 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```\s*$', '', text)
    text = text.strip()

    # 2. Try direct parse first (cheapest path)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 3. Extract the outermost {...} block -- handles prose before/after JSON
    brace_start = text.find('{')
    brace_end = text.rfind('}')
    if brace_start != -1 and brace_end > brace_start:
        candidate = text[brace_start:brace_end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

        # 4. Fix trailing commas before } or ] -- a very common AI mistake
        fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass

        # 5. Fix single-quoted strings -> double-quoted
        fixed2 = re.sub(r"(?<![\\])'", '"', fixed)
        try:
            return json.loads(fixed2)
        except json.JSONDecodeError:
            pass

    # 6. Truncation recovery: walk character-by-character tracking bracket depth
    #    so we can close any open brackets and parse whatever arrived completely.
    #    This handles responses cut off mid-string or mid-object by token limits.
    if brace_start != -1:
        candidate = text[brace_start:]
        depth_curly = 0
        depth_square = 0
        in_string = False
        escape_next = False
        last_complete_node_end = -1  # position after the last fully-closed node object

        for i, ch in enumerate(candidate):
            if escape_next:
                escape_next = False
                continue
            if in_string:
                if ch == '\\':
                    escape_next = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == '{':
                depth_curly += 1
            elif ch == '}':
                depth_curly -= 1
                # A depth_curly==1 here means we just closed an item inside the
                # top-level object (e.g. a node), depth==0 means top-level closed.
                if depth_curly >= 1 and depth_square == 1:
                    last_complete_node_end = i  # end of a fully-closed array item
            elif ch == '[':
                depth_square += 1
            elif ch == ']':
                depth_square -= 1

        # Build a set of candidates to try, from most to least complete
        attempts_to_try = []

        # Attempt A: close open brackets at the exact truncation point
        closing = ']' * max(0, depth_square) + '}' * max(0, depth_curly)
        attempts_to_try.append(candidate + closing)

        # Attempt B: rewind to the last fully-closed array item, then close
        if last_complete_node_end > 0:
            truncated_at_last_good = candidate[:last_complete_node_end + 1]
            # Strip trailing comma if any, then close remaining brackets
            truncated_at_last_good = truncated_at_last_good.rstrip().rstrip(',')
            # We need to close: the nodes array ] + the root object }
            attempts_to_try.append(truncated_at_last_good + "]}")

        for attempt in attempts_to_try:
            attempt = re.sub(r',\s*([}\]])', r'\1', attempt)
            try:
                result = json.loads(attempt)
                if isinstance(result, dict) and result.get("nodes"):
                    return result
            except json.JSONDecodeError:
                pass

    return None


TEXT_TO_FLOW_PROMPT = """You are a flow builder expert. Convert a natural language description into a structured decision/resolution flow used by support agents.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "nodes": [
    {
      "id": "0",
      "title": "Short question or step title",
      "type": "question",
      "body": "Optional longer explanation or context for this step",
      "is_start": true,
      "position": {"x": 60, "y": 60}
    }
  ],
  "edges": [
    {
      "source": "0",
      "target": "1",
      "label": "yes"
    }
  ],
  "suggestions": ["Any suggestions for improving the flow"]
}

CRITICAL: All node "id" values and edge "source"/"target" values MUST be strings (e.g. "0", "1", "2").

Node type rules:
- "question": any step where the agent asks something, checks something, or takes an action
- "result": final outcomes — resolutions, escalations, solutions, dead ends
- Exactly ONE node must have "is_start": true — the entry point of the flow
- Every branch must eventually reach a "result" node
- Result nodes should have a "body" that describes the resolution steps

Position rules:
- Start node at x=60, y=60
- Space nodes 300px apart horizontally, 180px apart vertically
- Branch left/right for yes/no decisions, continue downward for linear steps
- Ensure no two nodes share the same position

Edge rules:
- source and target are the STRING "id" values of nodes
- Every edge must reference valid node IDs that exist in the nodes array
- label should be short: "yes", "no", "resolved", "escalate", "restart", etc.
- Every "question" node must have at least one outgoing edge

Quality rules:
- Keep titles short (under 60 chars) — they appear in UI buttons
- Body can be longer — it gives context to the agent
- Create realistic, practical flows an agent would actually use
- Don't over-engineer: 5-15 nodes is ideal for most flows
- Capture ALL branches described, including escalation paths and dead ends

Return ONLY the JSON object. No markdown fences. No explanation. No trailing text."""


@app.post("/api/v1/flows/generate-from-text")
def generate_flow_from_text():
    """Generate a flow from a natural language description using Google Gemini."""
    if not GEMINI_AVAILABLE:
        return jsonify({"error": "google-genai not installed. Run: pip install google-genai"}), 503

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY not configured. Add it to your .env file."}), 503

    data = request.get_json(silent=True) or {}
    description = (data.get("description") or "").strip()

    if not description:
        return jsonify({"error": "Missing description"}), 400
    if len(description) < 10:
        return jsonify({"error": "Description is too short. Please describe your flow in more detail."}), 400
    if len(description) > 5000:
        return jsonify({"error": "Description is too long. Please keep it under 5000 characters."}), 400

    try:
        client = _genai.Client(api_key=api_key)

        # Schema constrains Gemini to output exactly our required structure
        # This is the most reliable way to get valid JSON — enforced at token level
        FLOW_SCHEMA = _genai_types.Schema(
            type=_genai_types.Type.OBJECT,
            required=["nodes", "edges"],
            properties={
                "nodes": _genai_types.Schema(
                    type=_genai_types.Type.ARRAY,
                    items=_genai_types.Schema(
                        type=_genai_types.Type.OBJECT,
                        required=["id", "title", "type", "is_start"],
                        properties={
                            "id": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "title": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "type": _genai_types.Schema(
                                type=_genai_types.Type.STRING,
                                enum=["question", "result"],
                            ),
                            "body": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "resolution": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "is_start": _genai_types.Schema(type=_genai_types.Type.BOOLEAN),
                            "position": _genai_types.Schema(
                                type=_genai_types.Type.OBJECT,
                                properties={
                                    "x": _genai_types.Schema(type=_genai_types.Type.NUMBER),
                                    "y": _genai_types.Schema(type=_genai_types.Type.NUMBER),
                                },
                            ),
                        },
                    ),
                ),
                "edges": _genai_types.Schema(
                    type=_genai_types.Type.ARRAY,
                    items=_genai_types.Schema(
                        type=_genai_types.Type.OBJECT,
                        required=["source", "target"],
                        properties={
                            "source": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "target": _genai_types.Schema(type=_genai_types.Type.STRING),
                            "label": _genai_types.Schema(type=_genai_types.Type.STRING),
                        },
                    ),
                ),
                "suggestions": _genai_types.Schema(
                    type=_genai_types.Type.ARRAY,
                    items=_genai_types.Schema(type=_genai_types.Type.STRING),
                ),
            },
        )

        def _call_gemini(temperature):
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"Convert this flow description into a structured JSON flow:\n\n{description}",
                config=_genai_types.GenerateContentConfig(
                    system_instruction=TEXT_TO_FLOW_PROMPT,
                    temperature=temperature,
                    max_output_tokens=8192,
                    response_mime_type="application/json",
                    response_schema=FLOW_SCHEMA,
                ),
            )

        def _check_truncated(response):
            """Return True if the response was cut off before finishing."""
            try:
                candidate = response.candidates[0]
                reason = str(candidate.finish_reason)
                # finish_reason MAX_TOKENS means output was cut off
                return "MAX_TOKENS" in reason or reason == "2"
            except Exception:
                return False

        # First attempt
        response = _call_gemini(temperature=0.2)
        raw_text = response.text.strip() if response.text else ""

        if _check_truncated(response):
            app.logger.warning("Gemini response truncated (MAX_TOKENS). Asking for a shorter flow.")
            # Ask for a more concise flow that fits within the token budget
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=(
                    f"Convert this flow description into a CONCISE JSON flow (max 10 nodes).\n\n{description}"
                ),
                config=_genai_types.GenerateContentConfig(
                    system_instruction=TEXT_TO_FLOW_PROMPT,
                    temperature=0,
                    max_output_tokens=8192,
                    response_mime_type="application/json",
                    response_schema=FLOW_SCHEMA,
                ),
            )
            raw_text = response.text.strip() if response.text else ""

        parsed = _parse_ai_json(raw_text)
        if parsed is None:
            app.logger.warning("First Gemini call returned unparseable JSON, retrying. Raw: %s", raw_text[:200])
            response2 = _call_gemini(temperature=0)
            raw_text = response2.text.strip() if response2.text else ""
            parsed = _parse_ai_json(raw_text)

        if parsed is None:
            app.logger.error("Both Gemini calls failed to return valid JSON. Raw: %s", raw_text[:500])
            return jsonify({
                "error": "AI returned malformed JSON. Please try again — if this keeps happening, try shortening your description.",
                "raw": raw_text[:300],
            }), 500

        nodes = parsed.get("nodes", [])
        edges = parsed.get("edges", [])
        suggestions = parsed.get("suggestions", [])

        if not isinstance(nodes, list) or len(nodes) == 0:
            return jsonify({"error": "AI could not generate a flow from that description. Please try being more specific."}), 422

        # Normalize all node IDs to strings for consistent cross-referencing
        for i, node in enumerate(nodes):
            # If the AI omitted an id, assign one; always stringify for consistency
            raw_id = node.get("id")
            node["id"] = str(raw_id) if raw_id is not None else str(i)
            node.setdefault("title", f"Step {i + 1}")
            # Enforce valid type
            node["type"] = "result" if node.get("type") == "result" else "question"
            node.setdefault("body", "")
            node.setdefault("resolution", "")
            node.setdefault("is_start", False)
            node.setdefault("position", {"x": (i % 4) * 300 + 60, "y": (i // 4) * 180 + 60})
            # Ensure position values are numeric
            pos = node["position"]
            if not isinstance(pos.get("x"), (int, float)):
                pos["x"] = (i % 4) * 300 + 60
            if not isinstance(pos.get("y"), (int, float)):
                pos["y"] = (i // 4) * 180 + 60

        start_nodes = [n for n in nodes if n.get("is_start")]
        if len(start_nodes) == 0 and nodes:
            nodes[0]["is_start"] = True
            suggestions.append("Could not determine start node — defaulted to first node.")
        elif len(start_nodes) > 1:
            for n in start_nodes[1:]:
                n["is_start"] = False
            suggestions.append("Multiple start nodes detected — kept only the first.")

        # Validate edges: compare as strings to match normalized node IDs
        node_ids = {n["id"] for n in nodes}
        valid_edges = []
        skipped = []
        for edge in edges:
            src = str(edge.get("source")) if edge.get("source") is not None else None
            tgt = str(edge.get("target")) if edge.get("target") is not None else None
            edge["source"] = src
            edge["target"] = tgt
            edge.setdefault("label", "")
            if src in node_ids and tgt in node_ids:
                valid_edges.append(edge)
            else:
                skipped.append(f"Skipped edge {src} -> {tgt}: unknown node ID.")
        if skipped:
            suggestions.extend(skipped)

        # Warn if any question node has no outgoing edges
        question_ids = {n["id"] for n in nodes if n["type"] == "question"}
        edge_sources = {e["source"] for e in valid_edges}
        orphan_questions = question_ids - edge_sources
        for oid in orphan_questions:
            node_title = next((n["title"] for n in nodes if n["id"] == oid), oid)
            suggestions.append(f"Question node '{node_title}' has no outgoing connections — it may be a dead end.")

        audit("flow.generate_from_text", payload={
            "description_length": len(description),
            "node_count": len(nodes),
            "edge_count": len(valid_edges),
        })

        return jsonify({
            "nodes": nodes,
            "edges": valid_edges,
            "suggestions": suggestions,
            "meta": {"model": "gemini-2.5-flash"},
        })

    except Exception as e:
        err_str = str(e).lower()
        if "api_key" in err_str or "api key" in err_str or "invalid" in err_str:
            return jsonify({"error": "Invalid Gemini API key. Check GEMINI_API_KEY in your .env file."}), 503
        if "quota" in err_str or "rate" in err_str or "429" in err_str:
            return jsonify({"error": "Rate limit reached. Please wait a moment and try again."}), 429
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


# ─── INIT ─────────────────────────────────────────────────

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)