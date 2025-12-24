from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import (
    AdapterResult,
    BaseAdapter,
    ProgressReporter,
    build_asset_ref,
    build_error,
)
from ..uir.validate import validate_uir

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_BIN = _REPO_ROOT / "musicgpt-x86_64-pc-windows-msvc.exe"


class MusicGPTCliAdapter(BaseAdapter):
    provider_id = "musicgpt_cli"
    modality = "music"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        music = _music_section(uir)
        if music.get("enabled") and not _prompt_from_music(music):
            raise ValueError("modules.music.prompt is required when music.enabled=true")

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

        prompt = _prompt_from_music(_music_section(uir))
        if not prompt:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_VALIDATION_INPUT",
                    "modules.music.prompt is required",
                    retryable=False,
                ),
            )
        duration_s = _duration_from_uir(uir)
        if duration_s is None:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_VALIDATION_INPUT",
                    "missing duration_s",
                    retryable=False,
                ),
            )

        exe_path = _resolve_musicgpt_bin()
        if exe_path is None:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "musicgpt executable not found",
                    detail={"expected": str(_DEFAULT_BIN)},
                    retryable=False,
                ),
            )

        output_dir = self.output_dir(out_dir)
        output_path = output_dir / "music.wav"
        meta_path = output_dir / "music_meta.json"
        log_path = _resolve_log_path(out_dir, job_id)

        reporter.stage("prepare", 0.1, "preparing MusicGPT input")
        cmd = [
            str(exe_path),
            prompt,
            "--secs",
            str(int(duration_s)),
            "--no-playback",
            "--no-interactive",
            "--output",
            str(output_path),
        ]
        env = os.environ.copy()
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as log_handle:
                reporter.stage("running", 0.5, "running MusicGPT")
                log_handle.write("[cmd] " + " ".join(cmd) + "\n")
                log_handle.flush()
                result = subprocess.run(
                    cmd,
                    stdout=log_handle,
                    stderr=log_handle,
                    text=True,
                    env=env,
                    check=False,
                )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to run musicgpt",
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
                    "musicgpt process failed",
                    detail={"return_code": result.returncode, "log": str(log_path)},
                    retryable=True,
                ),
            )

        if not _wait_for_file(output_path, timeout_s=20.0):
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "musicgpt output missing",
                    detail={"path": str(output_path)},
                    retryable=True,
                ),
            )

        sample_rate, channels = _wav_meta(output_path)
        meta = {
            "duration_s": float(duration_s),
            "sample_rate": sample_rate,
            "channels": channels,
            "provider": self.provider_id,
            "prompt_original": prompt,
            "prompt_used": prompt,
            "cmdline": " ".join(cmd),
        }
        try:
            meta_path.write_text(
                json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write music_meta.json",
                    detail={"path": str(meta_path), "error": str(exc)},
                    retryable=True,
                ),
            )

        artifacts = [
            build_asset_ref(output_path, job_id, "music_wav", "audio/wav"),
            build_asset_ref(meta_path, job_id, "music_meta", "application/json"),
        ]
        reporter.stage("finalize", 1.0, "music artifacts ready")
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": artifacts,
            "meta": {"duration_s": float(duration_s)},
            "warnings": warnings,
            "error": None,
        }


def _resolve_musicgpt_bin() -> Optional[Path]:
    env_path = os.getenv("MUSICGPT_BIN")
    if env_path:
        candidate = Path(env_path)
        if candidate.exists():
            return candidate
    if _DEFAULT_BIN.exists():
        return _DEFAULT_BIN
    found = shutil.which("musicgpt")
    if found:
        return Path(found)
    found = shutil.which("musicgpt.exe")
    if found:
        return Path(found)
    return None


def _wait_for_file(path: Path, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if path.exists() and path.stat().st_size > 0:
            return True
        time.sleep(0.2)
    return False


def _wav_meta(path: Path) -> tuple[Optional[int], Optional[int]]:
    try:
        with wave.open(str(path), "rb") as handle:
            return handle.getframerate(), handle.getnchannels()
    except (OSError, wave.Error):
        return None, None


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


def _music_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        music = modules.get("music")
        if isinstance(music, dict):
            return music
    return {}


def _prompt_from_music(music: Dict[str, Any]) -> str:
    prompt = music.get("prompt")
    if isinstance(prompt, str):
        return prompt.strip()
    return ""


def _duration_from_uir(uir: Dict[str, Any]) -> Optional[float]:
    music = _music_section(uir)
    duration = music.get("duration_s")
    if duration is None:
        intent = uir.get("intent")
        if isinstance(intent, dict):
            duration = intent.get("duration_s")
    if duration is None:
        return None
    try:
        return float(duration)
    except (TypeError, ValueError):
        return None


def _resolve_log_path(out_dir: Path, job_id: str) -> Path:
    job_dir = _find_job_dir(out_dir, job_id)
    if job_dir is not None:
        return job_dir / "logs" / "music.log"
    return out_dir.parent / "logs" / "music.log"


def _find_job_dir(out_dir: Path, job_id: str) -> Optional[Path]:
    if not job_id:
        return None
    for parent in (out_dir, *out_dir.parents):
        if parent.name == job_id:
            return parent
    return None
