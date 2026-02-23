from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from extensions import db
from models import Flow, FlowVersion, Node, Session, AuditLog
from routes import paginate_query

analytics_bp = Blueprint("analytics", __name__, url_prefix="/api/v1")


@analytics_bp.get("/analytics/overview")
def analytics_overview():
    total_flows = Flow.query.filter_by(is_archived=False).count()
    live_flows = Flow.query.filter(
        Flow.is_archived == False, Flow.active_version_id.isnot(None)
    ).count()
    total_sessions = Session.query.count()
    completed_sessions = Session.query.filter_by(status="completed").count()
    escalated = Session.query.filter_by(resolution_type="escalated").count()

    avg_duration = db.session.query(func.avg(Session.duration_seconds)).filter(
        Session.status == "completed", Session.duration_seconds.isnot(None)
    ).scalar()
    avg_rating = db.session.query(func.avg(Session.feedback_rating)).filter(
        Session.feedback_rating.isnot(None)
    ).scalar()

    cutoff = datetime.utcnow() - timedelta(days=30)
    sessions_over_time = (
        db.session.query(
            func.date(Session.started_at).label("date"),
            func.count(Session.id).label("count"),
        )
        .filter(Session.started_at >= cutoff)
        .group_by(func.date(Session.started_at))
        .order_by(func.date(Session.started_at))
        .all()
    )

    return jsonify({
        "flows": {
            "total": total_flows,
            "live": live_flows,
            "draft": total_flows - live_flows,
        },
        "sessions": {
            "total": total_sessions,
            "completed": completed_sessions,
            "in_progress": total_sessions - completed_sessions,
            "completion_rate": (
                round(completed_sessions / total_sessions * 100, 1) if total_sessions else 0
            ),
            "escalation_rate": (
                round(escalated / completed_sessions * 100, 1) if completed_sessions else 0
            ),
        },
        "performance": {
            "avg_duration_seconds": round(avg_duration) if avg_duration else None,
            "avg_feedback_rating": round(float(avg_rating), 2) if avg_rating else None,
        },
        "sessions_over_time": [
            {"date": str(r.date), "count": r.count} for r in sessions_over_time
        ],
    })


@analytics_bp.get("/analytics/flows/<flow_id>")
def analytics_flow(flow_id):
    Flow.query.get_or_404(flow_id)
    version_ids = [v.id for v in FlowVersion.query.filter_by(flow_id=flow_id).all()]
    sessions = (
        Session.query.filter(Session.flow_version_id.in_(version_ids)).all()
        if version_ids else []
    )
    completed = [s for s in sessions if s.status == "completed"]
    escalated = [s for s in completed if s.resolution_type == "escalated"]

    # Count how often each result node was reached
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

    rated_sessions = [s for s in sessions if s.feedback_rating]

    return jsonify({
        "flow_id": flow_id,
        "sessions": {
            "total": len(sessions),
            "completed": len(completed),
            "in_progress": len(sessions) - len(completed),
            "escalated": len(escalated),
        },
        "avg_duration_seconds": (
            round(
                sum(s.duration_seconds for s in completed if s.duration_seconds)
                / len(completed)
            )
            if completed else None
        ),
        "avg_steps": (
            round(sum(len(s.path_taken or []) for s in completed) / len(completed), 1)
            if completed else None
        ),
        "avg_rating": (
            round(sum(s.feedback_rating for s in rated_sessions) / len(rated_sessions), 2)
            if rated_sessions else None
        ),
        "ratings_breakdown": ratings,
        "top_result_nodes": top_results_enriched,
    })


@analytics_bp.get("/audit-logs")
def list_audit_logs():
    query = AuditLog.query.order_by(AuditLog.created_at.desc())
    if resource_type := request.args.get("resource_type"):
        query = query.filter_by(resource_type=resource_type)
    if resource_id := request.args.get("resource_id"):
        query = query.filter_by(resource_id=resource_id)

    logs, pagination = paginate_query(query, default_limit=100)
    return jsonify({
        "data": [{
            "id": log.id,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "actor_id": log.actor_id,
            "payload": log.payload,
            "created_at": log.created_at.isoformat(),
        } for log in logs],
        "pagination": pagination,
    })