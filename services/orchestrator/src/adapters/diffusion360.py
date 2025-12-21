from __future__ import annotations

import json
import random
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import AdapterResult, BaseAdapter, ProgressReporter, build_asset_ref, build_error
from ..config.runtime import get_runtime_paths
from ..uir.validate import validate_uir

_REPO_ROOT = Path(__file__).resolve().parents[4]
_MODEL_ROOT = _REPO_ROOT / "third_party" / "SD-T2I-360PanoImage"
_PIPELINE_PATH = (
    _MODEL_ROOT / "txt2panoimg" / "text_to_360panorama_image_pipeline.py"
)
_MODELS_DIR = _MODEL_ROOT / "models"
_REQUIRED_MODEL_PATHS = (
    _MODELS_DIR / "sd-base",
    _MODELS_DIR / "sr-base",
    _MODELS_DIR / "sr-control",
    _MODELS_DIR / "RealESRGAN_x2plus.pth",
)

_DEFAULT_RESOLUTION = (2048, 1024)
_DEFAULT_CFG_SCALE = 7.5
_DEFAULT_ADD_PROMPT = (
    "photorealistic, trend on artstation, ((best quality)), ((ultra high res))"
)
_DEFAULT_NEGATIVE_PROMPT = (
    "persons, complex texture, small objects, sheltered, blur, worst quality, "
    "low quality, zombie, logo, text, watermark, username, monochrome, "
    "complex lighting"
)

_QUALITY_PRESETS: Dict[str, Dict[str, Any]] = {
    "fast": {"resolution": (1024, 512), "steps": 15, "upscale": False},
    "standard": {"resolution": (2048, 1024), "steps": 20, "upscale": True},
    "high": {"resolution": (4096, 2048), "steps": 30, "upscale": True},
}


class Diffusion360Adapter(BaseAdapter):
    provider_id = "diffusion360_local"
    modality = "scene"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        scene = _scene_section(uir)
        if scene.get("enabled") and not _prompt_from_scene(scene):
            raise ValueError("modules.scene.prompt is required when scene.enabled=true")
        quality_label, quality_settings, _ = _quality_settings_from_uir(uir)
        resolution = _resolve_resolution(scene, quality_settings)
        _validate_resolution(resolution)
        _ensure_model_available()
        _ensure_gpu_available()
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

            quality_label, quality_settings, quality_warning = _quality_settings_from_uir(
                uir
            )
            if quality_warning:
                warnings.append(quality_warning)
            try:
                resolution = _resolve_resolution(scene, quality_settings)
                _validate_resolution(resolution)
                steps = _resolve_steps(scene, quality_settings)
                cfg_scale = _resolve_cfg_scale(scene)
                upscale = _resolve_upscale(scene, quality_settings)
                seed = _resolve_seed(scene)
            except ValueError as exc:
                _log_line(log_handle, f"[validate] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_VALIDATION_INPUT",
                        "invalid scene parameters",
                        detail={"error": str(exc)},
                        retryable=False,
                    ),
                )

            negative_prompt = _resolve_negative_prompt(scene)
            add_prompt = _DEFAULT_ADD_PROMPT
            prompt_used = f"<360panorama>, {prompt}, {add_prompt}"

            reporter.stage("prepare", 0.1, "preparing Diffusion360 inputs")
            _log_line(
                log_handle,
                (
                    "[prepare] "
                    f"job_id={job_id} quality={quality_label} "
                    f"resolution={resolution[0]}x{resolution[1]} "
                    f"steps={steps} cfg_scale={cfg_scale} seed={seed} "
                    f"upscale={upscale}"
                ),
            )
            _log_line(log_handle, f"[prompt] {prompt}")
            _log_line(log_handle, f"[negative_prompt] {negative_prompt}")

            reporter.stage("generating", 0.5, "generating panorama")
            try:
                device = _resolve_device()
                pipeline = _load_pipeline(device=device, log_handle=log_handle)
                inputs = {
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "num_inference_steps": steps,
                    "guidance_scale": cfg_scale,
                    "upscale": upscale,
                    "add_prompt": add_prompt,
                }
                _log_line(log_handle, f"[generate] device={device}")
                _log_line(log_handle, f"[generate] inputs={_format_inputs(inputs)}")
                output_img = _run_pipeline(
                    pipeline, inputs, log_handle=log_handle
                )
            except Exception as exc:
                _log_line(log_handle, f"[error] {exc}")
                if _is_oom_error(exc):
                    _maybe_clear_cuda_cache()
                    return _error_result(
                        self.provider_id,
                        warnings,
                        build_error(
                            "E_MODEL_RUNTIME",
                            "Diffusion360 out of memory",
                            detail={
                                "error": str(exc),
                                "suggestion": "reduce resolution or steps",
                                "log": str(log_path),
                            },
                            retryable=True,
                        ),
                    )
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_MODEL_RUNTIME",
                        "Diffusion360 pipeline failed",
                        detail={"error": str(exc), "log": str(log_path)},
                        retryable=True,
                    ),
                )

            reporter.stage("finalize", 0.9, "writing scene outputs")
            try:
                image = _ensure_pil_image(output_img)
            except ValueError as exc:
                _log_line(log_handle, f"[output] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_MODEL_RUNTIME",
                        "Diffusion360 output not an image",
                        detail={"error": str(exc)},
                        retryable=True,
                    ),
                )

            if image.size != resolution:
                original = image.size
                image = _resize_image(image, resolution)
                _log_line(
                    log_handle,
                    f"[resize] {original[0]}x{original[1]} -> {resolution[0]}x{resolution[1]}",
                )

            panorama_path = output_dir / "panorama.png"
            try:
                image.save(str(panorama_path), format="PNG")
            except OSError as exc:
                _log_line(log_handle, f"[io] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_IO_WRITE",
                        "failed to write panorama.png",
                        detail={"path": str(panorama_path), "error": str(exc)},
                        retryable=True,
                    ),
                )

            width, height = image.size
            meta = {
                "width": width,
                "height": height,
                "seed": seed,
                "steps": steps,
                "cfg_scale": cfg_scale,
                "provider": self.provider_id,
                "prompt_used": prompt_used,
                "negative_prompt": negative_prompt,
            }
            meta_path = output_dir / "scene_meta.json"
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
                        "failed to write scene_meta.json",
                        detail={"path": str(meta_path), "error": str(exc)},
                        retryable=True,
                    ),
                )

            artifacts = [
                build_asset_ref(
                    panorama_path,
                    job_id,
                    "scene_panorama",
                    "image/png",
                ),
                build_asset_ref(
                    meta_path, job_id, "scene_meta", "application/json"
                ),
            ]
            reporter.stage("finalize", 1.0, "scene artifacts ready")
            return {
                "ok": True,
                "provider": self.provider_id,
                "artifacts": artifacts,
                "meta": {
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "steps": steps,
                    "cfg_scale": cfg_scale,
                },
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


def _quality_settings_from_uir(
    uir: Dict[str, Any],
) -> Tuple[str, Dict[str, Any], Optional[str]]:
    constraints = uir.get("constraints")
    quality = None
    if isinstance(constraints, dict):
        quality = constraints.get("quality")
    quality_label = "standard"
    warning = None
    if isinstance(quality, str) and quality:
        quality_label = quality.lower()
    if quality_label not in _QUALITY_PRESETS:
        warning = f"unsupported quality '{quality_label}', using standard"
        quality_label = "standard"
    return quality_label, dict(_QUALITY_PRESETS[quality_label]), warning


def _resolve_resolution(
    scene: Dict[str, Any], quality_settings: Dict[str, Any]
) -> Tuple[int, int]:
    if "resolution" in scene:
        parsed = _parse_resolution(scene.get("resolution"))
        if parsed is None:
            raise ValueError("modules.scene.resolution must be [width, height]")
        return parsed
    resolution = quality_settings.get("resolution", _DEFAULT_RESOLUTION)
    if isinstance(resolution, (list, tuple)) and len(resolution) == 2:
        return int(resolution[0]), int(resolution[1])
    return _DEFAULT_RESOLUTION


def _resolve_steps(scene: Dict[str, Any], quality_settings: Dict[str, Any]) -> int:
    if "steps" in scene and scene.get("steps") is not None:
        try:
            steps = int(scene.get("steps"))
        except (TypeError, ValueError) as exc:
            raise ValueError("modules.scene.steps must be an integer") from exc
        if steps < 1:
            raise ValueError("modules.scene.steps must be >= 1")
        return steps
    steps = int(quality_settings.get("steps", 20))
    if steps < 1:
        raise ValueError("steps must be >= 1")
    return steps


def _resolve_cfg_scale(scene: Dict[str, Any]) -> float:
    if "cfg_scale" in scene and scene.get("cfg_scale") is not None:
        try:
            cfg_scale = float(scene.get("cfg_scale"))
        except (TypeError, ValueError) as exc:
            raise ValueError("modules.scene.cfg_scale must be a number") from exc
        if cfg_scale < 0:
            raise ValueError("modules.scene.cfg_scale must be >= 0")
        return cfg_scale
    return _DEFAULT_CFG_SCALE


def _resolve_upscale(scene: Dict[str, Any], quality_settings: Dict[str, Any]) -> bool:
    if "upscale" in scene:
        value = scene.get("upscale")
        if value is None:
            return bool(quality_settings.get("upscale", True))
        if isinstance(value, bool):
            return value
        raise ValueError("modules.scene.upscale must be a boolean")
    return bool(quality_settings.get("upscale", True))


def _resolve_seed(scene: Dict[str, Any]) -> int:
    if "seed" in scene and scene.get("seed") is not None:
        try:
            seed = int(scene.get("seed"))
        except (TypeError, ValueError) as exc:
            raise ValueError("modules.scene.seed must be an integer") from exc
        if seed < 0:
            raise ValueError("modules.scene.seed must be >= 0")
        return seed
    return random.randint(0, 65535)


def _resolve_negative_prompt(scene: Dict[str, Any]) -> str:
    value = scene.get("negative_prompt")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return _DEFAULT_NEGATIVE_PROMPT


def _parse_resolution(value: Any) -> Optional[Tuple[int, int]]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        width = int(value[0])
        height = int(value[1])
    except (TypeError, ValueError):
        return None
    return width, height


def _validate_resolution(resolution: Tuple[int, int]) -> None:
    width, height = resolution
    if width != height * 2:
        raise ValueError("resolution width must be 2x height")
    if width < 1024 or width > 4096:
        raise ValueError("resolution width must be between 1024 and 4096")
    if height < 512 or height > 2048:
        raise ValueError("resolution height must be between 512 and 2048")


def _ensure_model_available() -> None:
    if not _MODEL_ROOT.exists():
        raise ValueError("SD-T2I-360PanoImage not found in third_party")
    if not _PIPELINE_PATH.exists():
        raise ValueError("Diffusion360 pipeline script is missing")
    missing = [path for path in _REQUIRED_MODEL_PATHS if not path.exists()]
    if missing:
        missing_str = ", ".join(str(path) for path in missing)
        raise ValueError(f"Diffusion360 model files missing: {missing_str}")
    _ensure_pipeline_importable()


def _ensure_pipeline_importable() -> None:
    _ensure_sys_path(_MODEL_ROOT)
    try:
        from txt2panoimg import Text2360PanoramaImagePipeline  # noqa: F401
    except Exception as exc:
        raise ValueError(f"failed to import Diffusion360 pipeline: {exc}") from exc


def _ensure_sys_path(path: Path) -> None:
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


def _ensure_gpu_available() -> None:
    try:
        import torch
    except Exception as exc:
        raise ValueError(f"torch is required for Diffusion360: {exc}") from exc
    if not torch.cuda.is_available():
        raise ValueError("CUDA GPU is required for Diffusion360 inference")


def _resolve_device() -> str:
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is required for Diffusion360 inference")
    return "cuda"


def _load_pipeline(device: str, log_handle: Optional[Any] = None) -> Any:
    _ensure_sys_path(_MODEL_ROOT)
    from txt2panoimg import Text2360PanoramaImagePipeline
    import torch

    torch_dtype = torch.float16
    if log_handle is None:
        return Text2360PanoramaImagePipeline(
            str(_MODELS_DIR), device=device, torch_dtype=torch_dtype
        )
    with redirect_stdout(log_handle), redirect_stderr(log_handle):
        return Text2360PanoramaImagePipeline(
            str(_MODELS_DIR), device=device, torch_dtype=torch_dtype
        )


def _run_pipeline(pipeline: Any, inputs: Dict[str, Any], log_handle: Any) -> Any:
    try:
        import torch
    except Exception:
        torch = None
    if torch is not None and hasattr(torch, "inference_mode"):
        with torch.inference_mode():
            with redirect_stdout(log_handle), redirect_stderr(log_handle):
                return pipeline(inputs)
    with redirect_stdout(log_handle), redirect_stderr(log_handle):
        return pipeline(inputs)


def _ensure_pil_image(output: Any) -> Any:
    try:
        from PIL import Image
    except Exception as exc:
        raise ValueError(f"PIL is required for image handling: {exc}") from exc
    if isinstance(output, Image.Image):
        return output
    images = None
    if isinstance(output, dict):
        images = output.get("images")
    if isinstance(images, list) and images:
        if isinstance(images[0], Image.Image):
            return images[0]
    raise ValueError(f"unexpected output type: {type(output)}")


def _resize_image(image: Any, resolution: Tuple[int, int]) -> Any:
    try:
        from PIL import Image
    except Exception as exc:
        raise ValueError(f"PIL is required for image handling: {exc}") from exc
    resample = Image.LANCZOS
    if hasattr(Image, "Resampling"):
        resample = Image.Resampling.LANCZOS
    return image.resize(resolution, resample=resample)


def _is_oom_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    if "out of memory" in message or "cuda out of memory" in message:
        return True
    try:
        import torch

        if isinstance(exc, torch.cuda.OutOfMemoryError):
            return True
    except Exception:
        pass
    return False


def _maybe_clear_cuda_cache() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        return


def _format_inputs(inputs: Dict[str, Any]) -> str:
    redacted = dict(inputs)
    if "prompt" in redacted:
        redacted["prompt"] = "<prompt>"
    if "negative_prompt" in redacted:
        redacted["negative_prompt"] = "<negative_prompt>"
    return json.dumps(redacted, ensure_ascii=True, sort_keys=True)


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
        return job_dir / "logs" / "scene.log"
    return out_dir.parent / "logs" / "scene.log"


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


def _log_line(handle: Any, line: str) -> None:
    handle.write(line.rstrip() + "\n")
    handle.flush()
