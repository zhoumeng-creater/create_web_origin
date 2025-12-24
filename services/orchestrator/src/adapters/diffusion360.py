from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    AdapterResult,
    BaseAdapter,
    ProgressReporter,
    build_asset_ref,
    build_error,
)
from ..uir.validate import validate_uir
from ..utils.wsl import build_wsl_command, should_use_wsl, to_wsl_path, wsl_distro

_REPO_ROOT = Path(__file__).resolve().parents[4]
_SD360_ROOT = Path(
    os.getenv(
        "DIFFUSION360_ROOT",
        str(_REPO_ROOT / "third_party" / "SD-T2I-360PanoImage"),
    )
)
_RUNNER_SCRIPT = Path(__file__).with_name("diffusion360_runner.py")


class Diffusion360Adapter(BaseAdapter):
    provider_id = "diffusion360_local"
    modality = "scene"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        scene = _scene_section(uir)
        if scene.get("enabled") and not _prompt_from_scene(scene):
            raise ValueError("modules.scene.prompt is required when scene.enabled=true")

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

        scene = _scene_section(uir)
        prompt = _prompt_from_scene(scene)
        if not prompt:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_VALIDATION_INPUT",
                    "modules.scene.prompt is required",
                    retryable=False,
                ),
            )

        model_root = _SD360_ROOT / "models"
        required = [
            model_root / "sd-base",
            model_root / "sr-base",
            model_root / "sr-control",
            model_root / "RealESRGAN_x2plus.pth",
        ]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "Diffusion360 models missing",
                    detail={"missing": missing},
                    retryable=False,
                ),
            )

        output_dir = self.output_dir(out_dir)
        output_path = output_dir / "panorama.png"
        meta_path = output_dir / "scene_meta.json"
        log_path = _resolve_log_path(out_dir, job_id)

        reporter.stage("prepare", 0.1, "preparing Diffusion360 input")
        diff_python = _resolve_diffusion_python()
        if diff_python is None:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "DIFFUSION360_PYTHON not configured",
                    detail={"env": "DIFFUSION360_PYTHON"},
                    retryable=False,
                ),
            )
        if not _RUNNER_SCRIPT.exists():
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_DEPENDENCY_MISSING",
                    "diffusion360 runner missing",
                    detail={"path": str(_RUNNER_SCRIPT)},
                    retryable=False,
                ),
            )

        inputs = _build_inputs(scene)
        device, cuda_visible = _device_from_uir(uir)
        use_wsl = should_use_wsl(diff_python)
        python_exe = to_wsl_path(diff_python) if use_wsl else diff_python
        cmd_args = _build_runner_cmd(
            python_exe,
            _RUNNER_SCRIPT,
            model_root,
            output_path,
            meta_path,
            inputs,
            device,
            use_wsl=use_wsl,
        )
        env = _build_runner_env(cuda_visible, use_wsl=use_wsl)
        cmd = cmd_args
        run_env = env
        if use_wsl:
            cmd = build_wsl_command(
                cmd_args,
                env=env,
                distro=wsl_distro(),
                cwd=to_wsl_path(_SD360_ROOT),
            )
            run_env = os.environ.copy()

        reporter.stage("running", 0.6, "running Diffusion360")
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as log_handle:
                log_handle.write("[cmd] " + " ".join(cmd) + "\n")
                log_handle.flush()
                result = subprocess.run(
                    cmd,
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
                    "Diffusion360 execution failed",
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
                    "Diffusion360 inference failed",
                    detail={"return_code": result.returncode, "log": str(log_path)},
                    retryable=True,
                ),
            )

        if not output_path.exists():
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "panorama output missing",
                    detail={"path": str(output_path)},
                    retryable=True,
                ),
            )

        meta = _read_json(meta_path) or {}
        width = meta.get("width") if isinstance(meta, dict) else None
        height = meta.get("height") if isinstance(meta, dict) else None

        artifacts = [
            build_asset_ref(output_path, job_id, "scene_panorama", "image/png"),
            build_asset_ref(meta_path, job_id, "scene_meta", "application/json"),
        ]
        reporter.stage("finalize", 1.0, "scene artifacts ready")
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": artifacts,
            "meta": {"width": width, "height": height},
            "warnings": warnings,
            "error": None,
        }


def _build_inputs(scene: Dict[str, Any]) -> Dict[str, Any]:
    inputs: Dict[str, Any] = {"prompt": scene.get("prompt", "")}
    if scene.get("negative_prompt"):
        inputs["negative_prompt"] = scene.get("negative_prompt")
    if scene.get("seed") is not None:
        inputs["seed"] = scene.get("seed")
    if scene.get("steps") is not None:
        inputs["num_inference_steps"] = scene.get("steps")
    if scene.get("cfg_scale") is not None:
        inputs["guidance_scale"] = scene.get("cfg_scale")
    upscale = scene.get("upscale")
    if upscale is None:
        upscale = False
    inputs["upscale"] = bool(upscale)
    return inputs


def _device_from_uir(uir: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    override = os.getenv("DIFFUSION360_DEVICE")
    if override:
        device, visible = _parse_device_override(override)
        return device, visible
    runtime = uir.get("runtime")
    if isinstance(runtime, dict):
        locks = runtime.get("locks")
        if isinstance(locks, dict):
            gpu = locks.get("gpu")
            if isinstance(gpu, (int, str)):
                return "cuda", str(gpu).replace("cuda:", "")
    return "cuda", None


def _parse_device_override(value: str) -> Tuple[str, Optional[str]]:
    text = value.strip().lower()
    if text == "cpu":
        return "cpu", None
    if text.startswith("cuda:"):
        return "cuda", text.split("cuda:", 1)[-1]
    if text == "cuda":
        return "cuda", None
    return "cuda", None


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


def _scene_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        scene = modules.get("scene")
        if isinstance(scene, dict):
            return scene
    return {}


def _prompt_from_scene(scene: Dict[str, Any]) -> str:
    prompt = scene.get("prompt")
    if isinstance(prompt, str):
        return prompt.strip()
    return ""


def _resolve_diffusion_python() -> Optional[str]:
    value = os.getenv("DIFFUSION360_PYTHON")
    if value:
        return value
    return None


def _build_runner_env(cuda_visible: Optional[str], use_wsl: bool) -> Dict[str, str]:
    env_overrides: Dict[str, str] = {"PYTHONIOENCODING": "utf-8"}
    python_paths = [str(_SD360_ROOT)]
    existing = os.environ.get("PYTHONPATH")
    if existing:
        python_paths.extend(path for path in existing.split(os.pathsep) if path)
    if use_wsl:
        python_paths = [to_wsl_path(path) for path in python_paths]
        env_overrides["PYTHONPATH"] = ":".join(python_paths)
    else:
        env_overrides["PYTHONPATH"] = os.pathsep.join(python_paths)
    if cuda_visible is not None:
        env_overrides["CUDA_VISIBLE_DEVICES"] = cuda_visible
    elif os.getenv("DIFFUSION360_DEVICE", "").strip().lower() == "cpu":
        env_overrides["CUDA_VISIBLE_DEVICES"] = ""
    if use_wsl:
        return env_overrides
    env = dict(os.environ)
    env.update(env_overrides)
    return env


def _build_runner_cmd(
    python_exe: str,
    script_path: Path,
    model_root: Path,
    output_path: Path,
    meta_path: Path,
    inputs: Dict[str, Any],
    device: str,
    *,
    use_wsl: bool,
) -> List[str]:
    path_mapper = to_wsl_path if use_wsl else str
    cmd = [
        python_exe,
        path_mapper(script_path),
        "--model-root",
        path_mapper(model_root),
        "--prompt",
        str(inputs.get("prompt", "")),
        "--output",
        path_mapper(output_path),
        "--meta-out",
        path_mapper(meta_path),
        "--device",
        device,
    ]
    if inputs.get("negative_prompt"):
        cmd += ["--negative-prompt", str(inputs.get("negative_prompt"))]
    if inputs.get("seed") is not None:
        cmd += ["--seed", str(inputs.get("seed"))]
    if inputs.get("num_inference_steps") is not None:
        cmd += ["--steps", str(inputs.get("num_inference_steps"))]
    if inputs.get("guidance_scale") is not None:
        cmd += ["--cfg-scale", str(inputs.get("guidance_scale"))]
    if inputs.get("upscale"):
        cmd += ["--upscale"]
    return cmd


def _resolve_log_path(out_dir: Path, job_id: str) -> Path:
    job_dir = _find_job_dir(out_dir, job_id)
    if job_dir is not None:
        return job_dir / "logs" / "scene.log"
    return out_dir.parent / "logs" / "scene.log"


def _find_job_dir(out_dir: Path, job_id: str) -> Optional[Path]:
    if not job_id:
        return None
    for parent in (out_dir, *out_dir.parents):
        if parent.name == job_id:
            return parent
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
