import re
import json
from flask import Blueprint, request, jsonify, current_app
from routes import audit

try:
    from google import genai as _genai
    from google.genai import types as _genai_types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

try:
    from groq import Groq as _Groq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

ai_bp = Blueprint("ai", __name__, url_prefix="/api/v1/flows")

# ── Prompts ────────────────────────────────────────────────────

REWRITE_PROMPT = """You are a support flow description rewriter.

The user has described a support process — it may be written as bullet points, a numbered list, rough notes, or a paragraph. Your job is to rewrite it as a clear, branching narrative that an AI flow generator can turn into a decision tree.

Rules:
- Use "if/then" language throughout
- Every step must have an explicit outcome for BOTH success (yes/resolved) AND failure (no/escalate)
- State who to escalate to and what information to include in every escalation path
- Do not add new steps or invent information — only rewrite what the user provided
- Write in plain prose — no bullet points, no numbered lists, no markdown
- Be explicit: avoid vague phrases like "handle normally" or "follow standard process"
- If the user's input implies a check or action, make it explicit in the rewrite

Return ONLY the rewritten description as plain text. No explanation. No preamble."""

TEXT_TO_FLOW_PROMPT = """You are an expert support flow architect. Convert a natural language description into a comprehensive, detailed decision/resolution flow for support agents.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "nodes": [
    {
      "id": "0",
      "title": "Short question or step title",
      "type": "question",
      "body": "Detailed context giving the agent full instructions on what to check, ask, or do at this step. Include specific actions, what to look for, and why this step matters.",
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

Node rules:
- "question": any step where the agent asks, checks, investigates, or takes an action
- "result": final outcomes only — resolutions, escalations, closures. Must include full resolution steps in "body"
- Exactly ONE node must have "is_start": true
- EVERY branch must end at a "result" node — no dead ends allowed
- Every possible outcome from the description must be represented, including edge cases, partial failures, and escalation paths

Body rules (IMPORTANT):
- "question" nodes: write 2-4 sentences. Explain exactly what the agent should ask or do, what to look for, and what constitutes a yes vs no answer. Give the agent enough context to act without referring back to the description.
- "result" nodes: write full step-by-step resolution instructions the agent should follow or communicate to the customer. Be specific — include what to tell the customer, what to log in the system, and any follow-up actions required.
- Do NOT use vague language like "handle the issue", "resolve normally", or "follow standard process" — be fully explicit at every step.

Position rules:
- Start node at x=60, y=60
- Space nodes 320px apart horizontally, 200px apart vertically
- Branch left for "yes/resolved", right for "no/escalate", downward for linear follow-up steps

Edge rules:
- source and target are STRING node ids
- Labels must clearly describe the condition: "yes", "no", "all devices", "one device", "lights normal", "lights error", "resolved", "not resolved", "escalate", etc.
- Every "question" node MUST have at least one outgoing edge — no orphan nodes
- Capture ALL branching paths described — do not collapse or skip branches

Quality rules:
- Titles: short and scannable, under 60 chars
- Aim for 10-20 nodes — be thorough, explore every branch in the description
- Do not merge separate branches into one node just to save space
- If the description implies a step (e.g. "check the outage dashboard"), create an explicit node for it
- Escalation paths must specify who to escalate to and what information to include in the handoff

Return ONLY the JSON object. No markdown fences. No explanation."""


# ── JSON parser ────────────────────────────────────────────────

def _parse_ai_json(raw_text):
    if not raw_text:
        return None

    text = raw_text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```\s*$', '', text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    brace_start = text.find('{')
    brace_end = text.rfind('}')
    if brace_start != -1 and brace_end > brace_start:
        candidate = text[brace_start:brace_end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass
        fixed2 = re.sub(r"(?<![\\])'", '"', fixed)
        try:
            return json.loads(fixed2)
        except json.JSONDecodeError:
            pass

    if brace_start != -1:
        candidate = text[brace_start:]
        depth_curly = depth_square = 0
        in_string = escape_next = False
        last_complete_node_end = -1

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
            elif ch == '{':
                depth_curly += 1
            elif ch == '}':
                depth_curly -= 1
                if depth_curly >= 1 and depth_square == 1:
                    last_complete_node_end = i
            elif ch == '[':
                depth_square += 1
            elif ch == ']':
                depth_square -= 1

        attempts = [
            candidate + (']' * max(0, depth_square)) + ('}' * max(0, depth_curly)),
        ]
        if last_complete_node_end > 0:
            rewound = candidate[:last_complete_node_end + 1].rstrip().rstrip(',')
            attempts.append(rewound + "]}")

        for attempt in attempts:
            attempt = re.sub(r',\s*([}\]])', r'\1', attempt)
            try:
                result = json.loads(attempt)
                if isinstance(result, dict) and result.get("nodes"):
                    return result
            except json.JSONDecodeError:
                pass

    return None


def _is_truncated(response):
    try:
        reason = str(response.candidates[0].finish_reason)
        return "MAX_TOKENS" in reason or reason == "2"
    except Exception:
        return False


def _node_count_seems_low(parsed, description):
    node_count = len((parsed or {}).get("nodes") or [])
    return len(description.split()) > 60 and node_count < 5


def _normalize_nodes_and_edges(nodes, edges):
    warnings = []

    for i, node in enumerate(nodes):
        raw_id = node.get("id")
        node["id"] = str(raw_id) if raw_id is not None else str(i)
        node.setdefault("title", f"Step {i + 1}")
        node["type"] = "result" if node.get("type") == "result" else "question"
        node.setdefault("body", "")
        node.setdefault("resolution", "")
        node.setdefault("is_start", False)
        node.setdefault("position", {"x": (i % 4) * 300 + 60, "y": (i // 4) * 180 + 60})
        pos = node["position"]
        if not isinstance(pos.get("x"), (int, float)):
            pos["x"] = (i % 4) * 300 + 60
        if not isinstance(pos.get("y"), (int, float)):
            pos["y"] = (i // 4) * 180 + 60

    start_nodes = [n for n in nodes if n.get("is_start")]
    if not start_nodes and nodes:
        nodes[0]["is_start"] = True
        warnings.append("Could not determine start node — defaulted to first node.")
    elif len(start_nodes) > 1:
        for n in start_nodes[1:]:
            n["is_start"] = False
        warnings.append("Multiple start nodes detected — kept only the first.")

    node_ids = {n["id"] for n in nodes}
    valid_edges = []
    for edge in edges:
        src = str(edge.get("source")) if edge.get("source") is not None else None
        tgt = str(edge.get("target")) if edge.get("target") is not None else None
        edge["source"] = src
        edge["target"] = tgt
        edge.setdefault("label", "")
        if src in node_ids and tgt in node_ids:
            valid_edges.append(edge)
        else:
            warnings.append(f"Skipped edge {src} -> {tgt}: unknown node ID.")

    edge_sources = {e["source"] for e in valid_edges}
    for node in nodes:
        if node["type"] == "question" and node["id"] not in edge_sources:
            warnings.append(
                f"Question node '{node['title']}' has no outgoing connections — it may be a dead end."
            )

    return nodes, valid_edges, warnings


# ── Preprocessing: rewrite any input into a branching narrative ────────────────

def _rewrite_description_gemini(description, app_config, logger):
    """Use Gemini to rewrite the user's input into a branching narrative."""
    api_key = app_config.get("GEMINI_API_KEY")
    model = app_config.get("GEMINI_MODEL", "gemini-2.0-flash").replace("models/", "")
    client = _genai.Client(api_key=api_key)

    try:
        response = client.models.generate_content(
            model=model,
            contents=(
                "Rewrite this support process description into a clear branching narrative:\n\n"
                + description
            ),
            config=_genai_types.GenerateContentConfig(
                system_instruction=REWRITE_PROMPT,
                temperature=0.1,
                max_output_tokens=2048,
            ),
        )
        rewritten = (response.text or "").strip()
        if rewritten and len(rewritten) > 20:
            logger.info(
                "Gemini rewrite succeeded: %d chars -> %d chars",
                len(description), len(rewritten),
            )
            return rewritten
    except Exception as e:
        logger.warning("Gemini rewrite failed (will use original): %s", e)

    return description


def _rewrite_description_groq(description, app_config, logger):
    """Use Groq to rewrite the user's input into a branching narrative."""
    api_key = app_config.get("GROQ_API_KEY")
    model = app_config.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    client = _Groq(api_key=api_key)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": REWRITE_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "Rewrite this support process description into a clear branching narrative:\n\n"
                        + description
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=2048,
        )
        rewritten = (response.choices[0].message.content or "").strip()
        if rewritten and len(rewritten) > 20:
            logger.info(
                "Groq rewrite succeeded: %d chars -> %d chars",
                len(description), len(rewritten),
            )
            return rewritten
    except Exception as e:
        logger.warning("Groq rewrite failed (will use original): %s", e)

    return description


def _rewrite_description(description, provider, app_config, logger):
    """
    Preprocess the user's raw description into a branching narrative
    before passing it to the flow generator. Skipped if the input
    already looks like a branching narrative. Falls back gracefully.
    """
    looks_like_list = bool(re.search(r'^\s*[\d\-\*\u2022]', description, re.MULTILINE))
    has_branching = any(
        kw in description.lower()
        for kw in ["if ", "then ", "if the", "if it", "when ", "otherwise", "else "]
    )

    # Already a well-formed branching narrative — no rewrite needed
    if has_branching and not looks_like_list:
        logger.info("Description already has branching language — skipping rewrite.")
        return description

    logger.info(
        "Preprocessing description (looks_like_list=%s, has_branching=%s)",
        looks_like_list, has_branching,
    )

    if provider == "groq" and GROQ_AVAILABLE and app_config.get("GROQ_API_KEY"):
        return _rewrite_description_groq(description, app_config, logger)
    elif GEMINI_AVAILABLE and app_config.get("GEMINI_API_KEY"):
        return _rewrite_description_gemini(description, app_config, logger)

    # No provider available — use original as-is
    return description


# ── Provider implementations ───────────────────────────────────

def _generate_with_gemini(description, app_config, logger):
    if not GEMINI_AVAILABLE:
        raise RuntimeError("google-genai not installed. Run: pip install google-genai")
    api_key = app_config.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured. Add it to your .env file.")

    model = app_config.get("GEMINI_MODEL", "gemini-2.0-flash")
    client = _genai.Client(api_key=api_key)
    model_id = model.replace("models/", "")

    def _call(prompt, temperature=0.2):
        return client.models.generate_content(
            model=model_id,
            contents=prompt,
            config=_genai_types.GenerateContentConfig(
                system_instruction=TEXT_TO_FLOW_PROMPT,
                temperature=temperature,
                max_output_tokens=16384,
                response_mime_type="application/json",
            ),
        )

    response = _call(
        f"Convert this flow description into a structured JSON flow:\n\n{description}"
    )
    raw = (response.text or "").strip()
    truncated = _is_truncated(response)
    logger.info(
        "Gemini attempt 1: finish_reason=%s, raw_len=%d",
        response.candidates[0].finish_reason if response.candidates else "?",
        len(raw),
    )

    parsed = _parse_ai_json(raw)

    if truncated or parsed is None or _node_count_seems_low(parsed, description):
        logger.warning(
            "Gemini attempt 1 insufficient (truncated=%s, nodes=%d). Retrying.",
            truncated, len((parsed or {}).get("nodes") or []),
        )
        response2 = _call(
            f"Convert this into a CONCISE JSON flow (max 12 nodes). "
            f"Include all decision branches even if simplified.\n\n{description}",
            temperature=0,
        )
        raw2 = (response2.text or "").strip()
        parsed2 = _parse_ai_json(raw2)
        if parsed2 and len((parsed2.get("nodes") or [])) > len((parsed or {}).get("nodes") or []):
            parsed = parsed2

    return parsed, model_id


def _generate_with_groq(description, app_config, logger):
    if not GROQ_AVAILABLE:
        raise RuntimeError("groq not installed. Run: pip install groq")
    api_key = app_config.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured. Add it to your .env file.")

    model = app_config.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    client = _Groq(api_key=api_key)

    def _call(prompt, temperature=0.2):
        return client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TEXT_TO_FLOW_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=8192,
            response_format={"type": "json_object"},
        )

    response = _call(
        f"Convert this flow description into a structured JSON flow:\n\n{description}"
    )
    raw = (response.choices[0].message.content or "").strip()
    logger.info("Groq attempt 1: model=%s, raw_len=%d", model, len(raw))

    parsed = _parse_ai_json(raw)

    if parsed is None or _node_count_seems_low(parsed, description):
        logger.warning(
            "Groq attempt 1 insufficient (nodes=%d). Retrying.",
            len((parsed or {}).get("nodes") or []),
        )
        response2 = _call(
            f"Convert this into a CONCISE JSON flow (max 12 nodes). "
            f"Include all decision branches even if simplified.\n\n{description}",
            temperature=0,
        )
        raw2 = (response2.choices[0].message.content or "").strip()
        parsed2 = _parse_ai_json(raw2)
        if parsed2 and len((parsed2.get("nodes") or [])) > len((parsed or {}).get("nodes") or []):
            parsed = parsed2

    return parsed, model


# ── Flow suggestion prompt & helpers ──────────────────────────

SUGGEST_PROMPT = """You are a support flow matching engine. Given a customer issue description and a list of published support flows, identify the best matching flow(s).

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "no_match": false,
  "top_match": {
    "flow_id": "<exact flow_id from the flows list>",
    "flow_name": "<exact flow_name from the flows list>",
    "active_version_id": "<exact active_version_id from the flows list>",
    "confidence": 0.92,
    "reasoning": "One or two sentences explaining specifically why this flow is the best match for this issue."
  },
  "alternatives": [
    {
      "flow_id": "<exact flow_id>",
      "flow_name": "<exact flow_name>",
      "active_version_id": "<exact active_version_id>",
      "confidence": 0.65,
      "reasoning": "Brief specific reason this flow could also apply."
    }
  ]
}

Rules:
- confidence is a float between 0.0 and 1.0 representing how well the flow matches the issue
- Set no_match to true and top_match to null if no flow has a confidence >= 0.40
- alternatives should contain up to 2 other relevant flows with confidence >= 0.30, excluding the top_match
- If no alternatives exist, return "alternatives": []
- ONLY use flow_id and active_version_id values that appear EXACTLY in the provided flows list — never invent or modify IDs
- reasoning must be specific to the issue — never use generic phrases like "this flow handles this type of issue"
- Consider flow name, description, category, and tags when scoring relevance
- Return ONLY the JSON object. No markdown fences. No preamble. No explanation."""


def _suggest_with_groq(issue, flows_context, app_config, logger):
    """Use Groq to match an issue against published flows and return ranked suggestions."""
    if not GROQ_AVAILABLE:
        raise RuntimeError("groq not installed. Run: pip install groq")
    api_key = app_config.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured. Add it to your .env file.")

    model = app_config.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    client = _Groq(api_key=api_key)

    prompt = (
        f"Customer issue:\n{issue}\n\n"
        f"Available published flows:\n{flows_context}\n\n"
        "Return the best matching flow(s) as a JSON object following the specified format."
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SUGGEST_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=1024,
        response_format={"type": "json_object"},
    )
    raw = (response.choices[0].message.content or "").strip()
    logger.info("Groq suggest: model=%s, raw_len=%d", model, len(raw))
    parsed = _parse_ai_json(raw)
    return parsed, model


def _suggest_with_gemini(issue, flows_context, app_config, logger):
    """Use Gemini to match an issue against published flows and return ranked suggestions."""
    if not GEMINI_AVAILABLE:
        raise RuntimeError("google-genai not installed. Run: pip install google-genai")
    api_key = app_config.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured. Add it to your .env file.")

    model = app_config.get("GEMINI_MODEL", "gemini-2.0-flash").replace("models/", "")
    client = _genai.Client(api_key=api_key)

    prompt = (
        f"Customer issue:\n{issue}\n\n"
        f"Available published flows:\n{flows_context}\n\n"
        "Return the best matching flow(s) as a JSON object following the specified format."
    )

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=_genai_types.GenerateContentConfig(
            system_instruction=SUGGEST_PROMPT,
            temperature=0.1,
            max_output_tokens=1024,
            response_mime_type="application/json",
        ),
    )
    raw = (response.text or "").strip()
    logger.info("Gemini suggest: model=%s, raw_len=%d", model, len(raw))
    parsed = _parse_ai_json(raw)
    return parsed, model


# ── Routes ─────────────────────────────────────────────────────

@ai_bp.get("/providers")
def list_providers():
    """Return available AI providers and their configuration status."""
    gemini_key = bool(current_app.config.get("GEMINI_API_KEY"))
    groq_key = bool(current_app.config.get("GROQ_API_KEY"))
    return jsonify({
        "providers": [
            {
                "id": "gemini",
                "name": "Google Gemini",
                "model": current_app.config.get("GEMINI_MODEL", "gemini-2.0-flash"),
                "available": GEMINI_AVAILABLE and gemini_key,
                "installed": GEMINI_AVAILABLE,
                "configured": gemini_key,
            },
            {
                "id": "groq",
                "name": "Groq",
                "model": current_app.config.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
                "available": GROQ_AVAILABLE and groq_key,
                "installed": GROQ_AVAILABLE,
                "configured": groq_key,
            },
        ]
    })


@ai_bp.post("/generate-from-text")
def generate_flow_from_text():
    """Generate a complete flow from a plain-English description using Gemini or Groq."""
    data = request.get_json(silent=True) or {}
    description = (data.get("description") or "").strip()
    provider = (data.get("provider") or "gemini").lower()

    if not description:
        return jsonify({"error": "Missing description"}), 400
    if len(description) < 10:
        return jsonify({"error": "Description too short — please provide more detail."}), 400
    if len(description) > 5000:
        return jsonify({"error": "Description too long — please keep it under 5000 characters."}), 400
    if provider not in ("gemini", "groq"):
        return jsonify({"error": "Invalid provider. Must be 'gemini' or 'groq'."}), 400

    # ── Step 1: Preprocess — normalise any input style into a branching narrative ──
    rewritten = _rewrite_description(
        description, provider, current_app.config, current_app.logger
    )

    # ── Step 2: Generate the structured flow from the cleaned description ─────────
    try:
        if provider == "groq":
            parsed, model_used = _generate_with_groq(
                rewritten, current_app.config, current_app.logger
            )
        else:
            parsed, model_used = _generate_with_gemini(
                rewritten, current_app.config, current_app.logger
            )

    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        err = str(exc).lower()
        current_app.logger.error("%s error: %s", provider, exc)
        if "api_key" in err or "api key" in err or "invalid_api_key" in err:
            return jsonify({"error": f"Invalid {provider} API key: {exc}"}), 503
        if "not_found" in err or "not found" in err or "does_not_exist" in err:
            return jsonify({"error": f"Model not available for {provider}: {exc}"}), 503
        if "quota" in err or "resource_exhausted" in err or "rate_limit" in err or "429" in err:
            return jsonify({"error": f"Rate limit reached for {provider}. Please wait a moment and try again."}), 429
        return jsonify({"error": f"{provider.capitalize()} error: {exc}"}), 500

    if parsed is None:
        return jsonify({
            "error": "AI returned malformed JSON. Please try again or rephrase your description."
        }), 500

    nodes = parsed.get("nodes", [])
    if not isinstance(nodes, list) or not nodes:
        return jsonify({
            "error": "AI could not generate a flow from that description. Try being more specific."
        }), 422

    nodes, valid_edges, warnings = _normalize_nodes_and_edges(nodes, parsed.get("edges", []))
    warnings = (parsed.get("suggestions") or []) + warnings

    audit("flow.generate_from_text", payload={
        "provider": provider,
        "description_length": len(description),
        "rewritten_length": len(rewritten),
        "node_count": len(nodes),
        "edge_count": len(valid_edges),
    })

    return jsonify({
        "nodes": nodes,
        "edges": valid_edges,
        "suggestions": warnings,
        # Expose the rewritten description so the frontend can optionally show it
        "rewritten_description": rewritten if rewritten != description else None,
        "meta": {"model": model_used, "provider": provider},
    })