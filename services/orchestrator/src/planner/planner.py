from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_DEFAULT_TARGETS = ("scene", "motion", "music", "preview", "export")


def plan_uir(payload: Dict[str, Any]) -> Dict[str, Any]:
    if _looks_like_uir(payload):
        return payload
    embedded = payload.get("uir")
    if isinstance(embedded, dict):
        return embedded
    prompt = _extract_prompt(payload)
    if not prompt:
        raise ValueError("prompt is required")
    options = payload.get("options")
    if not isinstance(options, dict):
        options = {}
    targets = _coerce_targets(options.get("targets") or payload.get("targets"))
    if not targets:
        targets = list(_DEFAULT_TARGETS)
    duration_s = _coerce_duration(options.get("duration_s") or options.get("duration"))
    if duration_s is None:
        duration_s = 12
    hooks = _merge_hooks(payload.get("hooks"), options.get("hooks"))
    if "event_stream" not in hooks:
        event_stream = options.get("event_stream")
        hooks["event_stream"] = event_stream if isinstance(event_stream, bool) else True
    input_section: Dict[str, Any] = {"raw_prompt": prompt}
    lang = options.get("lang")
    if isinstance(lang, str) and lang:
        input_section["lang"] = lang
    uir: Dict[str, Any] = {
        "uir_version": "1.0",
        "job": {
            "id": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        "input": input_section,
        "intent": {
            "targets": targets,
            "duration_s": duration_s,
        },
        "modules": _build_modules(targets, options),
        "hooks": hooks,
    }
    return uir


def _looks_like_uir(payload: Dict[str, Any]) -> bool:
    return "uir_version" in payload and "job" in payload and "input" in payload


def _extract_prompt(payload: Dict[str, Any]) -> Optional[str]:
    prompt = payload.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        return prompt.strip()
    input_section = payload.get("input")
    if isinstance(input_section, dict):
        raw_prompt = input_section.get("raw_prompt")
        if isinstance(raw_prompt, str) and raw_prompt.strip():
            return raw_prompt.strip()
    return None


def _coerce_targets(value: Any) -> List[str]:
    raw: List[str] = []
    if isinstance(value, list):
        raw = [str(item).strip() for item in value if str(item).strip()]
    elif isinstance(value, str):
        raw = [part.strip() for part in value.split(",") if part.strip()]
    if not raw:
        return []
    deduped: List[str] = []
    seen = set()
    for item in raw:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _coerce_duration(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _merge_hooks(*candidates: Any) -> Dict[str, Any]:
    hooks: Dict[str, Any] = {}
    for entry in candidates:
        if isinstance(entry, dict):
            hooks.update(entry)
    return hooks


def _build_modules(targets: List[str], options: Dict[str, Any]) -> Dict[str, Any]:
    enabled = set(targets)
    modules: Dict[str, Any] = {
        "scene": {"enabled": "scene" in enabled},
        "motion": {"enabled": "motion" in enabled},
        "music": {"enabled": "music" in enabled},
        "preview": {"enabled": "preview" in enabled},
        "export": {"enabled": "export" in enabled},
        "character": {"enabled": "character" in enabled},
    }
    scene_prompt = options.get("scene_prompt")
    if isinstance(scene_prompt, str) and scene_prompt:
        modules["scene"]["prompt"] = scene_prompt
    motion_prompt = options.get("motion_prompt")
    if isinstance(motion_prompt, str) and motion_prompt:
        modules["motion"]["prompt"] = motion_prompt
    music_prompt = options.get("music_prompt")
    if isinstance(music_prompt, str) and music_prompt:
        modules["music"]["prompt"] = music_prompt
    return modules
