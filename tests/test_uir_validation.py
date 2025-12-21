import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "orchestrator" / "src"))

from uir import UIRValidationError, parse_uir, stable_hash, validate_uir


def _base_uir():
    return {
        "uir_version": "1.0",
        "job": {"id": "job_1", "created_at": "2025-12-20T00:00:00Z"},
        "input": {"raw_prompt": "test prompt", "lang": "en"},
        "intent": {"targets": ["scene", "motion"], "duration_s": 12},
        "modules": {
            "scene": {
                "enabled": True,
                "prompt": "panorama scene",
                "resolution": [2048, 1024],
            },
            "motion": {"enabled": True, "prompt": "walk cycle", "fps": 30},
            "music": {"enabled": False},
            "character": {"enabled": False},
            "preview": {"enabled": False},
            "export": {"enabled": False},
        },
        "constraints": {"max_runtime_s": 600},
        "runtime": {"priority": 5},
        "hooks": {"event_stream": True},
    }


class TestUIRValidation(unittest.TestCase):
    def test_validate_ok(self):
        validate_uir(_base_uir())

    def test_version_must_match(self):
        payload = _base_uir()
        payload["uir_version"] = "0.9"
        with self.assertRaises(UIRValidationError):
            validate_uir(payload)

    def test_enabled_module_requires_target(self):
        payload = _base_uir()
        payload["intent"]["targets"] = ["scene"]
        with self.assertRaises(UIRValidationError):
            validate_uir(payload)

    def test_scene_resolution_ratio(self):
        payload = _base_uir()
        payload["modules"]["scene"]["resolution"] = [1000, 1000]
        with self.assertRaises(UIRValidationError):
            validate_uir(payload)

    def test_motion_fps_range(self):
        payload = _base_uir()
        payload["modules"]["motion"]["fps"] = 10
        with self.assertRaises(UIRValidationError):
            validate_uir(payload)

    def test_motion_duration_defaults(self):
        model = parse_uir(_base_uir())
        self.assertEqual(model.modules.motion.duration_s, model.intent.duration_s)

    def test_stable_hash_prefix(self):
        digest = stable_hash(_base_uir())
        self.assertTrue(digest.startswith("sha256:"))


if __name__ == "__main__":
    unittest.main()
