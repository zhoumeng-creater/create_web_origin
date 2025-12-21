from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config.runtime import get_runtime_paths
from .job_fs import ensure_job_dirs

_DEFAULT_OUTPUTS: Dict[str, Any] = {
    "scene": {"panorama": None},
    "motion": {"bvh": None},
    "music": {"wav": None},
    "preview": {"config": None},
    "export": {"zip": None, "mp4": None},
}

_ROLE_OUTPUT_MAP = {
    "scene_panorama": "scene.panorama",
    "scene_cubemap_faces": "scene.cubemap",
    "scene_depth": "scene.depth",
    "scene_meta": "scene.meta",
    "motion_bvh": "motion.bvh",
    "motion_meta": "motion.meta",
    "music_wav": "music.wav",
    "music_meta": "music.meta",
    "preview_config": "preview.config",
    "export_zip": "export.zip",
    "export_mp4": "export.mp4",
    "character_manifest": "character.manifest",
    "character_model_glb": "character.model",
}


def make_asset_url(job_id: str, *parts: str) -> str:
    safe_parts: List[str] = []
    for part in parts:
        if not part:
            continue
        if isinstance(part, Path):
            part = part.as_posix()
        part = str(part).replace("\\", "/").strip("/")
        if part:
            safe_parts.append(part)
    suffix = "/".join(safe_parts)
    if suffix:
        return f"/assets/{job_id}/{suffix}"
    return f"/assets/{job_id}"


def ensure_job_dir(job_id: str) -> Path:
    runtime_paths = get_runtime_paths()
    return ensure_job_dirs(runtime_paths.assets_dir, job_id)


def _manifest_path(job_id: str) -> Path:
    runtime_paths = get_runtime_paths()
    return runtime_paths.assets_dir / job_id / "manifest.json"


def _default_outputs() -> Dict[str, Any]:
    return copy.deepcopy(_DEFAULT_OUTPUTS)


def _manifest_inputs(uir: Any) -> Dict[str, Any]:
    if not isinstance(uir, dict):
        return {}
    inputs: Dict[str, Any] = {}
    input_section = uir.get("input") or uir.get("inputs")
    if isinstance(input_section, dict):
        inputs.update(input_section)
    intent_section = uir.get("intent")
    if isinstance(intent_section, dict):
        inputs.update(intent_section)
    if not inputs:
        inputs = dict(uir)
    return inputs


def _created_at(uir: Any) -> str:
    if isinstance(uir, dict):
        job_section = uir.get("job")
        if isinstance(job_section, dict):
            created_at = job_section.get("created_at")
            if isinstance(created_at, datetime):
                return created_at.astimezone(timezone.utc).isoformat()
            if isinstance(created_at, str):
                return created_at
    return datetime.now(timezone.utc).isoformat()


def _artifact_output_key(artifact: Dict[str, Any]) -> Optional[str]:
    output_key = artifact.get("output") or artifact.get("output_key")
    if isinstance(output_key, str) and output_key:
        return output_key
    role = artifact.get("role")
    if isinstance(role, str) and role:
        return _ROLE_OUTPUT_MAP.get(role)
    return None


def _artifact_payload(artifact: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    uri = artifact.get("uri")
    if not uri:
        return None
    payload: Dict[str, Any] = {"uri": uri}
    for key in ("mime", "id", "sha256", "bytes", "meta"):
        value = artifact.get(key)
        if value is not None:
            payload[key] = value
    return payload


def _assign_output(outputs: Dict[str, Any], output_key: str, payload: Dict[str, Any]) -> None:
    cursor: Dict[str, Any] = outputs
    parts = output_key.split(".")
    for part in parts[:-1]:
        bucket = cursor.get(part)
        if not isinstance(bucket, dict):
            bucket = {}
            cursor[part] = bucket
        cursor = bucket
    cursor[parts[-1]] = payload


def _apply_artifacts(outputs: Dict[str, Any], artifacts: Any) -> None:
    if not isinstance(artifacts, list):
        return
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        output_key = _artifact_output_key(artifact)
        if not output_key:
            continue
        payload = _artifact_payload(artifact)
        if not payload:
            continue
        _assign_output(outputs, output_key, payload)


def _apply_uir_output_meta(outputs: Dict[str, Any], uir: Any) -> None:
    if not isinstance(uir, dict):
        return
    intent = uir.get("intent")
    if not isinstance(intent, dict):
        intent = {}
    modules = uir.get("modules")
    if not isinstance(modules, dict):
        modules = {}
    motion = modules.get("motion")
    if not isinstance(motion, dict):
        motion = {}
    music = modules.get("music")
    if not isinstance(music, dict):
        music = {}
    motion_bucket = outputs.get("motion")
    if isinstance(motion_bucket, dict):
        fps = motion.get("fps")
        if fps is not None and "fps" not in motion_bucket:
            motion_bucket["fps"] = fps
    duration = motion.get("duration_s")
    if duration is None:
        duration = intent.get("duration_s")
    if duration is not None:
        if isinstance(motion_bucket, dict) and "duration_s" not in motion_bucket:
            motion_bucket["duration_s"] = duration
        music_bucket = outputs.get("music")
        if isinstance(music_bucket, dict) and "duration_s" not in music_bucket:
            music_bucket["duration_s"] = duration
    music_duration = music.get("duration_s")
    if music_duration is not None:
        music_bucket = outputs.get("music")
        if isinstance(music_bucket, dict):
            music_bucket["duration_s"] = music_duration


def write_manifest(
    job_dir: Path,
    uir: Dict[str, Any],
    status: str,
    artifacts: List[Dict[str, Any]],
    errors: List[Dict[str, Any]],
) -> Dict[str, Any]:
    job_dir = Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    outputs = _default_outputs()
    _apply_artifacts(outputs, artifacts)
    _apply_uir_output_meta(outputs, uir)
    job_id = job_dir.name
    if not job_id and isinstance(uir, dict):
        job_section = uir.get("job")
        if isinstance(job_section, dict):
            job_id = str(job_section.get("id", ""))
    uir_version = "1.0"
    if isinstance(uir, dict) and uir.get("uir_version"):
        uir_version = str(uir.get("uir_version"))
    manifest = {
        "job_id": job_id,
        "uir_version": uir_version,
        "created_at": _created_at(uir),
        "status": str(status),
        "inputs": _manifest_inputs(uir),
        "outputs": outputs,
        "errors": list(errors or []),
    }
    manifest_path = job_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=True, indent=2, sort_keys=True)
    return manifest


def read_manifest(job_id: str) -> Dict[str, Any]:
    manifest_path = _manifest_path(job_id)
    if not manifest_path.exists():
        return {}
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
