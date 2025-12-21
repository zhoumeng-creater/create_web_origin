from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import AdapterResult, BaseAdapter, ProgressReporter, build_asset_ref, build_error
from ..config.runtime import get_runtime_paths
from ..uir.validate import validate_uir

_ROLE_DEFAULTS: Dict[str, Tuple[str, str]] = {
    "scene_panorama": ("scene/panorama.png", "image/png"),
    "motion_bvh": ("motion/motion.bvh", "text/plain"),
    "music_wav": ("music/music.wav", "audio/wav"),
    "character_manifest": ("character/character_manifest.json", "application/json"),
}

_DEFAULT_CHARACTER = {"skeleton": "SMPL_22"}


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
        try:
            self.validate(uir)
        except Exception as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_VALIDATION_INPUT",
                    "validation failed",
                    detail={"error": str(exc)},
                    retryable=False,
                ),
            )

        reporter.stage("preview_config_start", 0.0, "building preview config")
        output_dir: Optional[Path] = None
        try:
            output_dir = self.output_dir(out_dir)
            _assert_dir_writable(output_dir)
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "output directory is not writable",
                    detail={"path": str(output_dir or out_dir), "error": str(exc)},
                    retryable=True,
                ),
            )

        job_root = _find_job_dir(out_dir, job_id) or out_dir
        artifacts = _artifact_list_from_uir(uir)
        manifest_outputs = _manifest_outputs(job_root)

        scene_asset = _resolve_asset(
            "scene_panorama",
            artifacts,
            manifest_outputs,
            job_root,
            job_id,
        )
        motion_asset = _resolve_asset(
            "motion_bvh",
            artifacts,
            manifest_outputs,
            job_root,
            job_id,
        )
        music_asset = _resolve_asset(
            "music_wav",
            artifacts,
            manifest_outputs,
            job_root,
            job_id,
        )
        character_asset = _resolve_asset(
            "character_manifest",
            artifacts,
            manifest_outputs,
            job_root,
            job_id,
        )

        if not motion_asset:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "motion_bvh is required to build preview config",
                    retryable=False,
                ),
            )

        config: Dict[str, Any] = {}
        if scene_asset and scene_asset.get("uri"):
            config["scene"] = {"panorama_uri": scene_asset["uri"]}
        else:
            warnings.append("scene_panorama missing; using default background")

        character_config = _character_config(
            character_asset,
            job_id,
            job_root,
            warnings,
        )
        if character_config:
            config["character"] = character_config

        motion = _motion_section(uir)
        fps = _fps_from_motion(motion)
        if fps is None:
            fps = _motion_fps_from_manifest(manifest_outputs)
        if fps is None:
            fps = 30
        config["motion"] = {"bvh_uri": motion_asset["uri"], "fps": fps}

        if music_asset and music_asset.get("uri"):
            config["music"] = {"wav_uri": music_asset["uri"], "offset_s": 0}
        else:
            warnings.append("music_wav missing; preview will be silent")

        preview = _preview_section(uir)
        camera_preset = _camera_preset(preview) or "orbit"
        autoplay = _autoplay(preview)
        if autoplay is None:
            autoplay = True
        config["camera"] = {"preset": camera_preset, "auto_rotate": autoplay}

        duration_s = _duration_from_preview(preview)
        if duration_s is None:
            duration_s = _duration_from_motion(motion)
        if duration_s is None:
            duration_s = _duration_from_intent(uir)
        if duration_s is not None:
            config["timeline"] = {"duration_s": duration_s}

        file_path = output_dir / "preview_config.json"
        try:
            file_path.write_text(
                json.dumps(config, ensure_ascii=True, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write preview_config.json",
                    detail={"path": str(file_path), "error": str(exc)},
                    retryable=True,
                ),
            )

        reporter.stage("preview_config_done", 1.0, "preview config ready")
        artifact = build_asset_ref(
            file_path, job_id, "preview_config", "application/json"
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"adapter": "preview_config_builder"},
            "warnings": warnings,
            "error": None,
        }


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


def _artifact_list_from_uir(uir: Dict[str, Any]) -> List[Dict[str, Any]]:
    for key in ("artifacts", "artifacts_partial", "dependencies"):
        entries = uir.get(key)
        if isinstance(entries, list):
            return [item for item in entries if isinstance(item, dict)]
    assets = uir.get("assets")
    if isinstance(assets, dict):
        entries = assets.get("artifacts") or assets.get("artifacts_partial")
        if isinstance(entries, list):
            return [item for item in entries if isinstance(item, dict)]
    return []


def _manifest_outputs(job_root: Path) -> Dict[str, Any]:
    manifest_path = job_root / "manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        with manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except json.JSONDecodeError:
        return {}
    if not isinstance(manifest, dict):
        return {}
    outputs = manifest.get("outputs")
    return outputs if isinstance(outputs, dict) else {}


def _resolve_asset(
    role: str,
    artifacts: List[Dict[str, Any]],
    manifest_outputs: Dict[str, Any],
    job_root: Path,
    job_id: str,
) -> Optional[Dict[str, Any]]:
    asset = _asset_from_artifacts(artifacts, role)
    if asset:
        return asset
    asset = _asset_from_manifest(manifest_outputs, role)
    if asset:
        return asset
    default = _ROLE_DEFAULTS.get(role)
    if not default:
        return None
    rel_path, mime = default
    file_path = job_root / rel_path
    if file_path.exists():
        return build_asset_ref(file_path, job_id, role, mime)
    return None


def _asset_from_artifacts(
    artifacts: List[Dict[str, Any]], role: str
) -> Optional[Dict[str, Any]]:
    for artifact in artifacts:
        if artifact.get("role") == role:
            return artifact
    return None


def _asset_from_manifest(
    outputs: Dict[str, Any], role: str
) -> Optional[Dict[str, Any]]:
    path_map = {
        "scene_panorama": ("scene", "panorama"),
        "motion_bvh": ("motion", "bvh"),
        "music_wav": ("music", "wav"),
        "character_manifest": ("character", "manifest"),
    }
    path = path_map.get(role)
    if not path:
        return None
    value: Any = outputs
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return _normalize_asset_ref(value)


def _normalize_asset_ref(value: Any) -> Optional[Dict[str, Any]]:
    if isinstance(value, dict):
        if "uri" in value:
            return value
        for key in ("url", "path"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                normalized = dict(value)
                normalized["uri"] = candidate
                return normalized
        return value
    if isinstance(value, str) and value.strip():
        return {"uri": value}
    return None


def _character_config(
    asset: Optional[Dict[str, Any]],
    job_id: str,
    job_root: Path,
    warnings: List[str],
) -> Optional[Dict[str, Any]]:
    if not asset:
        warnings.append("character_manifest missing; using default character")
        return dict(_DEFAULT_CHARACTER)

    meta = asset.get("meta")
    if isinstance(meta, dict):
        candidate = _character_payload(meta)
        if candidate:
            return candidate

    path = _path_from_asset(asset, job_id, job_root)
    if path is None:
        path = job_root / _ROLE_DEFAULTS["character_manifest"][0]
    if not path.exists():
        warnings.append("character_manifest not found; using default character")
        return dict(_DEFAULT_CHARACTER)
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        warnings.append("character_manifest unreadable; using default character")
        return dict(_DEFAULT_CHARACTER)
    candidate = _character_payload(payload)
    if candidate:
        return candidate
    warnings.append("character_manifest missing fields; using default character")
    return dict(_DEFAULT_CHARACTER)


def _character_payload(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    model_uri = value.get("model_uri")
    skeleton = value.get("skeleton")
    payload: Dict[str, Any] = {}
    if isinstance(model_uri, str) and model_uri.strip():
        payload["model_uri"] = model_uri.strip()
    if isinstance(skeleton, str) and skeleton.strip():
        payload["skeleton"] = skeleton.strip()
    return payload or None


def _path_from_asset(
    asset: Dict[str, Any], job_id: str, job_root: Path
) -> Optional[Path]:
    uri = asset.get("uri")
    if not isinstance(uri, str) or not uri:
        return None
    prefix = f"/assets/{job_id}/"
    if uri.startswith(prefix):
        rel_path = uri[len(prefix) :]
        if rel_path:
            return job_root / rel_path
    return None


def _find_job_dir(out_dir: Path, job_id: str) -> Optional[Path]:
    if not job_id:
        return None
    for parent in (out_dir, *out_dir.parents):
        if parent.name == job_id:
            return parent
    runtime_paths = get_runtime_paths()
    candidate = runtime_paths.assets_dir / job_id
    if candidate.exists():
        return candidate
    return None


def _assert_dir_writable(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".write_check"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()


def _modules_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        return modules
    return {}


def _motion_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    motion = _modules_section(uir).get("motion")
    if isinstance(motion, dict):
        return motion
    return {}


def _preview_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    preview = _modules_section(uir).get("preview")
    if isinstance(preview, dict):
        return preview
    return {}


def _fps_from_motion(motion: Dict[str, Any]) -> Optional[int]:
    fps = motion.get("fps")
    if isinstance(fps, (int, float)):
        return int(fps)
    return None


def _motion_fps_from_manifest(outputs: Dict[str, Any]) -> Optional[int]:
    motion = outputs.get("motion")
    if not isinstance(motion, dict):
        return None
    fps = motion.get("fps")
    if isinstance(fps, (int, float)):
        return int(fps)
    if isinstance(fps, str) and fps.strip():
        try:
            return int(float(fps))
        except ValueError:
            return None
    return None


def _camera_preset(preview: Dict[str, Any]) -> Optional[str]:
    value = preview.get("camera_preset")
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    return None


def _autoplay(preview: Dict[str, Any]) -> Optional[bool]:
    value = preview.get("autoplay")
    if isinstance(value, bool):
        return value
    return None


def _duration_from_preview(preview: Dict[str, Any]) -> Optional[float]:
    timeline = preview.get("timeline")
    if not isinstance(timeline, dict):
        return None
    return _coerce_float(timeline.get("duration_s"))


def _duration_from_motion(motion: Dict[str, Any]) -> Optional[float]:
    return _coerce_float(motion.get("duration_s"))


def _duration_from_intent(uir: Dict[str, Any]) -> Optional[float]:
    intent = uir.get("intent")
    if not isinstance(intent, dict):
        return None
    return _coerce_float(intent.get("duration_s"))


def _coerce_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None
