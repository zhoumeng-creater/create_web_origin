from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from .base import (
    AdapterResult,
    BaseAdapter,
    ProgressReporter,
    build_asset_ref,
)
from ..uir.validate import validate_uir


class DummyAdapter(BaseAdapter):
    provider_id = "dummy"
    modality = "scene"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)
        intent = uir.get("intent", {})
        targets = intent.get("targets", [])
        if isinstance(targets, list) and self.modality not in targets:
            raise ValueError(
                f"{self.provider_id} requires intent.targets to include {self.modality}"
            )

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        job_id = _job_id_from_uir(uir)
        output_dir = self.output_dir(out_dir)
        reporter.stage("dummy_start", 0.0, "dummy adapter starting")
        payload = {"provider": self.provider_id, "note": "dummy output"}
        file_path = output_dir / "dummy_meta.json"
        file_path.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8"
        )
        reporter.stage("dummy_done", 1.0, "dummy adapter done")
        artifact = build_asset_ref(
            file_path,
            job_id,
            "scene_meta",
            "application/json",
            meta={"dummy": True},
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"adapter": "dummy"},
            "warnings": [],
            "error": None,
        }


def _job_id_from_uir(uir: Dict[str, Any]) -> str:
    job = uir.get("job")
    if isinstance(job, dict):
        job_id = job.get("id")
        if job_id:
            return str(job_id)
    raise ValueError("missing job.id")
