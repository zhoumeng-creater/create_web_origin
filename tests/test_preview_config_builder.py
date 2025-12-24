import json
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.orchestrator.src.adapters.preview import PreviewConfigBuilder
from services.orchestrator.src.scheduler.models import Job
from services.orchestrator.src.scheduler.store import JOB_STORE
from services.orchestrator.src.storage.job_fs import ensure_job_dirs


class _DummyReporter:
    def stage(self, name: str, progress: float, message: str = "", extra=None) -> None:
        return None

    def log(self, line: str) -> None:
        return None


def _base_uir(job_id: str) -> dict:
    return {
        "uir_version": "1.0",
        "job": {"id": job_id, "created_at": "2025-12-20T00:00:00Z"},
        "input": {"raw_prompt": "test prompt", "lang": "en"},
        "intent": {"targets": ["motion", "preview"], "duration_s": 12},
        "modules": {
            "scene": {"enabled": False, "prompt": "scene"},
            "motion": {"enabled": True, "prompt": "walk", "fps": 30},
            "music": {"enabled": False, "prompt": "music"},
            "character": {"enabled": False},
            "preview": {"enabled": True, "camera_preset": "orbit", "autoplay": True},
            "export": {"enabled": False},
        },
    }


class TestPreviewConfigBuilder(unittest.TestCase):
    def test_preview_config_builder_with_minimal_artifacts(self):
        with TemporaryDirectory() as temp_dir:
            old_runtime = os.environ.get("ORCH_RUNTIME_DIR")
            os.environ["ORCH_RUNTIME_DIR"] = temp_dir
            job_id = "job_preview_1"
            assets_root = Path(temp_dir) / "assets"
            job_dir = ensure_job_dirs(assets_root, job_id)
            (job_dir / "motion" / "motion.bvh").write_text("dummy", encoding="utf-8")
            uir = _base_uir(job_id)
            artifacts = [
                {
                    "id": f"{job_id}:motion_bvh",
                    "role": "motion_bvh",
                    "uri": f"/assets/{job_id}/motion/motion.bvh",
                    "mime": "text/plain",
                }
            ]
            job = Job(job_id=job_id, uir=uir, assets={"artifacts": artifacts})

            with JOB_STORE._lock:
                previous_jobs = dict(JOB_STORE._jobs)
                JOB_STORE._jobs.clear()
                JOB_STORE._jobs[job_id] = job
            try:
                adapter = PreviewConfigBuilder()
                result = adapter.run(uir, job_dir, _DummyReporter())
                self.assertTrue(result["ok"])
                config_path = job_dir / "preview" / "preview_config.json"
                self.assertTrue(config_path.is_file())
                with config_path.open("r", encoding="utf-8") as handle:
                    config = json.load(handle)
                self.assertEqual(
                    set(config.keys()),
                    {"scene", "character", "motion", "music", "camera", "timeline"},
                )
                self.assertEqual(
                    config["motion"]["bvh_uri"],
                    f"/assets/{job_id}/motion/motion.bvh",
                )
                self.assertIn("offset_s", config["music"])
                self.assertIn("skeleton", config["character"])
                warnings = result["warnings"]
                self.assertTrue(any("scene_panorama" in entry for entry in warnings))
                self.assertTrue(any("music_wav" in entry for entry in warnings))
                self.assertTrue(any("character_manifest" in entry for entry in warnings))
            finally:
                with JOB_STORE._lock:
                    JOB_STORE._jobs.clear()
                    JOB_STORE._jobs.update(previous_jobs)
                if old_runtime is None:
                    os.environ.pop("ORCH_RUNTIME_DIR", None)
                else:
                    os.environ["ORCH_RUNTIME_DIR"] = old_runtime


if __name__ == "__main__":
    unittest.main()
