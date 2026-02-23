import time
from flask import Flask, g, jsonify
from sqlalchemy import text

from config import Config
from extensions import db, cors
from models import (  # noqa: F401 — imported to register models with SQLAlchemy
    Flow, FlowVersion, Node, Edge, Session, SessionStep, AuditLog
)
from routes.flows import flows_bp
from routes.versions import versions_bp
from routes.sessions import sessions_bp
from routes.analytics import analytics_bp
from routes.ai import ai_bp


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)

    # Extensions
    db.init_app(app)
    cors.init_app(app, expose_headers=["X-Total-Count", "X-Request-Time", "X-API-Version"])

    # Blueprints
    app.register_blueprint(flows_bp)
    app.register_blueprint(versions_bp)
    app.register_blueprint(sessions_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(ai_bp)

    # Request timing headers
    @app.before_request
    def start_timer():
        g.start_time = time.time()

    @app.after_request
    def add_headers(response):
        if hasattr(g, "start_time"):
            elapsed = round((time.time() - g.start_time) * 1000, 2)
            response.headers["X-Request-Time"] = f"{elapsed}ms"
        response.headers["X-API-Version"] = config.API_VERSION
        return response

    # Error handlers
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Resource not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Internal server error"}), 500

    # Health check
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
            "version": config.API_VERSION,
        })

    return app


app = create_app()

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)