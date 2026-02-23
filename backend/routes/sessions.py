from datetime import datetime
from flask import Blueprint, request, jsonify
from extensions import db
from models import Flow, FlowVersion, Node, Edge, Session, SessionStep
from routes import paginate_query, validate_required

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/v1")


def _build_session_state(session):
    """Build the full state payload returned after every session action."""
    node = Node.query.get(session.current_node_id)
    if not node:
        return {"error": "Current node not found"}, 404

    steps = (
        SessionStep.query
        .filter_by(session_id=session.id)
        .order_by(SessionStep.step_number)
        .all()
    )
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

    payload = {
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
        payload["options"] = [{"edge_id": e.id, "label": e.condition_label} for e in edges]
    else:
        payload["options"] = []

    return payload


# ── Session lifecycle ──────────────────────────────────────────

@sessions_bp.post("/sessions")
def start_session():
    data = request.get_json(silent=True) or {}
    if err := validate_required(data, "flow_id"):
        return err

    flow = Flow.query.get_or_404(data["flow_id"])

    if data.get("version_id"):
        version = FlowVersion.query.filter_by(
            id=data["version_id"], flow_id=flow.id
        ).first()
        if not version:
            return jsonify({"error": "Version not found"}), 404
        version_id = version.id
    else:
        version_id = flow.active_version_id
        if not version_id:
            latest_draft = (
                FlowVersion.query
                .filter_by(flow_id=flow.id, status="draft")
                .order_by(FlowVersion.version_number.desc())
                .first()
            )
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
    return jsonify(_build_session_state(session)), 201


@sessions_bp.get("/sessions")
def list_sessions():
    query = Session.query

    if flow_id := request.args.get("flow_id"):
        version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
        query = query.filter(Session.flow_version_id.in_(version_ids))
    if status := request.args.get("status"):
        query = query.filter_by(status=status)
    if ticket := request.args.get("ticket_id"):
        query = query.filter(Session.ticket_id.ilike(f"%{ticket}%"))

    query = query.order_by(Session.started_at.desc())
    sessions, pagination = paginate_query(query)
    return jsonify({"data": [s.to_dict() for s in sessions], "pagination": pagination})


@sessions_bp.get("/sessions/<session_id>")
def get_session(session_id):
    session = Session.query.get_or_404(session_id)
    return jsonify(_build_session_state(session))


@sessions_bp.post("/sessions/<session_id>/step")
def submit_step(session_id):
    session = Session.query.get_or_404(session_id)
    if session.status == "completed":
        return jsonify({"error": "Session already completed"}), 400

    data = request.get_json(silent=True) or {}
    if err := validate_required(data, "edge_id"):
        return err

    edge = Edge.query.filter_by(
        id=data["edge_id"], source_node_id=session.current_node_id
    ).first()
    if not edge:
        return jsonify({"error": "Invalid edge for current node"}), 400

    next_node = Node.query.get(edge.target_node_id)
    if not next_node:
        return jsonify({"error": "Target node not found"}), 404

    db.session.add(SessionStep(
        session_id=session.id,
        node_id=session.current_node_id,
        edge_id=edge.id,
        answer_label=edge.condition_label,
        step_number=len(session.path_taken),
    ))

    session.current_node_id = next_node.id
    session.path_taken = session.path_taken + [next_node.id]

    if next_node.type == "result":
        now = datetime.utcnow()
        session.status = "completed"
        session.final_node_id = next_node.id
        session.completed_at = now
        started = session.started_at
        if started and getattr(started, "tzinfo", None):
            started = started.replace(tzinfo=None)
        if started:
            session.duration_seconds = int((now - started).total_seconds())
        session.resolution_type = (
            "escalated"
            if next_node.node_metadata and next_node.node_metadata.get("escalate_to")
            else "resolved"
        )

    db.session.commit()
    return jsonify(_build_session_state(session))


@sessions_bp.post("/sessions/<session_id>/back")
def go_back(session_id):
    session = Session.query.get_or_404(session_id)
    if len(session.path_taken) <= 1:
        return jsonify({"error": "Already at start"}), 400

    last_step = (
        SessionStep.query
        .filter_by(session_id=session.id)
        .order_by(SessionStep.step_number.desc())
        .first()
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
    return jsonify(_build_session_state(session))


@sessions_bp.post("/sessions/<session_id>/restart")
def restart_session(session_id):
    session = Session.query.get_or_404(session_id)
    start_node = Node.query.filter_by(
        flow_version_id=session.flow_version_id, is_start=True
    ).first()
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
    return jsonify(_build_session_state(session))


@sessions_bp.post("/sessions/<session_id>/feedback")
def submit_feedback(session_id):
    session = Session.query.get_or_404(session_id)
    if session.status != "completed":
        return jsonify({"error": "Can only rate completed sessions"}), 400

    data = request.get_json(silent=True) or {}
    if (rating := data.get("rating")) is not None:
        if not isinstance(rating, int) or not (1 <= rating <= 5):
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        session.feedback_rating = rating
    if "note" in data:
        session.feedback_note = data["note"]

    db.session.commit()
    return jsonify({"success": True, "rating": session.feedback_rating})


@sessions_bp.get("/sessions/<session_id>/export")
def export_session(session_id):
    """Return a full structured transcript of the session."""
    session = Session.query.get_or_404(session_id)
    steps = (
        SessionStep.query
        .filter_by(session_id=session.id)
        .order_by(SessionStep.step_number)
        .all()
    )
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
            "title": final_node.title,
            "body": final_node.body,
            "metadata": final_node.node_metadata,
        } if final_node else None,
        "feedback_rating": session.feedback_rating,
        "feedback_note": session.feedback_note,
    })