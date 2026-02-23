import uuid
from datetime import datetime
from extensions import db


class Flow(db.Model):
    __tablename__ = "flows"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category = db.Column(db.String(100), nullable=True)
    tags = db.Column(db.JSON, nullable=True, default=list)
    active_version_id = db.Column(db.String(36), nullable=True)
    is_archived = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, include_stats=False):
        all_versions = (
            FlowVersion.query
            .filter_by(flow_id=self.id)
            .order_by(FlowVersion.version_number.desc())
            .all()
        )
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
            "versions": [
                {"id": v.id, "status": v.status, "version_number": v.version_number}
                for v in all_versions
            ],
        }
        if include_stats:
            version_ids = [v.id for v in all_versions]
            sessions = (
                Session.query.filter(Session.flow_version_id.in_(version_ids)).all()
                if version_ids else []
            )
            completed = [s for s in sessions if s.status == "completed"]
            data["stats"] = {
                "total_sessions": len(sessions),
                "completed_sessions": len(completed),
                "avg_duration_seconds": (
                    round(
                        sum(s.duration_seconds for s in completed if s.duration_seconds)
                        / len(completed)
                    )
                    if completed else None
                ),
                "node_count": (
                    Node.query.filter(Node.flow_version_id.in_(version_ids)).count()
                    if version_ids else 0
                ),
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    action = db.Column(db.String(100), nullable=False)
    resource_type = db.Column(db.String(50), nullable=True)
    resource_id = db.Column(db.String(36), nullable=True)
    actor_id = db.Column(db.String(100), nullable=True)
    payload = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)