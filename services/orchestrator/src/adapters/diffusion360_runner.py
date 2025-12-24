from __future__ import annotations

import argparse
import json
import os
import sys
import types
from pathlib import Path
from typing import Any, Dict, Optional


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--meta-out")
    parser.add_argument("--negative-prompt")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--cfg-scale", type=float)
    parser.add_argument("--upscale", action="store_true")
    parser.add_argument("--device", default="cuda")
    return parser.parse_args()


def _build_inputs(args: argparse.Namespace) -> Dict[str, Any]:
    inputs: Dict[str, Any] = {
        "prompt": args.prompt,
        "upscale": bool(args.upscale),
    }
    if args.negative_prompt:
        inputs["negative_prompt"] = args.negative_prompt
    if args.seed is not None:
        inputs["seed"] = args.seed
    if args.steps is not None:
        inputs["num_inference_steps"] = args.steps
    if args.cfg_scale is not None:
        inputs["guidance_scale"] = args.cfg_scale
    return inputs


def _write_meta(path: Path, meta: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")


def _run() -> int:
    args = _parse_args()
    model_root = Path(args.model_root)
    repo_root = model_root.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    os.environ.setdefault("NUMPY_EXPERIMENTAL_DTYPE_API", "1")
    _patch_huggingface_hub()
    _disable_xformers_if_requested()
    _patch_torchvision_functional_tensor()
    try:
        import torch
        from txt2panoimg import Text2360PanoramaImagePipeline
    except Exception as exc:
        print(f"[error] missing diffusion360 dependencies: {exc}", file=sys.stderr)
        return 2

    device = args.device
    torch_dtype = torch.float16 if device == "cuda" else torch.float32
    try:
        pipeline = Text2360PanoramaImagePipeline(
            str(model_root),
            device=device,
            torch_dtype=torch_dtype,
        )
    except Exception as exc:
        print(f"[error] failed to load pipeline: {exc}", file=sys.stderr)
        return 3

    inputs = _build_inputs(args)
    try:
        output = pipeline(inputs)
    except Exception as exc:
        print(f"[error] inference failed: {exc}", file=sys.stderr)
        return 4

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(str(output_path))

    width = None
    height = None
    try:
        width, height = output.size
    except Exception:
        width, height = None, None

    meta: Dict[str, Any] = {
        "width": width,
        "height": height,
        "seed": inputs.get("seed"),
        "steps": inputs.get("num_inference_steps"),
        "cfg_scale": inputs.get("guidance_scale"),
        "provider": "diffusion360_local",
        "prompt_used": inputs.get("prompt"),
        "negative_prompt": inputs.get("negative_prompt"),
    }
    if args.meta_out:
        _write_meta(Path(args.meta_out), meta)

    return 0


def _patch_huggingface_hub() -> None:
    try:
        import huggingface_hub
    except Exception:
        return
    if hasattr(huggingface_hub, "cached_download"):
        return
    if hasattr(huggingface_hub, "hf_hub_download"):
        huggingface_hub.cached_download = huggingface_hub.hf_hub_download
    elif hasattr(huggingface_hub, "snapshot_download"):
        huggingface_hub.cached_download = huggingface_hub.snapshot_download


def _disable_xformers_if_requested() -> None:
    value = os.environ.get("DIFFUSION360_DISABLE_XFORMERS", "1").strip().upper()
    if value not in {"1", "TRUE", "YES", "ON"}:
        return
    _disable_xformers_import()


def _disable_xformers_import() -> None:
    import importlib.util as importlib_util

    if getattr(importlib_util.find_spec, "_diffusion360_patched", False):
        return

    original_find_spec = importlib_util.find_spec

    def _patched_find_spec(name: str, package: str | None = None):
        if name == "xformers":
            return None
        return original_find_spec(name, package)

    _patched_find_spec._diffusion360_patched = True  # type: ignore[attr-defined]
    importlib_util.find_spec = _patched_find_spec


def _patch_torchvision_functional_tensor() -> None:
    module_name = "torchvision.transforms.functional_tensor"
    if module_name in sys.modules:
        return
    try:
        import torchvision
        from torchvision.transforms import functional as functional_api
    except Exception:
        return
    if not hasattr(functional_api, "rgb_to_grayscale"):
        return
    shim = types.ModuleType(module_name)
    shim.rgb_to_grayscale = functional_api.rgb_to_grayscale
    sys.modules[module_name] = shim
    if hasattr(torchvision, "transforms"):
        setattr(torchvision.transforms, "functional_tensor", shim)


def main() -> None:
    raise SystemExit(_run())


if __name__ == "__main__":
    main()
