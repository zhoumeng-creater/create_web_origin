import json
from pathlib import Path
from typing import Any, Dict

from ..config.runtime import get_runtime_paths
from ..uir import uir_hash


def ensure_job_dir(job_id: str) -> Path:
    runtime_paths = get_runtime_paths()
    job_dir = runtime_paths.assets_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def make_asset_url(job_id: str, filename: str) -> str:
    return f"/assets/{job_id}/{filename}"


def _manifest_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "manifest.json"


def _deep_merge(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def write_manifest(job: Any, outputs_dict: Dict[str, Any]) -> Path:
    manifest_path = _manifest_path(job.job_id)
    existing: Dict[str, Any] = {}
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8") as handle:
            existing = json.load(handle)

    outputs = existing.get("outputs", {})
    merged_outputs = _deep_merge(outputs, outputs_dict or {})

    inputs: Any = job.uir
    if isinstance(job.uir, dict):
        inputs = {}
        input_section = job.uir.get("input") or job.uir.get("inputs")
        if isinstance(input_section, dict):
            inputs.update(input_section)
        intent_section = job.uir.get("intent")
        if isinstance(intent_section, dict):
            inputs.update(intent_section)
        if not inputs:
            inputs = job.uir

    digest = getattr(job, "uir_hash", "") or uir_hash(job.uir)

    manifest = {
        "job_id": job.job_id,
        "created_at": job.created_at.isoformat(),
        "uir_hash": digest,
        "inputs": inputs,
        "outputs": merged_outputs,
    }
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=True, indent=2, sort_keys=True)
    return manifest_path


def read_manifest(job_id: str) -> Dict[str, Any]:
    manifest_path = _manifest_path(job_id)
    if not manifest_path.exists():
        return {}
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
