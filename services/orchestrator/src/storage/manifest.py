import hashlib
import json
from pathlib import Path
from typing import Any, Dict

from ..config.runtime import get_runtime_paths


def ensure_job_dir(job_id: str) -> Path:
    runtime_paths = get_runtime_paths()
    job_dir = runtime_paths.assets_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def make_asset_url(job_id: str, filename: str) -> str:
    return f"/assets/{job_id}/{filename}"


def _manifest_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "manifest.json"


def _hash_uir(uir: Any) -> str:
    try:
        payload = json.dumps(
            uir,
            sort_keys=True,
            ensure_ascii=True,
            separators=(",", ":"),
        )
    except TypeError:
        payload = json.dumps(str(uir), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


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

    inputs = job.uir
    if isinstance(job.uir, dict) and "inputs" in job.uir:
        inputs = job.uir.get("inputs")

    manifest = {
        "job_id": job.job_id,
        "created_at": job.created_at.isoformat(),
        "uir_hash": _hash_uir(job.uir),
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
