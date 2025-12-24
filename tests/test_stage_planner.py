import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.orchestrator.src.planner.stages import plan_stages
from services.orchestrator.src.scheduler.models import JobStatus


def _base_uir() -> dict:
    return {
        "uir_version": "1.0",
        "job": {"id": "job_1", "created_at": "2025-12-20T00:00:00Z"},
        "input": {"raw_prompt": "test prompt", "lang": "en"},
        "intent": {"targets": [], "duration_s": 12},
        "modules": {
            "scene": {"enabled": False, "prompt": "scene"},
            "motion": {"enabled": False, "prompt": "motion", "fps": 30},
            "music": {"enabled": False, "prompt": "music"},
            "character": {"enabled": False},
            "preview": {"enabled": False},
            "export": {"enabled": False},
        },
    }


class TestStagePlanner(unittest.TestCase):
    def test_skips_disabled_modules(self):
        uir = _base_uir()
        uir["intent"]["targets"] = [
            "scene",
            "motion",
            "music",
            "character",
            "preview",
            "export",
        ]
        modules = uir["modules"]
        modules["scene"]["enabled"] = True
        modules["motion"]["enabled"] = False
        modules["music"]["enabled"] = True
        modules["character"]["enabled"] = False
        modules["preview"]["enabled"] = False
        modules["export"]["enabled"] = False

        stages = plan_stages(uir)

        self.assertEqual(
            stages,
            [
                JobStatus.PLANNING.value,
                JobStatus.RUNNING_SCENE.value,
                JobStatus.RUNNING_MUSIC.value,
            ],
        )

    def test_preview_requires_target_and_enabled(self):
        uir = _base_uir()
        uir["intent"]["targets"] = ["preview"]
        uir["modules"]["preview"]["enabled"] = True
        stages = plan_stages(uir)
        self.assertIn(JobStatus.COMPOSING_PREVIEW.value, stages)

        uir["modules"]["preview"]["enabled"] = False
        stages = plan_stages(uir)
        self.assertNotIn(JobStatus.COMPOSING_PREVIEW.value, stages)

    def test_export_requires_target_and_enabled(self):
        uir = _base_uir()
        uir["intent"]["targets"] = ["export"]
        uir["modules"]["export"]["enabled"] = True
        stages = plan_stages(uir)
        self.assertIn(JobStatus.EXPORTING_VIDEO.value, stages)

        uir["intent"]["targets"] = []
        stages = plan_stages(uir)
        self.assertNotIn(JobStatus.EXPORTING_VIDEO.value, stages)

    def test_character_stage_included(self):
        uir = _base_uir()
        uir["intent"]["targets"] = ["character"]
        uir["modules"]["character"]["enabled"] = True
        stages = plan_stages(uir)
        self.assertEqual(
            stages,
            [
                JobStatus.PLANNING.value,
                JobStatus.RUNNING_CHARACTER.value,
            ],
        )


if __name__ == "__main__":
    unittest.main()
