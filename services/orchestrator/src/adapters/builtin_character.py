from __future__ import annotations

import json
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


class BuiltinCharacterSelector(BaseAdapter):
    provider_id = "builtin_library"
    modality = "character"
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

        output_dir = self.output_dir(out_dir)
        reporter.stage("select", 0.2, "selecting character")
        character_id = _character_id_from_uir(uir)
        if not character_id:
            character_id = "samurai_01"
            warnings.append("character_id missing; using default")

        manifest = {
            "character_id": character_id,
            "model_uri": f"/static/characters/{character_id}.glb",
            "skeleton": "SMPL_22",
            "scale": 1.0,
            "notes": list(warnings),
        }
        manifest_path = output_dir / "character_manifest.json"
        try:
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write character_manifest.json",
                    detail={"path": str(manifest_path), "error": str(exc)},
                    retryable=True,
                ),
            )
        reporter.stage("finalize", 1.0, "character manifest ready")
        artifact = build_asset_ref(
            manifest_path,
            job_id,
            "character_manifest",
            "application/json",
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"character_id": character_id, "skeleton": "SMPL_22"},
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


def _character_id_from_uir(uir: Dict[str, Any]) -> Optional[str]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        character = modules.get("character")
        if isinstance(character, dict):
            value = character.get("character_id")
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None
