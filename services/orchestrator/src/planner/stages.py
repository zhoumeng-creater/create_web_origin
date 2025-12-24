from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set

_PLANNING = "PLANNING"
_RUNNING_SCENE = "RUNNING_SCENE"
_RUNNING_MOTION = "RUNNING_MOTION"
_RUNNING_MUSIC = "RUNNING_MUSIC"
_RUNNING_CHARACTER = "RUNNING_CHARACTER"
_COMPOSING_PREVIEW = "COMPOSING_PREVIEW"
_EXPORTING_VIDEO = "EXPORTING_VIDEO"


def plan_stages(uir: Dict[str, Any]) -> List[str]:
    targets = _intent_targets(uir)
    modules = _modules_section(uir)
    stages: List[str] = [_PLANNING]

    if _is_module_selected(modules, targets, "scene"):
        stages.append(_RUNNING_SCENE)
    if _is_module_selected(modules, targets, "motion"):
        stages.append(_RUNNING_MOTION)
    if _is_module_selected(modules, targets, "music"):
        stages.append(_RUNNING_MUSIC)
    if _is_module_selected(modules, targets, "character"):
        stages.append(_RUNNING_CHARACTER)

    if _is_module_selected(modules, targets, "preview"):
        stages.append(_COMPOSING_PREVIEW)

    if _is_module_selected(modules, targets, "export"):
        stages.append(_EXPORTING_VIDEO)

    return stages


def _intent_targets(uir: Dict[str, Any]) -> Set[str]:
    intent = uir.get("intent")
    if not isinstance(intent, dict):
        return set()
    raw_targets = intent.get("targets") or []
    return {str(value).strip().lower() for value in raw_targets if value}


def _modules_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        return modules
    return {}


def _module_enabled(modules: Dict[str, Any], name: str) -> bool:
    entry = modules.get(name)
    if not isinstance(entry, dict):
        return False
    return bool(entry.get("enabled"))


def _is_module_selected(modules: Dict[str, Any], targets: Iterable[str], name: str) -> bool:
    return _module_enabled(modules, name) and name in targets
