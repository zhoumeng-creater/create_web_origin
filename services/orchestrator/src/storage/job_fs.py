from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

_REQUIRED_SUBDIRS = ("logs", "scene", "motion", "music", "preview", "export")


def ensure_job_dirs(base_assets_dir: Path, job_id: str) -> Path:
    base_assets_dir.mkdir(parents=True, exist_ok=True)
    job_dir = base_assets_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    for name in _REQUIRED_SUBDIRS:
        (job_dir / name).mkdir(parents=True, exist_ok=True)
    return job_dir


def write_uir(job_dir: Path, uir: Dict[str, Any]) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    uir_path = job_dir / "uir.json"
    with uir_path.open("w", encoding="utf-8") as handle:
        json.dump(uir, handle, ensure_ascii=True, indent=2, sort_keys=True)


def list_jobs(base_assets_dir: Path) -> List[Dict[str, Any]]:
    if not base_assets_dir.exists():
        return []
    manifests: List[Dict[str, Any]] = []
    for entry in base_assets_dir.iterdir():
        if not entry.is_dir():
            continue
        manifest_path = entry / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            with manifest_path.open("r", encoding="utf-8") as handle:
                manifest = json.load(handle)
        except json.JSONDecodeError:
            continue
        if not isinstance(manifest, dict):
            continue
        if "job_id" not in manifest:
            manifest = dict(manifest)
            manifest["job_id"] = entry.name
        manifests.append(manifest)
    manifests.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return manifests
