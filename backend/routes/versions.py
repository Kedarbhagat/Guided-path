from datetime import datetime
from flask import Blueprint, request, jsonify
from sqlalchemy import or_
from extensions import db
from models import Flow, FlowVersion, Node, Edge
from routes import audit, validate_required, VALID_NODE_TYPES

versions_bp = Blueprint("versions", __name__, url_prefix="/api/v1")


# ── Versions ──────────────────────────────────────────────────

@versions_bp.get("/flows/<flow_id>/versions/<version_id>")
def get_version(flow_id, version_id):
    version = FlowVersion.query.filter_by(id=version_id, flow_id=flow_id).first_or_404()
    data = version.to_dict(include_graph=True)
    data["nodes"] = [n.to_dict() for n in Node.query.filter_by(flow_version_id=version_id).all()]
    data["edges"] = [e.to_dict() for e in Edge.query.filter_by(flow_version_id=version_id).all()]
    return jsonify(data)


@versions_bp.post("/flows/<flow_id>/versions/<version_id>/publish")
def publish_version(flow_id, version_id):
    version = FlowVersion.query.filter_by(id=version_id, flow_id=flow_id).first_or_404()
    if version.status == "published":
        return jsonify({"error": "Version already published"}), 409
    if not Node.query.filter_by(flow_version_id=version_id, is_start=True).first():
        return jsonify({"error": "Flow must have a start node before publishing"}), 422

    data = request.get_json(silent=True) or {}
    version.status = "published"
    version.published_at = datetime.utcnow()
    version.change_notes = data.get("change_notes", version.change_notes)

    flow = Flow.query.get(flow_id)
    flow.active_version_id = version_id
    flow.updated_at = datetime.utcnow()
    audit("version.published", "flow_version", version_id, {
        "flow_id": flow_id,
        "version_number": version.version_number,
    })
    db.session.commit()
    return jsonify(version.to_dict())


@versions_bp.post("/flows/<flow_id>/versions")
def create_new_version(flow_id):
    """Branch a new draft from the latest version of a flow."""
    Flow.query.get_or_404(flow_id)
    latest = (
        FlowVersion.query
        .filter_by(flow_id=flow_id)
        .order_by(FlowVersion.version_number.desc())
        .first()
    )
    next_num = (latest.version_number + 1) if latest else 1
    data = request.get_json(silent=True) or {}
    new_version = FlowVersion(
        flow_id=flow_id,
        version_number=next_num,
        status="draft",
        change_notes=data.get("change_notes"),
    )
    db.session.add(new_version)
    db.session.flush()

    if latest:
        from routes.flows import _copy_version_contents
        _copy_version_contents(latest.id, new_version.id)

    audit("version.created", "flow_version", new_version.id, {"flow_id": flow_id})
    db.session.commit()
    return jsonify(new_version.to_dict(include_graph=True)), 201


# ── Nodes ─────────────────────────────────────────────────────

@versions_bp.post("/versions/<version_id>/nodes")
def create_node(version_id):
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    if err := validate_required(data, "title"):
        return err

    node_type = data.get("type", "question")
    if node_type not in VALID_NODE_TYPES:
        return jsonify({"error": f"Invalid node type. Must be one of: {', '.join(VALID_NODE_TYPES)}"}), 400

    if data.get("is_start"):
        Node.query.filter_by(flow_version_id=version_id, is_start=True).update({"is_start": False})

    node = Node(
        flow_version_id=version_id,
        type=node_type,
        title=data["title"].strip(),
        body=(data.get("body") or "").strip() or None,
        position_x=data.get("position", {}).get("x", 0),
        position_y=data.get("position", {}).get("y", 0),
        node_metadata=data.get("metadata", {}),
        is_start=bool(data.get("is_start", False)),
    )
    db.session.add(node)
    db.session.commit()
    return jsonify(node.to_dict()), 201


@versions_bp.put("/versions/<version_id>/nodes/<node_id>")
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


@versions_bp.delete("/versions/<version_id>/nodes/<node_id>")
def delete_node(version_id, node_id):
    node = Node.query.filter_by(id=node_id, flow_version_id=version_id).first_or_404()
    Edge.query.filter(
        or_(Edge.source_node_id == node_id, Edge.target_node_id == node_id)
    ).delete(synchronize_session=False)
    db.session.delete(node)
    db.session.commit()
    return jsonify({"deleted": True})


@versions_bp.put("/versions/<version_id>/nodes/bulk-position")
def bulk_update_positions(version_id):
    FlowVersion.query.get_or_404(version_id)
    positions = (request.get_json(silent=True) or {}).get("positions", [])
    updated = 0
    for p in positions:
        node = Node.query.filter_by(id=p.get("id"), flow_version_id=version_id).first()
        if node:
            node.position_x = p.get("x", node.position_x)
            node.position_y = p.get("y", node.position_y)
            updated += 1
    db.session.commit()
    return jsonify({"updated": updated})


# ── Edges ─────────────────────────────────────────────────────

@versions_bp.post("/versions/<version_id>/edges")
def create_edge(version_id):
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    if err := validate_required(data, "source", "target"):
        return err
    if data["source"] == data["target"]:
        return jsonify({"error": "Source and target nodes cannot be the same"}), 400

    condition_label = data.get("condition_label", "").strip()
    if Edge.query.filter_by(
        flow_version_id=version_id,
        source_node_id=data["source"],
        target_node_id=data["target"],
        condition_label=condition_label,
    ).first():
        return jsonify({"error": "An identical connection already exists"}), 409

    edge = Edge(
        flow_version_id=version_id,
        source_node_id=data["source"],
        target_node_id=data["target"],
        condition_label=condition_label,
        sort_order=data.get("sort_order", 0),
    )
    db.session.add(edge)
    db.session.commit()
    return jsonify(edge.to_dict()), 201


@versions_bp.put("/versions/<version_id>/edges/<edge_id>")
def update_edge(version_id, edge_id):
    edge = Edge.query.filter_by(id=edge_id, flow_version_id=version_id).first_or_404()
    data = request.get_json(silent=True) or {}
    if "condition_label" in data:
        edge.condition_label = data["condition_label"].strip()
    if "sort_order" in data:
        edge.sort_order = data["sort_order"]
    db.session.commit()
    return jsonify(edge.to_dict())


@versions_bp.delete("/versions/<version_id>/edges/<edge_id>")
def delete_edge(version_id, edge_id):
    edge = Edge.query.filter_by(id=edge_id, flow_version_id=version_id).first_or_404()
    db.session.delete(edge)
    db.session.commit()
    return jsonify({"deleted": True})


# ── Batch Import ──────────────────────────────────────────────

@versions_bp.post("/versions/<version_id>/import")
def batch_import(version_id):
    """
    Atomically replace all nodes and edges for a version in one transaction.
    Used by the AI flow generator and Visio importer to save complete flows
    without risk of partial saves on failure.
    """
    FlowVersion.query.get_or_404(version_id)
    data = request.get_json(silent=True) or {}
    incoming_nodes = data.get("nodes", [])
    incoming_edges = data.get("edges", [])

    if not incoming_nodes:
        return jsonify({"error": "No nodes provided"}), 400

    try:
        # Wipe existing content for this version
        Edge.query.filter_by(flow_version_id=version_id).delete()
        Node.query.filter_by(flow_version_id=version_id).delete()

        # Create nodes, mapping temp IDs → real DB IDs
        id_map = {}
        created_nodes = []
        for i, n in enumerate(incoming_nodes):
            node_type = n.get("type", "question")
            if node_type not in VALID_NODE_TYPES:
                node_type = "question"
            node = Node(
                flow_version_id=version_id,
                type=node_type,
                title=(n.get("title") or "").strip() or "Untitled step",
                body=(n.get("body") or "").strip() or None,
                position_x=float(n.get("position", {}).get("x") or 0),
                position_y=float(n.get("position", {}).get("y") or 0),
                node_metadata=n.get("metadata") or {},
                is_start=bool(n.get("is_start", False)),
            )
            db.session.add(node)
            db.session.flush()
            temp_id = str(n.get("tempId") or n.get("id") or i)
            id_map[temp_id] = node.id
            created_nodes.append(node)

        # Enforce exactly one start node
        start_nodes = [n for n in created_nodes if n.is_start]
        if not start_nodes:
            created_nodes[0].is_start = True
        elif len(start_nodes) > 1:
            for n in start_nodes[1:]:
                n.is_start = False

        # Create edges, skipping any with unresolvable node refs
        created_edges = []
        skipped_edges = []
        seen = set()
        for e in incoming_edges:
            src_id = id_map.get(str(e.get("sourceId") or e.get("source") or ""))
            tgt_id = id_map.get(str(e.get("targetId") or e.get("target") or ""))
            label = (e.get("label") or e.get("condition_label") or "").strip()

            if not src_id or not tgt_id:
                skipped_edges.append(f"Unknown node ref: {e.get('sourceId')} -> {e.get('targetId')}")
                continue
            if src_id == tgt_id:
                continue
            key = (src_id, tgt_id, label)
            if key in seen:
                continue
            seen.add(key)

            edge = Edge(
                flow_version_id=version_id,
                source_node_id=src_id,
                target_node_id=tgt_id,
                condition_label=label,
                sort_order=int(e.get("sort_order") or 0),
            )
            db.session.add(edge)
            created_edges.append(edge)

        db.session.commit()
        audit("version.batch_import", "flow_version", version_id, {
            "node_count": len(created_nodes),
            "edge_count": len(created_edges),
        })
        return jsonify({
            "nodes": [n.to_dict() for n in created_nodes],
            "edges": [e.to_dict() for e in created_edges],
            "skipped_edges": skipped_edges,
        })

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Import failed: {str(exc)}"}), 500