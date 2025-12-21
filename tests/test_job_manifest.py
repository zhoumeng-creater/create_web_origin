import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.orchestrator.src.storage.job_fs import ensure_job_dirs, list_jobs, write_uir
from services.orchestrator.src.storage.manifest import write_manifest


def _base_uir(job_id: str) -> dict:
    return {
        "uir_version": "1.0",
        "job": {"id": job_id, "created_at": "2025-12-20T00:00:00Z"},
        "input": {"raw_prompt": "test prompt", "lang": "en"},
        "intent": {
            "targets": ["scene", "motion", "music", "preview"],
            "duration_s": 12,
            "style": "cinematic",
        },
        "modules": {
            "scene": {
                "enabled": True,
                "prompt": "panorama scene",
                "resolution": [2048, 1024],
            },
            "motion": {"enabled": True, "prompt": "walk cycle", "fps": 30},
            "music": {"enabled": True, "prompt": "test music", "duration_s": 12},
            "character": {"enabled": False},
            "preview": {"enabled": True},
            "export": {"enabled": False},
        },
    }


class TestJobManifest(unittest.TestCase):
    def test_job_dir_and_manifest_structure(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "assets"
            job_id = "job_123"
            job_dir = ensure_job_dirs(base_dir, job_id)
            uir = _base_uir(job_id)
            write_uir(job_dir, uir)
            artifacts = [
                {
                    "id": "scene_1",
                    "role": "scene_panorama",
                    "uri": f"/assets/{job_id}/scene/panorama.png",
                    "mime": "image/png",
                },
                {
                    "id": "motion_1",
                    "role": "motion_bvh",
                    "uri": f"/assets/{job_id}/motion/motion.bvh",
                    "mime": "text/plain",
                },
                {
                    "id": "music_1",
                    "role": "music_wav",
                    "uri": f"/assets/{job_id}/music/music.wav",
                    "mime": "audio/wav",
                },
                {
                    "id": "preview_1",
                    "role": "preview_config",
                    "uri": f"/assets/{job_id}/preview/preview_config.json",
                    "mime": "application/json",
                },
                {
                    "id": "export_1",
                    "role": "export_mp4",
                    "uri": f"/assets/{job_id}/export/final.mp4",
                    "mime": "video/mp4",
                },
            ]
            manifest = write_manifest(job_dir, uir, "DONE", artifacts, [])

            self.assertEqual(
                set(manifest.keys()),
                {
                    "job_id",
                    "uir_version",
                    "created_at",
                    "status",
                    "inputs",
                    "outputs",
                    "errors",
                },
            )
            for name in ("logs", "scene", "motion", "music", "preview", "export"):
                self.assertTrue((job_dir / name).is_dir())
            self.assertTrue((job_dir / "uir.json").is_file())
            self.assertTrue((job_dir / "manifest.json").is_file())
            self.assertEqual(manifest["job_id"], job_id)
            self.assertEqual(manifest["status"], "DONE")

            outputs = manifest["outputs"]
            self.assertEqual(
                outputs["scene"]["panorama"]["uri"],
                f"/assets/{job_id}/scene/panorama.png",
            )
            self.assertEqual(
                outputs["motion"]["bvh"]["uri"],
                f"/assets/{job_id}/motion/motion.bvh",
            )
            self.assertEqual(
                outputs["music"]["wav"]["uri"],
                f"/assets/{job_id}/music/music.wav",
            )
            self.assertEqual(
                outputs["preview"]["config"]["uri"],
                f"/assets/{job_id}/preview/preview_config.json",
            )
            self.assertEqual(
                outputs["export"]["mp4"]["uri"],
                f"/assets/{job_id}/export/final.mp4",
            )
            self.assertIsNone(outputs["export"]["zip"])

    def test_list_jobs_reads_manifest(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "assets"
            job_id = "job_list_1"
            job_dir = ensure_job_dirs(base_dir, job_id)
            uir = _base_uir(job_id)
            write_manifest(job_dir, uir, "DONE", [], [])

            manifests = list_jobs(base_dir)

            self.assertEqual(len(manifests), 1)
            self.assertEqual(manifests[0]["job_id"], job_id)


if __name__ == "__main__":
    unittest.main()
