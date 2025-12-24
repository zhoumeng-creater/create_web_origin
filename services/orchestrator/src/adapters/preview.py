from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    AdapterResult,
    BaseAdapter,
    ProgressReporter,
    build_asset_ref,
    build_error,
)
from ..scheduler.store import JOB_STORE
from ..uir.validate import validate_uir


class PreviewConfigBuilder(BaseAdapter):
    provider_id = "web_threejs"
    modality = "preview"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        warnings: List[str] = []
        try:
            job_id = _job_id_from_uir(uir)
        except ValueError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error("E_VALIDATION_INPUT", str(exc), retryable=False),
            )
        output_dir = self.output_dir(out_dir)
        reporter.stage("collect", 0.2, "collecting preview inputs")
        artifacts = _load_artifacts(job_id)
        motion_uri = _artifact_uri(_find_artifact(artifacts, "motion_bvh"))
        if not motion_uri:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "missing required artifacts",
                    detail={"missing": ["motion_bvh"]},
                    retryable=False,
                ),
            )
        config, warnings = _build_preview_config(
            uir, out_dir, artifacts, motion_uri, warnings
        )
        config_path = output_dir / "preview_config.json"
        try:
            config_path.write_text(
                json.dumps(config, ensure_ascii=True, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write preview_config.json",
                    detail={"path": str(config_path), "error": str(exc)},
                    retryable=True,
                ),
            )
        reporter.stage("finalize", 1.0, "preview config ready")
        artifact = build_asset_ref(
            config_path, job_id, "preview_config", "application/json"
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"dummy": False},
            "warnings": warnings,
            "error": None,
        }


def _build_preview_config(
    uir: Dict[str, Any],
    job_dir: Path,
    artifacts: List[Dict[str, Any]],
    motion_uri: str,
    warnings: List[str],
) -> Tuple[Dict[str, Any], List[str]]:
    scene = _scene_config(artifacts, warnings)
    motion = _motion_config(uir, job_dir, artifacts, motion_uri)
    music = _music_config(artifacts, warnings)
    character = _character_config(uir, job_dir, artifacts, warnings)
    camera, timeline = _preview_settings(uir)
    config: Dict[str, Any] = {
        "scene": scene,
        "character": character,
        "motion": motion,
        "music": music,
        "camera": camera,
        "timeline": timeline,
    }
    return config, warnings


def _scene_config(
    artifacts: List[Dict[str, Any]], warnings: List[str]
) -> Dict[str, Any]:
    artifact = _find_artifact(artifacts, "scene_panorama")
    uri = _artifact_uri(artifact)
    if uri:
        return {"panorama_uri": uri}
    warnings.append("scene_panorama missing; using default background")
    return {}


def _motion_config(
    uir: Dict[str, Any],
    job_dir: Path,
    artifacts: List[Dict[str, Any]],
    motion_uri: str,
) -> Dict[str, Any]:
    fps = _motion_fps(uir, job_dir, artifacts)
    payload: Dict[str, Any] = {"bvh_uri": motion_uri}
    if fps is not None:
        payload["fps"] = fps
    return payload


def _music_config(
    artifacts: List[Dict[str, Any]], warnings: List[str]
) -> Dict[str, Any]:
    artifact = _find_artifact(artifacts, "music_wav")
    uri = _artifact_uri(artifact)
    if not uri:
        warnings.append("music_wav missing; preview will be silent")
        return {"offset_s": 0}
    return {"wav_uri": uri, "offset_s": 0}


def _character_config(
    uir: Dict[str, Any],
    job_dir: Path,
    artifacts: List[Dict[str, Any]],
    warnings: List[str],
) -> Dict[str, Any]:
    manifest_artifact = _find_artifact(artifacts, "character_manifest")
    if manifest_artifact:
        manifest_path = job_dir / "character" / "character_manifest.json"
        data = _read_json(manifest_path)
        if isinstance(data, dict):
            payload: Dict[str, Any] = {}
            model_uri = data.get("model_uri")
            skeleton = data.get("skeleton")
            if isinstance(model_uri, str) and model_uri:
                payload["model_uri"] = model_uri
            if isinstance(skeleton, str) and skeleton:
                payload["skeleton"] = skeleton
            if payload:
                return payload
        warnings.append("character_manifest invalid; using default rig")
    else:
        warnings.append("character_manifest missing; using default rig")
    character_id = _character_id_from_uir(uir)
    if character_id:
        return {
            "model_uri": f"/static/characters/{character_id}.glb",
            "skeleton": "SMPL_22",
        }
    return {"skeleton": "SMPL_22"}


def _preview_settings(uir: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    preview = _module_section(uir, "preview")
    camera_preset = _string_value(preview.get("camera_preset")) or "orbit"
    autoplay = preview.get("autoplay")
    if autoplay is None:
        autoplay = True
    camera = {"preset": camera_preset, "auto_rotate": bool(autoplay)}
    timeline: Dict[str, Any] = {}
    preview_timeline = preview.get("timeline")
    if isinstance(preview_timeline, dict):
        timeline.update(preview_timeline)
    duration = _duration_from_uir(uir)
    if duration is not None and "duration_s" not in timeline:
        timeline["duration_s"] = duration
    return camera, timeline


def _motion_fps(
    uir: Dict[str, Any], job_dir: Path, artifacts: List[Dict[str, Any]]
) -> Optional[int]:
    meta_artifact = _find_artifact(artifacts, "motion_meta")
    if meta_artifact:
        meta_path = job_dir / "motion" / "motion_meta.json"
        data = _read_json(meta_path)
        if isinstance(data, dict):
            value = data.get("fps")
            if isinstance(value, (int, float)):
                return int(value)
    motion = _module_section(uir, "motion")
    value = motion.get("fps")
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _duration_from_uir(uir: Dict[str, Any]) -> Optional[float]:
    motion = _module_section(uir, "motion")
    value = motion.get("duration_s")
    if value is None:
        intent = uir.get("intent")
        if isinstance(intent, dict):
            value = intent.get("duration_s")
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _module_section(uir: Dict[str, Any], name: str) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        section = modules.get(name)
        if isinstance(section, dict):
            return section
    return {}


def _string_value(value: Any) -> Optional[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return None


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict):
        return data
    return None


def _load_artifacts(job_id: str) -> List[Dict[str, Any]]:
    job = JOB_STORE.get_job(job_id)
    if not job:
        return []
    if not isinstance(job.assets, dict):
        return []
    stored = job.assets.get("artifacts")
    if not isinstance(stored, list):
        return []
    return [item for item in stored if isinstance(item, dict)]


def _find_artifact(
    artifacts: List[Dict[str, Any]], role: str
) -> Optional[Dict[str, Any]]:
    for artifact in artifacts:
        value = artifact.get("role")
        if isinstance(value, str) and value == role:
            return artifact
    return None


def _artifact_uri(artifact: Optional[Dict[str, Any]]) -> str:
    if not isinstance(artifact, dict):
        return ""
    uri = artifact.get("uri")
    if isinstance(uri, str) and uri:
        return uri
    return ""


def _error_result(
    provider: str, warnings: List[str], error: Dict[str, Any]
) -> AdapterResult:
    return {
        "ok": False,
        "provider": provider,
        "artifacts": [],
        "meta": {},
        "warnings": warnings,
        "error": error,
    }


def _job_id_from_uir(uir: Dict[str, Any]) -> str:
    job = uir.get("job")
    if isinstance(job, dict):
        job_id = job.get("id")
        if job_id:
            return str(job_id)
    raise ValueError("missing job.id")


def _character_id_from_uir(uir: Dict[str, Any]) -> Optional[str]:
    character = _module_section(uir, "character")
    value = character.get("character_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
