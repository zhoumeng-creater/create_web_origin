from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import AdapterResult, BaseAdapter, ProgressReporter, build_asset_ref, build_error
from ..config.runtime import get_runtime_paths
from ..uir.validate import validate_uir

_REPO_ROOT = Path(__file__).resolve().parents[4]
_EXE_CANDIDATES = (
    "musicgpt-x86_64-pc-windows-msvc.exe",
    "MusicGPT.exe",
    "musicgpt.exe",
)


class MusicGPTCliAdapter(BaseAdapter):
    provider_id = "musicgpt_cli"
    modality = "music"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        music = _music_section(uir)
        if music.get("enabled") and not _prompt_from_music(music):
            raise ValueError("modules.music.prompt is required when music.enabled=true")
        duration = _duration_from_uir(uir, music)
        if duration is None:
            raise ValueError("missing duration_s")
        if duration < 3 or duration > 60:
            raise ValueError("duration_s must be between 3 and 60")
        exe_path = _find_musicgpt_exe()
        if exe_path is None:
            raise ValueError("MusicGPT executable not found in repo root")
        _assert_executable(exe_path)
        job_id = _job_id_from_uir(uir)
        _assert_output_dir_writable(job_id, self.modality)

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        warnings: List[str] = []
        job_id = ""
        try:
            job_id = _job_id_from_uir(uir)
        except ValueError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error("E_VALIDATION_INPUT", str(exc), retryable=False),
            )

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

        with log_path.open("a", encoding="utf-8") as log_handle:
            try:
                self.validate(uir)
            except Exception as exc:
                _log_line(log_handle, f"[validate] {exc}")
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

            output_dir: Optional[Path] = None
            try:
                output_dir = self.output_dir(out_dir)
                _assert_dir_writable(output_dir)
            except OSError as exc:
                _log_line(log_handle, f"[io] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_IO_WRITE",
                        "output directory is not writable",
                        detail={
                            "path": str(output_dir or out_dir),
                            "error": str(exc),
                        },
                        retryable=True,
                    ),
                )

            music = _music_section(uir)
            prompt_original = _prompt_from_music(music)
            duration_s = _duration_from_uir(uir, music)
            if not prompt_original:
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_VALIDATION_INPUT",
                        "modules.music.prompt is required",
                        retryable=False,
                    ),
                )
            if duration_s is None:
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_VALIDATION_INPUT",
                        "duration_s is required",
                        retryable=False,
                    ),
                )

            reporter.stage("prepare", 0.1, "preparing MusicGPT inputs")
            _log_line(
                log_handle,
                f"[prepare] job_id={job_id} duration_s={duration_s} prompt_len={len(prompt_original)}",
            )

            prompt_used = _maybe_translate_prompt(
                uir, prompt_original, warnings, log_handle
            )
            wav_path = output_dir / "music.wav"
            exe_path = _find_musicgpt_exe()
            if exe_path is None:
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_DEPENDENCY_MISSING",
                        "MusicGPT executable not found",
                        retryable=False,
                    ),
                )
            _assert_executable(exe_path)

            reporter.stage("running", 0.5, "running MusicGPT CLI")
            cmd = [
                str(exe_path),
                prompt_used,
                "--secs",
                str(duration_s),
                "--output",
                str(wav_path),
            ]
            _log_line(log_handle, "[running] " + " ".join(cmd))
            timeout_s = _timeout_from_uir(uir)
            result = _run_subprocess(
                cmd=cmd,
                cwd=_REPO_ROOT,
                env=dict(os.environ),
                timeout_s=timeout_s,
            )
            if result.stdout:
                _log_line(log_handle, "[stdout]")
                log_handle.write(result.stdout)
            if result.stderr:
                _log_line(log_handle, "[stderr]")
                log_handle.write(result.stderr)
            log_handle.flush()

            if result.timed_out:
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_TIMEOUT",
                        "MusicGPT timed out",
                        detail={"timeout_s": timeout_s, "log": str(log_path)},
                        retryable=True,
                    ),
                )
            if result.return_code != 0:
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_MODEL_RUNTIME",
                        "MusicGPT CLI failed",
                        detail={
                            "exit_code": result.return_code,
                            "stderr_tail": _tail_text(result.stderr, 2000),
                            "log": str(log_path),
                        },
                        retryable=True,
                    ),
                )

            if not wav_path.exists():
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_IO_WRITE",
                        "MusicGPT output wav missing",
                        detail={"path": str(wav_path)},
                        retryable=True,
                    ),
                )

            meta = {
                "duration_s": duration_s,
                "provider": self.provider_id,
                "prompt_original": prompt_original,
                "prompt_used": prompt_used,
                "cmdline": _redact_cmdline(cmd, prompt_used, wav_path),
            }
            meta_path = output_dir / "music_meta.json"
            try:
                meta_path.write_text(
                    json.dumps(meta, ensure_ascii=True, indent=2),
                    encoding="utf-8",
                )
            except OSError as exc:
                _log_line(log_handle, f"[io] {exc}")
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
                build_asset_ref(wav_path, job_id, "music_wav", "audio/wav"),
                build_asset_ref(
                    meta_path, job_id, "music_meta", "application/json"
                ),
            ]
            reporter.stage("finalize", 1.0, "music artifacts ready")
            return {
                "ok": True,
                "provider": self.provider_id,
                "artifacts": artifacts,
                "meta": {"duration_s": duration_s},
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


def _duration_from_uir(uir: Dict[str, Any], music: Dict[str, Any]) -> Optional[float]:
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


def _timeout_from_uir(uir: Dict[str, Any]) -> Optional[float]:
    constraints = uir.get("constraints")
    if not isinstance(constraints, dict):
        return None
    timeout = constraints.get("max_runtime_s")
    if timeout is None:
        return None
    try:
        return float(timeout)
    except (TypeError, ValueError):
        return None


def _input_lang(uir: Dict[str, Any]) -> Optional[str]:
    input_section = uir.get("input")
    if isinstance(input_section, dict):
        lang = input_section.get("lang")
        if isinstance(lang, str) and lang.strip():
            return lang.strip()
    return None


def _auto_translate_to_en(uir: Dict[str, Any]) -> bool:
    intent = uir.get("intent")
    if not isinstance(intent, dict):
        return False
    language_policy = intent.get("language_policy")
    if not isinstance(language_policy, dict):
        return False
    return bool(language_policy.get("auto_translate_to_en"))


def _is_zh_lang(lang: Optional[str]) -> bool:
    if not lang:
        return False
    value = lang.strip().lower()
    return value == "zh" or value.startswith("zh-") or value.startswith("zh_")


def _maybe_translate_prompt(
    uir: Dict[str, Any],
    prompt: str,
    warnings: List[str],
    log_handle: Any,
) -> str:
    if not _auto_translate_to_en(uir):
        return prompt
    if not _is_zh_lang(_input_lang(uir)):
        return prompt
    if not _contains_zh(prompt):
        return prompt
    translated, note = _translate_prompt(prompt)
    if translated:
        _log_line(log_handle, "[translate] ok")
        return translated
    warn = (
        "auto_translate_to_en enabled but translation unavailable"
        f" ({note}); using original prompt"
    )
    warnings.append(warn)
    _log_line(log_handle, f"[translate] failed: {note}")
    return prompt


def _contains_zh(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _translate_prompt(prompt: str) -> Tuple[Optional[str], str]:
    base_url = os.getenv("OPENAI_BASE_URL")
    if not base_url:
        return None, "missing_openai_base_url"
    model = os.getenv("MUSIC_TRANSLATE_MODEL") or os.getenv("OPENAI_MODEL")
    if not model:
        return None, "missing_openai_model"
    try:
        from openai import OpenAI
    except Exception as exc:
        return None, f"openai_import_error: {exc}"
    api_key = os.getenv("OPENAI_API_KEY", "ollama")
    try:
        try:
            client = OpenAI(base_url=base_url, api_key=api_key, timeout=8.0)
        except TypeError:
            client = OpenAI(base_url=base_url, api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a professional bilingual music prompt translator. "
                        "Translate the user's Chinese music prompt into concise, "
                        "idiomatic English optimized for text-to-music models."
                    ),
                },
                {"role": "user", "content": prompt.strip()},
            ],
            temperature=0.2,
        )
    except Exception as exc:
        return None, f"translate_error: {exc}"
    content = (response.choices[0].message.content or "").strip()
    if len(content) < 2:
        return None, "empty_translation"
    return content, "ok"


def _assert_output_dir_writable(job_id: str, modality: str) -> None:
    runtime_paths = get_runtime_paths()
    job_dir = runtime_paths.assets_dir / job_id
    output_dir = job_dir / modality
    _assert_dir_writable(output_dir)


def _assert_dir_writable(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".write_check"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()


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
    runtime_paths = get_runtime_paths()
    candidate = runtime_paths.assets_dir / job_id
    if candidate.exists():
        return candidate
    return None


def _find_musicgpt_exe() -> Optional[Path]:
    for name in _EXE_CANDIDATES:
        candidate = _REPO_ROOT / name
        if candidate.exists():
            return candidate
    for candidate in _REPO_ROOT.glob("*.exe"):
        if "musicgpt" in candidate.name.lower():
            return candidate
    return None


def _assert_executable(path: Path) -> None:
    if not path.exists() or not path.is_file():
        raise ValueError(f"MusicGPT executable missing: {path}")
    if os.name != "nt" and not os.access(str(path), os.X_OK):
        raise ValueError(f"MusicGPT executable is not executable: {path}")


class _SubprocessResult:
    def __init__(self, return_code: int, timed_out: bool, stdout: str, stderr: str) -> None:
        self.return_code = return_code
        self.timed_out = timed_out
        self.stdout = stdout
        self.stderr = stderr


def _run_subprocess(
    cmd: List[str],
    cwd: Path,
    env: Dict[str, str],
    timeout_s: Optional[float],
) -> _SubprocessResult:
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_s,
            check=False,
        )
        return _SubprocessResult(
            return_code=completed.returncode,
            timed_out=False,
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
        )
    except subprocess.TimeoutExpired as exc:
        return _SubprocessResult(
            return_code=1,
            timed_out=True,
            stdout=exc.stdout or "",
            stderr=exc.stderr or "",
        )


def _redact_cmdline(cmd: List[str], prompt: str, output_path: Path) -> str:
    redacted: List[str] = []
    output_str = str(output_path)
    for arg in cmd:
        if arg == prompt:
            redacted.append("<prompt>")
        elif arg == output_str:
            redacted.append("<output>")
        else:
            redacted.append(str(arg))
    return " ".join(redacted)


def _tail_text(text: str, limit: int) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[-limit:]


def _log_line(handle: Any, line: str) -> None:
    handle.write(line.rstrip() + "\n")
    handle.flush()
