from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
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
from ..utils.wsl import build_wsl_command, should_use_wsl, to_wsl_path, wsl_distro

_REPO_ROOT = Path(__file__).resolve().parents[4]
_ANIMATIONGPT_ROOT = Path(
    os.getenv(
        "ANIMATIONGPT_ROOT", str(_REPO_ROOT / "third_party" / "AnimationGPT")
    )
)
_ANIMATION_PY = Path(
    os.getenv("ANIMATION_PY", str(_ANIMATIONGPT_ROOT / "tools" / "animation.py"))
)
_DEFAULT_EXPORT_RESOLUTION = (1920, 1080)
_DEFAULT_EXPORT_FPS = 30


class FfmpegExportAdapter(BaseAdapter):
    provider_id = "ffmpeg_export"
    modality = "export"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        export = _module_section(uir, "export")
        if export.get("enabled"):
            fmt = _export_format(export)
            if fmt not in {"mp4", "zip"}:
                raise ValueError("modules.export.format must be mp4 or zip")

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

        export = _module_section(uir, "export")
        fmt = _export_format(export)
        if fmt == "zip":
            return _run_zip_export(
                self,
                uir,
                out_dir,
                reporter,
                job_id,
                warnings,
                export.get("include"),
            )
        if fmt != "mp4":
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_UNSUPPORTED",
                    f"unsupported export format: {fmt}",
                    retryable=False,
                ),
            )

        duration_s = _duration_from_uir(uir)
        if duration_s is None:
            duration_s = 12.0
            warnings.append("duration_s missing; defaulting to 12s")
        fps = _export_fps(export)
        width, height = _export_resolution(uir, export)
        bitrate = _export_bitrate(export)

        reporter.stage("collect", 0.2, "collecting export inputs")
        job_dir = _find_job_dir(out_dir, job_id) or out_dir
        artifacts = _load_artifacts(job_id)
        scene_artifact = _find_artifact(artifacts, "scene_panorama")
        if not scene_artifact:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "missing required artifacts",
                    detail={"missing": ["scene_panorama"]},
                    retryable=False,
                ),
            )
        scene_path = _resolve_artifact_path(scene_artifact, job_dir, job_id)
        if scene_path is None or not scene_path.exists():
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "scene panorama not found on disk",
                    detail={"path": str(scene_path) if scene_path else None},
                    retryable=True,
                ),
            )

        motion_npy_path = _find_motion_npy(artifacts, job_dir, job_id)
        if motion_npy_path is None or not motion_npy_path.exists():
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "missing required artifacts",
                    detail={"missing": ["motion_npy"]},
                    retryable=False,
                ),
            )

        motion_meta = _read_json(job_dir / "motion" / "motion_meta.json")
        if motion_meta:
            if export.get("fps") is None:
                fps = _safe_int(motion_meta.get("fps"), fps)
            duration_from_meta = _safe_float(motion_meta.get("duration_s"))
            if duration_from_meta is not None:
                duration_s = duration_from_meta

        music_artifact = _find_artifact(artifacts, "music_wav")
        music_path = None
        if music_artifact:
            candidate = _resolve_artifact_path(music_artifact, job_dir, job_id)
            if candidate and candidate.exists():
                music_path = candidate
            else:
                warnings.append("music_wav missing on disk; exporting silent video")
        else:
            warnings.append("music_wav missing; exporting silent video")

        ffmpeg_bin = _resolve_ffmpeg_bin()
        if ffmpeg_bin is None:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "ffmpeg executable not found",
                    detail={"env": "FFMPEG_BIN"},
                    retryable=False,
                ),
            )

        if not _ANIMATION_PY.exists():
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "animation.py not found",
                    detail={"path": str(_ANIMATION_PY)},
                    retryable=False,
                ),
            )

        output_dir = self.output_dir(out_dir)
        render_dir = output_dir / "render"
        render_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "final.mp4"
        log_path = _resolve_log_path(out_dir, job_id)
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to create log directory",
                    detail={"path": str(log_path.parent), "error": str(exc)},
                    retryable=True,
                ),
            )

        reporter.stage("render", 0.45, "rendering motion video")
        render_python = _resolve_render_python()
        use_wsl = should_use_wsl(render_python)
        render_env = _build_render_env(use_wsl=use_wsl)
        render_ffmpeg_bin = _resolve_render_ffmpeg_bin(use_wsl=use_wsl)
        render_cmd = _build_motion_render_cmd(
            render_python,
            motion_npy_path.parent,
            render_dir,
            fps,
            render_ffmpeg_bin,
            use_wsl=use_wsl,
        )
        run_env = render_env
        render_cwd: Optional[Path] = _ANIMATION_PY.parent
        if use_wsl:
            render_cmd = build_wsl_command(
                render_cmd,
                env=render_env,
                distro=wsl_distro(),
                cwd=to_wsl_path(_ANIMATION_PY.parent),
            )
            run_env = os.environ.copy()
            render_cwd = None
        try:
            with log_path.open("a", encoding="utf-8") as log_handle:
                log_handle.write("[render_cmd] " + " ".join(render_cmd) + "\n")
                log_handle.flush()
                result = subprocess.run(
                    render_cmd,
                    cwd=str(render_cwd) if render_cwd is not None else None,
                    stdout=log_handle,
                    stderr=log_handle,
                    text=True,
                    env=run_env,
                    check=False,
                )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_MODEL_RUNTIME",
                    "motion render failed",
                    detail={"error": str(exc)},
                    retryable=True,
                ),
            )

        if result.returncode != 0:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_MODEL_RUNTIME",
                    "motion render failed",
                    detail={"return_code": result.returncode, "log": str(log_path)},
                    retryable=True,
                ),
            )

        motion_video_path = _find_latest_mp4(render_dir)
        if motion_video_path is None:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "motion mp4 missing",
                    detail={"dir": str(render_dir)},
                    retryable=True,
                ),
            )

        reporter.stage("compose", 0.75, "compositing scene and music")
        cmd = _build_composite_cmd(
            ffmpeg_bin,
            scene_path,
            motion_video_path,
            music_path,
            output_path,
            duration_s,
            fps,
            width,
            height,
            bitrate,
        )
        try:
            with log_path.open("a", encoding="utf-8") as log_handle:
                log_handle.write("[compose_cmd] " + " ".join(cmd) + "\n")
                log_handle.flush()
                result = subprocess.run(
                    cmd,
                    stdout=log_handle,
                    stderr=log_handle,
                    text=True,
                    check=False,
                )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_MODEL_RUNTIME",
                    "ffmpeg composition failed",
                    detail={"error": str(exc)},
                    retryable=True,
                ),
            )

        if result.returncode != 0:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_MODEL_RUNTIME",
                    "ffmpeg composition failed",
                    detail={"return_code": result.returncode, "log": str(log_path)},
                    retryable=True,
                ),
            )

        if not _wait_for_file(output_path, timeout_s=5.0):
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "export mp4 missing",
                    detail={"path": str(output_path)},
                    retryable=True,
                ),
            )

        artifact = build_asset_ref(output_path, job_id, "export_mp4", "video/mp4")
        reporter.stage("finalize", 1.0, "export mp4 ready")
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {
                "format": "mp4",
                "duration_s": float(duration_s),
                "fps": fps,
                "resolution": [width, height],
            },
            "warnings": warnings,
            "error": None,
        }


def _run_zip_export(
    adapter: FfmpegExportAdapter,
    uir: Dict[str, Any],
    out_dir: Path,
    reporter: ProgressReporter,
    job_id: str,
    warnings: List[str],
    include: Any,
) -> AdapterResult:
    output_dir = adapter.output_dir(out_dir)
    output_path = output_dir / "bundle.zip"
    include_set = _normalize_include(include)

    reporter.stage("collect", 0.3, "collecting export assets")
    files = _gather_zip_files(out_dir, include_set)
    if not files:
        return _error_result(
            adapter.provider_id,
            warnings,
            build_error(
                "E_DEPENDENCY_MISSING",
                "no exportable assets found",
                retryable=False,
            ),
        )

    reporter.stage("running", 0.7, "building export zip")
    try:
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path, arcname in files:
                archive.write(file_path, arcname)
    except OSError as exc:
        return _error_result(
            adapter.provider_id,
            warnings,
            build_error(
                "E_IO_WRITE",
                "failed to write export zip",
                detail={"path": str(output_path), "error": str(exc)},
                retryable=True,
            ),
        )

    artifact = build_asset_ref(output_path, job_id, "export_zip", "application/zip")
    reporter.stage("finalize", 1.0, "export zip ready")
    return {
        "ok": True,
        "provider": adapter.provider_id,
        "artifacts": [artifact],
        "meta": {"format": "zip", "files": len(files)},
        "warnings": warnings,
        "error": None,
    }


def _build_motion_render_cmd(
    python_exe: str,
    npy_dir: Path,
    render_dir: Path,
    fps: int,
    ffmpeg_bin: Optional[Path],
    *,
    use_wsl: bool,
) -> List[str]:
    python_bin = to_wsl_path(python_exe) if use_wsl else python_exe
    path_mapper = to_wsl_path if use_wsl else str
    cmd = [
        python_bin,
        path_mapper(_ANIMATION_PY),
        "--npy-folder",
        path_mapper(npy_dir),
        "--mp4-folder",
        path_mapper(render_dir),
        "--fps",
        str(fps),
    ]
    if ffmpeg_bin is not None:
        cmd += ["--ffmpeg", path_mapper(ffmpeg_bin)]
    return cmd


def _build_composite_cmd(
    ffmpeg_bin: Path,
    scene_path: Path,
    motion_path: Path,
    music_path: Optional[Path],
    output_path: Path,
    duration_s: float,
    fps: int,
    width: int,
    height: int,
    bitrate: Optional[str],
) -> List[str]:
    overlay_height = max(1, int(height * 0.45))
    bg_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}"
    )
    fg_filter = f"scale=-2:{overlay_height}"
    filter_complex = (
        f"[0:v]{bg_filter}[bg];"
        f"[1:v]{fg_filter}[fg];"
        "[bg][fg]overlay=W-w-40:H-h-40:shortest=1[v]"
    )
    cmd = [
        str(ffmpeg_bin),
        "-y",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-framerate",
        str(fps),
        "-i",
        str(scene_path),
        "-i",
        str(motion_path),
    ]
    if music_path is not None:
        cmd += ["-i", str(music_path)]
    cmd += [
        "-t",
        f"{duration_s:.2f}",
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(fps),
        "-movflags",
        "+faststart",
    ]
    if bitrate:
        cmd += ["-b:v", bitrate]
    if music_path is not None:
        cmd += [
            "-map",
            "2:a",
            "-af",
            "aformat=channel_layouts=stereo",
            "-c:a",
            "aac",
            "-shortest",
        ]
    else:
        cmd += ["-an"]
    cmd.append(str(output_path))
    return cmd


def _resolve_render_python() -> str:
    python_exe = os.getenv("PYTHON_MP4_EXE")
    if python_exe:
        return python_exe
    python_exe = os.getenv("ANIMATIONGPT_PYTHON") or os.getenv("PYTHON_EXE")
    if python_exe:
        return python_exe
    return sys.executable


def _build_render_env(*, use_wsl: bool) -> Dict[str, str]:
    env_overrides = {"PYTHONIOENCODING": "utf-8"}
    if use_wsl:
        return env_overrides
    env = dict(os.environ)
    env.update(env_overrides)
    return env


def _resolve_ffmpeg_bin() -> Optional[Path]:
    env_path = os.getenv("FFMPEG_BIN")
    if env_path:
        candidate = Path(env_path)
        if candidate.exists():
            return candidate
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    found = shutil.which("ffmpeg.exe")
    if found:
        return Path(found)
    return None


def _resolve_render_ffmpeg_bin(*, use_wsl: bool) -> Optional[Path]:
    if not use_wsl:
        return _resolve_ffmpeg_bin()
    env_path = os.getenv("FFMPEG_BIN_WSL")
    if env_path:
        return Path(env_path)
    distro = wsl_distro()
    for prefix in (r"\\wsl$\\" + distro, r"\\wsl.localhost\\" + distro):
        candidate = Path(prefix) / "usr" / "bin" / "ffmpeg"
        if candidate.exists():
            return candidate
    return None


def _find_motion_npy(
    artifacts: List[Dict[str, Any]], job_dir: Path, job_id: str
) -> Optional[Path]:
    artifact = _find_artifact(artifacts, "motion_npy")
    if artifact:
        candidate = _resolve_artifact_path(artifact, job_dir, job_id)
        if candidate and candidate.exists():
            return candidate
    fallback = job_dir / "motion" / "motion_out.npy"
    if fallback.exists():
        return fallback
    motion_dir = job_dir / "motion"
    if motion_dir.exists():
        matches = sorted(motion_dir.glob("*_out.npy"), key=lambda p: p.stat().st_mtime)
        if matches:
            return matches[-1]
    return None


def _find_latest_mp4(folder: Path) -> Optional[Path]:
    if not folder.exists():
        return None
    matches = sorted(folder.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
    if matches:
        return matches[-1]
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


def _safe_int(value: Any, fallback: int) -> int:
    if isinstance(value, (int, float)):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return fallback
        return parsed if parsed > 0 else fallback
    return fallback


def _safe_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def _export_format(export: Dict[str, Any]) -> str:
    value = export.get("format")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    return "mp4"


def _export_fps(export: Dict[str, Any]) -> int:
    value = export.get("fps")
    if isinstance(value, (int, float)):
        fps = int(value)
        if fps > 0:
            return fps
    return _DEFAULT_EXPORT_FPS


def _export_resolution(uir: Dict[str, Any], export: Dict[str, Any]) -> Tuple[int, int]:
    value = export.get("resolution")
    if _valid_resolution(value):
        return int(value[0]), int(value[1])
    scene = _module_section(uir, "scene")
    value = scene.get("resolution")
    if _valid_resolution(value):
        return int(value[0]), int(value[1])
    return _DEFAULT_EXPORT_RESOLUTION


def _export_bitrate(export: Dict[str, Any]) -> Optional[str]:
    value = export.get("bitrate")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _valid_resolution(value: Any) -> bool:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return False
    return all(isinstance(item, (int, float)) and item > 0 for item in value)


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


def _normalize_include(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip().lower() for item in value if str(item).strip()]
    return ["scene", "motion", "music", "preview", "manifest"]


def _gather_zip_files(job_dir: Path, include: List[str]) -> List[Tuple[Path, str]]:
    mapping: Dict[str, List[str]] = {
        "scene": ["scene/panorama.png", "scene/scene_meta.json"],
        "motion": ["motion/motion.bvh", "motion/motion_meta.json"],
        "music": ["music/music.wav", "music/music_meta.json"],
        "preview": ["preview/preview_config.json"],
        "character": ["character/character_manifest.json"],
        "manifest": ["manifest.json"],
    }
    files: List[Tuple[Path, str]] = []
    for key in include:
        for rel_path in mapping.get(key, []):
            path = job_dir / rel_path
            if path.exists():
                files.append((path, rel_path))
    return files


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


def _resolve_artifact_path(
    artifact: Dict[str, Any], job_dir: Path, job_id: str
) -> Optional[Path]:
    uri = artifact.get("uri")
    if isinstance(uri, str):
        prefix = f"/assets/{job_id}/"
        if uri.startswith(prefix):
            rel = uri[len(prefix) :].lstrip("/")
            if rel:
                return job_dir / rel
        if not uri.startswith("/"):
            return job_dir / uri
    return None


def _wait_for_file(path: Path, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if path.exists() and path.stat().st_size > 0:
            return True
        time.sleep(0.2)
    return False


def _resolve_log_path(out_dir: Path, job_id: str) -> Path:
    job_dir = _find_job_dir(out_dir, job_id)
    if job_dir is not None:
        return job_dir / "logs" / "export.log"
    return out_dir.parent / "logs" / "export.log"


def _find_job_dir(out_dir: Path, job_id: str) -> Optional[Path]:
    if not job_id:
        return None
    for parent in (out_dir, *out_dir.parents):
        if parent.name == job_id:
            return parent
    return None


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
