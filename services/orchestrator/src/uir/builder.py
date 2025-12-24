from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from .models import KNOWN_MODULES

_DEFAULT_TARGETS = ("scene", "motion", "music", "preview", "export")
_DEFAULT_SCENE_RESOLUTION = (2048, 1024)
_DEFAULT_EXPORT_PRESET = "mp4_1080p"
_DEFAULT_PROVIDERS = {
    "scene": "diffusion360_local",
    "motion": "animationgpt_local",
    "music": "musicgpt_cli",
    "character": "builtin_library",
    "preview": "web_threejs",
    "export": "ffmpeg_export",
}
_EXPORT_PRESET_RESOLUTIONS = {
    "mp4_720p": (1280, 720),
    "mp4_1080p": (1920, 1080),
    "mp4_4k": (3840, 2160),
}


def build_uir_from_prompt(
    prompt: str, options: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt is required")
    options = options if isinstance(options, dict) else {}

    prompt_strategy_requested = _prompt_strategy_requested(options)
    prompt_map, prompt_meta = _resolve_module_prompts(prompt, options)

    duration_s = _coerce_float(options.get("duration_s"))
    style = _coerce_str(options.get("style"))
    mood = _coerce_str(options.get("mood"))
    export_preset_raw = _coerce_str(options.get("export_preset"))

    explicit_targets = _normalize_targets(options.get("targets"))
    targets = explicit_targets or list(_DEFAULT_TARGETS)
    export_enabled = _export_enabled(options, export_preset_raw)
    export_preset = export_preset_raw or (_DEFAULT_EXPORT_PRESET if export_enabled else None)
    preview_enabled = _preview_enabled(options, explicit_targets)
    if preview_enabled and "preview" not in targets:
        targets.append("preview")
    if export_enabled and "export" not in targets:
        targets.append("export")
    targets = _filter_known_targets(targets)
    if not targets:
        targets = list(_DEFAULT_TARGETS)

    advanced = options.get("advanced")
    advanced = advanced if isinstance(advanced, dict) else {}
    scene_resolution = _normalize_panorama_resolution(
        advanced.get("resolution") or options.get("resolution")
    )
    scene_seed = _coerce_int(advanced.get("seed") or options.get("seed"))

    export_format, export_resolution, export_fps, export_bitrate = _export_settings(
        export_preset, options
    )

    modules = _build_modules(
        targets=targets,
        prompts=prompt_map,
        duration_s=duration_s,
        scene_resolution=scene_resolution,
        scene_seed=scene_seed,
        export_enabled=export_enabled,
        export_format=export_format,
        export_resolution=export_resolution,
        export_fps=export_fps,
        export_bitrate=export_bitrate,
        character_id=_coerce_str(options.get("character_id")),
    )

    routing = _build_routing(options, targets)

    intent: Dict[str, Any] = {"targets": targets}
    if duration_s is not None:
        intent["duration_s"] = duration_s
    if style:
        intent["style"] = style
    if mood:
        intent["mood"] = mood

    input_payload: Dict[str, Any] = {"raw_prompt": prompt.strip()}
    lang = _coerce_str(options.get("lang"))
    if lang:
        input_payload["lang"] = lang

    ui_choices = _build_ui_choices(
        options,
        prompt_strategy_requested,
        prompt_meta,
    )
    if ui_choices:
        input_payload["ui_choices"] = ui_choices

    return {
        "uir_version": "1.0",
        "job": {"created_at": _now_iso()},
        "input": input_payload,
        "intent": intent,
        "routing": routing,
        "modules": modules,
    }


def _prompt_strategy_requested(options: Dict[str, Any]) -> str:
    value = options.get("prompt_strategy") or options.get("prompt_mode")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    if options.get("use_llm") is True:
        return "llm"
    return "rule"


def _resolve_module_prompts(
    prompt: str, options: Dict[str, Any]
) -> Tuple[Dict[str, str], Dict[str, Any]]:
    prompt_map = _normalize_prompt_map(options.get("module_prompts") or options.get("prompts"))
    if prompt_map:
        merged = _rule_based_prompts(prompt)
        merged.update(prompt_map)
        return merged, {"strategy_used": "manual"}

    requested = _prompt_strategy_requested(options)
    if requested == "llm":
        llm_prompts, meta = _llm_prompt_split(prompt, options)
        if llm_prompts:
            return llm_prompts, meta
        fallback = _rule_based_prompts(prompt)
        meta.setdefault("strategy_used", "rule")
        return fallback, meta

    return _rule_based_prompts(prompt), {"strategy_used": "rule"}


def _llm_prompt_split(
    prompt: str, options: Dict[str, Any]
) -> Tuple[Optional[Dict[str, str]], Dict[str, Any]]:
    meta = {
        "strategy_requested": "llm",
        "strategy_used": "rule",
        "llm_available": False,
        "note": "LLM prompt splitter not configured; using rule-based prompts.",
    }
    return None, meta


def _rule_based_prompts(prompt: str) -> Dict[str, str]:
    base = prompt.strip()
    return {"scene": base, "motion": base, "music": base}


def _build_modules(
    *,
    targets: List[str],
    prompts: Dict[str, str],
    duration_s: Optional[float],
    scene_resolution: Tuple[int, int],
    scene_seed: Optional[int],
    export_enabled: bool,
    export_format: Optional[str],
    export_resolution: Optional[Tuple[int, int]],
    export_fps: Optional[int],
    export_bitrate: Optional[str],
    character_id: Optional[str],
) -> Dict[str, Any]:
    scene_enabled = "scene" in targets
    motion_enabled = "motion" in targets
    music_enabled = "music" in targets
    character_enabled = "character" in targets or bool(character_id)
    preview_enabled = "preview" in targets

    scene: Dict[str, Any] = {"enabled": scene_enabled}
    if scene_enabled:
        scene["prompt"] = prompts.get("scene", "")
        scene["resolution"] = list(scene_resolution)
        if scene_seed is not None:
            scene["seed"] = scene_seed

    motion: Dict[str, Any] = {"enabled": motion_enabled}
    if motion_enabled:
        motion["prompt"] = prompts.get("motion", "")
        motion["fps"] = 30
        if duration_s is not None:
            motion["duration_s"] = duration_s

    music: Dict[str, Any] = {"enabled": music_enabled}
    if music_enabled:
        music["prompt"] = prompts.get("music", "")
        if duration_s is not None:
            music["duration_s"] = duration_s

    character: Dict[str, Any] = {"enabled": character_enabled}
    if character_enabled and character_id:
        character["character_id"] = character_id

    preview: Dict[str, Any] = {"enabled": preview_enabled}

    export: Dict[str, Any] = {"enabled": bool(export_enabled)}
    if export_enabled:
        if export_format:
            export["format"] = export_format
        if export_resolution:
            export["resolution"] = list(export_resolution)
        if export_fps is not None:
            export["fps"] = export_fps
        if export_bitrate:
            export["bitrate"] = export_bitrate

    return {
        "scene": scene,
        "motion": motion,
        "music": music,
        "character": character,
        "preview": preview,
        "export": export,
    }


def _build_routing(options: Dict[str, Any], targets: List[str]) -> Dict[str, Any]:
    overrides = options.get("routing")
    overrides = overrides if isinstance(overrides, dict) else {}
    routing: Dict[str, Any] = {}
    for name in targets:
        provider = _provider_override(overrides.get(name))
        if not provider:
            provider = _DEFAULT_PROVIDERS.get(name)
        if provider:
            routing[name] = {"provider": provider}
    return routing


def _provider_override(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        provider = value.get("provider")
        if isinstance(provider, str) and provider.strip():
            return provider.strip()
    return None


def _build_ui_choices(
    options: Dict[str, Any],
    prompt_strategy_requested: str,
    prompt_meta: Dict[str, Any],
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    if options:
        payload["options"] = options
    if prompt_strategy_requested:
        payload["prompt_strategy_requested"] = prompt_strategy_requested
    if prompt_meta:
        payload["prompt_strategy_meta"] = prompt_meta
    return payload


def _normalize_prompt_map(value: Any) -> Dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: Dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            continue
        text = _coerce_str(item)
        if text:
            normalized[key.strip().lower()] = text
    return normalized


def _normalize_targets(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    normalized: List[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            normalized.append(item.strip().lower())
    return normalized


def _filter_known_targets(targets: List[str]) -> List[str]:
    known = {name for name in KNOWN_MODULES}
    return [target for target in targets if target in known]


def _export_enabled(options: Dict[str, Any], export_preset: Optional[str]) -> bool:
    value = options.get("export_video")
    if isinstance(value, bool):
        return value
    export = options.get("export")
    if isinstance(export, dict) and isinstance(export.get("enabled"), bool):
        return bool(export.get("enabled"))
    if export_preset:
        return True
    return True


def _preview_enabled(options: Dict[str, Any], explicit_targets: List[str]) -> bool:
    value = options.get("preview_enabled")
    if isinstance(value, bool):
        return value
    value = options.get("preview")
    if isinstance(value, bool):
        return value
    if explicit_targets:
        return "preview" in explicit_targets
    return True


def _export_settings(
    export_preset: Optional[str], options: Dict[str, Any]
) -> Tuple[Optional[str], Optional[Tuple[int, int]], Optional[int], Optional[str]]:
    export = options.get("export")
    export = export if isinstance(export, dict) else {}

    fmt = _coerce_str(export.get("format"))
    preset = export_preset or _coerce_str(export.get("preset"))
    resolution = _resolution_from_preset(preset)
    fps = _coerce_int(export.get("fps"))
    bitrate = _coerce_str(export.get("bitrate"))

    if fmt is None and preset:
        if "zip" in preset:
            fmt = "zip"
        elif preset.startswith("mp4"):
            fmt = "mp4"
    if fmt is None:
        fmt = "mp4"
    if resolution is None and isinstance(export.get("resolution"), (list, tuple)):
        resolution = _coerce_resolution(export.get("resolution"))
    return fmt, resolution, fps, bitrate


def _resolution_from_preset(value: Optional[str]) -> Optional[Tuple[int, int]]:
    if not value:
        return None
    preset = value.strip().lower()
    return _EXPORT_PRESET_RESOLUTIONS.get(preset)


def _normalize_panorama_resolution(value: Any) -> Tuple[int, int]:
    resolution = _coerce_resolution(value)
    if resolution is None:
        return _DEFAULT_SCENE_RESOLUTION
    width, height = resolution
    if width <= 0 or height <= 0:
        return _DEFAULT_SCENE_RESOLUTION
    if width == height * 2:
        return width, height
    option_a = (width, max(1, int(round(width / 2))))
    option_b = (max(1, int(round(height * 2))), height)
    delta_a = abs(option_a[1] - height)
    delta_b = abs(option_b[0] - width)
    if delta_a <= delta_b:
        return option_a
    return option_b


def _coerce_resolution(value: Any) -> Optional[Tuple[int, int]]:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        width = _coerce_int(value[0])
        height = _coerce_int(value[1])
        if width and height:
            return width, height
    if isinstance(value, str):
        cleaned = value.strip().lower().replace("x", ",")
        parts = [part.strip() for part in cleaned.split(",") if part.strip()]
        if len(parts) == 2:
            width = _coerce_int(parts[0])
            height = _coerce_int(parts[1])
            if width and height:
                return width, height
    return None


def _coerce_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return None


def _coerce_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = int(value)
        return num if num >= 0 else None
    if isinstance(value, str):
        try:
            num = int(value.strip())
        except ValueError:
            return None
        return num if num >= 0 else None
    return None


def _coerce_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if num > 0 else None
    if isinstance(value, str):
        try:
            num = float(value.strip())
        except ValueError:
            return None
        return num if num > 0 else None
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
