from flask import request, jsonify
from extensions import db
from models import AuditLog


def audit(action, resource_type=None, resource_id=None, payload=None):
    """Write an audit log entry. Committed with the next db.session.commit()."""
    actor = request.headers.get("X-Actor-Id")
    db.session.add(AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        actor_id=actor,
        payload=payload,
    ))


def paginate_query(query, default_limit=50, max_limit=200):
    """Paginate a SQLAlchemy query using ?page= and ?limit= query params."""
    page = max(1, int(request.args.get("page", 1)))
    limit = min(max_limit, max(1, int(request.args.get("limit", default_limit))))
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    return items, {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "has_next": page * limit < total,
        "has_prev": page > 1,
    }


def validate_required(data, *fields):
    """Return a 400 error response if any required fields are missing."""
    missing = [f for f in fields if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400
    return None


VALID_NODE_TYPES = {"question", "result"}