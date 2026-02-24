from datetime import datetime
from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from extensions import db
from models import Flow, FlowVersion, Node, Edge, Session, SessionStep
from routes import audit, paginate_query, validate_required

flows_bp = Blueprint("flows", __name__, url_prefix="/api/v1")


def _copy_version_contents(source_version_id, new_version_id):
    """Copy all nodes and edges from one version to another."""
    id_map = {}
    for node in Node.query.filter_by(flow_version_id=source_version_id).all():
        new_node = Node(
            flow_version_id=new_version_id,
            type=node.type,
            title=node.title,
            body=node.body,
            position_x=node.position_x,
            position_y=node.position_y,
            node_metadata=dict(node.node_metadata or {}),
            is_start=node.is_start,
        )
        db.session.add(new_node)
        db.session.flush()
        id_map[node.id] = new_node.id

    for edge in Edge.query.filter_by(flow_version_id=source_version_id).all():
        if edge.source_node_id in id_map and edge.target_node_id in id_map:
            db.session.add(Edge(
                flow_version_id=new_version_id,
                source_node_id=id_map[edge.source_node_id],
                target_node_id=id_map[edge.target_node_id],
                condition_label=edge.condition_label,
                sort_order=edge.sort_order,
            ))
    return id_map


# ── Flows ─────────────────────────────────────────────────────

@flows_bp.get("/flows")
def list_flows():
    query = Flow.query.filter_by(is_archived=False)

    if search := request.args.get("search", "").strip():
        query = query.filter(
            or_(Flow.name.ilike(f"%{search}%"), Flow.description.ilike(f"%{search}%"))
        )
    if category := request.args.get("category"):
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


@flows_bp.post("/flows")
def create_flow():
    data = request.get_json(silent=True) or {}
    if err := validate_required(data, "name"):
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
    db.session.add(FlowVersion(flow_id=flow.id, version_number=1, status="draft"))
    audit("flow.created", "flow", flow.id, {"name": flow.name})
    db.session.commit()
    return jsonify(flow.to_dict()), 201


@flows_bp.get("/flows/archived")
def list_archived_flows():
    flows = Flow.query.filter_by(is_archived=True).order_by(Flow.updated_at.desc()).all()
    return jsonify([f.to_dict() for f in flows])


@flows_bp.post("/flows/suggest")
def suggest_flow():
    """Given a plain-English issue, return the best matching published flow(s)."""
    import json
    from flask import current_app

    try:
        from routes.ai import _suggest_with_groq, _suggest_with_gemini, GROQ_AVAILABLE, GEMINI_AVAILABLE
    except ImportError as exc:
        return jsonify({"error": f"AI module not available: {exc}. Make sure routes/ai.py is up to date."}), 503

    data = request.get_json(silent=True) or {}
    issue = (data.get("issue") or "").strip()
    provider = (data.get("provider") or "groq").lower()

    if not issue:
        return jsonify({"error": "Missing issue description"}), 400
    if len(issue) > 2000:
        return jsonify({"error": "Issue description too long — keep it under 2000 characters."}), 400
    if provider not in ("gemini", "groq"):
        return jsonify({"error": "Invalid provider. Must be 'gemini' or 'groq'."}), 400

    published_flows = (
        Flow.query
        .filter_by(is_archived=False)
        .filter(Flow.active_version_id.isnot(None))
        .all()
    )

    if not published_flows:
        return jsonify({
            "no_match": True,
            "top_match": None,
            "alternatives": [],
            "meta": {"flows_searched": 0, "model": "n/a", "provider": provider},
        })

    flows_context = json.dumps([{
        "flow_id": f.id,
        "flow_name": f.name,
        "active_version_id": f.active_version_id,
        "description": f.description or "",
        "category": f.category or "",
        "tags": f.tags or [],
    } for f in published_flows], indent=2)

    try:
        if provider == "groq" and GROQ_AVAILABLE:
            parsed, model_used = _suggest_with_groq(
                issue, flows_context, current_app.config, current_app.logger
            )
        elif GEMINI_AVAILABLE:
            parsed, model_used = _suggest_with_gemini(
                issue, flows_context, current_app.config, current_app.logger
            )
        else:
            return jsonify({"error": "No AI provider available. Configure GROQ_API_KEY or GEMINI_API_KEY."}), 503
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        err = str(exc).lower()
        current_app.logger.error("%s suggest error: %s", provider, exc)
        if "quota" in err or "rate_limit" in err or "429" in err:
            return jsonify({"error": f"Rate limit reached for {provider}. Please wait a moment."}), 429
        return jsonify({"error": f"{provider.capitalize()} error: {exc}"}), 500

    if parsed is None:
        return jsonify({"error": "AI returned malformed JSON. Please try again."}), 500

    valid_ids = {f.id for f in published_flows}

    def _validate_match(match):
        if not match or not isinstance(match, dict):
            return None
        if match.get("flow_id") not in valid_ids:
            return None
        return match

    top_match = _validate_match(parsed.get("top_match"))
    alternatives = [
        m for m in (parsed.get("alternatives") or [])
        if _validate_match(m) and (not top_match or m.get("flow_id") != top_match.get("flow_id"))
    ]
    no_match = parsed.get("no_match", False) or top_match is None

    audit("flow.suggest", payload={
        "provider": provider,
        "issue_length": len(issue),
        "flows_searched": len(published_flows),
        "matched": not no_match,
    })

    return jsonify({
        "no_match": no_match,
        "top_match": top_match,
        "alternatives": alternatives[:2],
        "meta": {
            "flows_searched": len(published_flows),
            "model": model_used,
            "provider": provider,
        },
    })


@flows_bp.get("/flows/<flow_id>")
def get_flow(flow_id):
    flow = Flow.query.get_or_404(flow_id)
    versions = (
        FlowVersion.query
        .filter_by(flow_id=flow_id)
        .order_by(FlowVersion.version_number.desc())
        .all()
    )
    data = flow.to_dict(include_stats=True)
    data["versions"] = [v.to_dict() for v in versions]
    return jsonify(data)


@flows_bp.put("/flows/<flow_id>")
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


@flows_bp.delete("/flows/<flow_id>")
def archive_flow(flow_id):
    """Soft delete — moves to archive, recoverable."""
    flow = Flow.query.get_or_404(flow_id)
    flow.is_archived = True
    flow.updated_at = datetime.utcnow()
    audit("flow.archived", "flow", flow_id)
    db.session.commit()
    return jsonify({"archived": True})


@flows_bp.delete("/flows/<flow_id>/permanent")
def permanently_delete_flow(flow_id):
    """Hard delete — removes all versions, nodes, edges, sessions permanently."""
    flow = Flow.query.get_or_404(flow_id)
    audit("flow.deleted_permanent", "flow", flow_id, {"name": flow.name})

    version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
    if version_ids:
        # Must delete in FK-dependency order: steps → sessions → edges → nodes → versions
        session_ids = [
            s.id for s in Session.query.filter(
                Session.flow_version_id.in_(version_ids)
            ).all()
        ]
        if session_ids:
            SessionStep.query.filter(
                SessionStep.session_id.in_(session_ids)
            ).delete(synchronize_session=False)
            Session.query.filter(
                Session.id.in_(session_ids)
            ).delete(synchronize_session=False)

        node_ids = [
            n.id for n in Node.query.filter(
                Node.flow_version_id.in_(version_ids)
            ).all()
        ]
        if node_ids:
            Edge.query.filter(
                or_(
                    Edge.source_node_id.in_(node_ids),
                    Edge.target_node_id.in_(node_ids),
                )
            ).delete(synchronize_session=False)
        Node.query.filter(
            Node.flow_version_id.in_(version_ids)
        ).delete(synchronize_session=False)
        FlowVersion.query.filter_by(flow_id=flow_id).delete(synchronize_session=False)

    db.session.delete(flow)
    db.session.commit()
    return jsonify({"deleted": True})


@flows_bp.post("/flows/<flow_id>/duplicate")
def duplicate_flow(flow_id):
    source = Flow.query.get_or_404(flow_id)
    data = request.get_json(silent=True) or {}
    source_version = (
        FlowVersion.query.get(source.active_version_id)
        if source.active_version_id else None
    ) or FlowVersion.query.filter_by(flow_id=flow_id).order_by(
        FlowVersion.version_number.desc()
    ).first()

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
        flow_id=new_flow.id,
        version_number=1,
        status="draft",
        change_notes=f"Duplicated from '{source.name}' v{source_version.version_number}",
    )
    db.session.add(new_version)
    db.session.flush()
    _copy_version_contents(source_version.id, new_version.id)
    audit("flow.duplicated", "flow", new_flow.id, {"source_flow_id": flow_id})
    db.session.commit()

    result = new_flow.to_dict()
    result["versions"] = [new_version.to_dict()]
    return jsonify(result), 201


@flows_bp.post("/flows/<flow_id>/restore")
def restore_flow(flow_id):
    flow = Flow.query.get_or_404(flow_id)
    flow.is_archived = False
    flow.updated_at = datetime.utcnow()
    audit("flow.restored", "flow", flow_id)
    db.session.commit()
    return jsonify(flow.to_dict())


# ── Categories ────────────────────────────────────────────────

@flows_bp.get("/categories")
def list_categories():
    rows = (
        db.session.query(Flow.category, func.count(Flow.id))
        .filter(Flow.is_archived == False, Flow.category.isnot(None))
        .group_by(Flow.category)
        .all()
    )
    return jsonify([{"name": r[0], "count": r[1]} for r in rows])