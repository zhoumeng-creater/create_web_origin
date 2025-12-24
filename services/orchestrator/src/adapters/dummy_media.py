from __future__ import annotations

import struct
import wave
import zlib
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


class DummySceneAdapter(BaseAdapter):
    provider_id = "dummy_scene"
    modality = "scene"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        warnings = ["dummy output"]
        try:
            job_id = _job_id_from_uir(uir)
        except ValueError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error("E_VALIDATION_INPUT", str(exc), retryable=False),
            )
        output_dir = self.output_dir(out_dir)
        reporter.stage("prepare", 0.2, "building dummy panorama")
        panorama_path = output_dir / "panorama.png"
        try:
            _write_dummy_png(panorama_path, 2, 1)
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write panorama.png",
                    detail={"path": str(panorama_path), "error": str(exc)},
                    retryable=True,
                ),
            )
        reporter.stage("finalize", 1.0, "dummy panorama ready")
        artifact = build_asset_ref(
            panorama_path,
            job_id,
            "scene_panorama",
            "image/png",
            meta={"dummy": True},
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"dummy": True},
            "warnings": warnings,
            "error": None,
        }


class DummyMusicAdapter(BaseAdapter):
    provider_id = "dummy_music"
    modality = "music"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        warnings = ["dummy output"]
        try:
            job_id = _job_id_from_uir(uir)
        except ValueError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error("E_VALIDATION_INPUT", str(exc), retryable=False),
            )
        output_dir = self.output_dir(out_dir)
        reporter.stage("prepare", 0.2, "building dummy music")
        music_path = output_dir / "music.wav"
        duration_s = _duration_from_uir(uir) or 1.0
        try:
            _write_dummy_wav(music_path, duration_s=duration_s, sample_rate=22050)
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to write music.wav",
                    detail={"path": str(music_path), "error": str(exc)},
                    retryable=True,
                ),
            )
        reporter.stage("finalize", 1.0, "dummy music ready")
        artifact = build_asset_ref(
            music_path,
            job_id,
            "music_wav",
            "audio/wav",
            meta={"dummy": True},
        )
        return {
            "ok": True,
            "provider": self.provider_id,
            "artifacts": [artifact],
            "meta": {"dummy": True, "duration_s": duration_s},
            "warnings": warnings,
            "error": None,
        }


def _write_dummy_png(path: Path, width: int, height: int) -> None:
    width = max(1, int(width))
    height = max(1, int(height))
    row = bytearray()
    row.append(0)
    for _ in range(width):
        row.extend((64, 128, 255, 255))
    raw = bytes(row) * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", zlib.compress(raw)),
            _png_chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(data)


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    length = struct.pack(">I", len(data))
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return length + chunk_type + data + struct.pack(">I", crc)


def _write_dummy_wav(path: Path, duration_s: float, sample_rate: int) -> None:
    duration_s = max(0.1, float(duration_s))
    sample_rate = max(8000, int(sample_rate))
    frames = int(duration_s * sample_rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frames)


def _duration_from_uir(uir: Dict[str, Any]) -> Optional[float]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        music = modules.get("music")
        if isinstance(music, dict):
            duration = music.get("duration_s")
            if isinstance(duration, (int, float)):
                return float(duration)
    intent = uir.get("intent")
    if isinstance(intent, dict):
        duration = intent.get("duration_s")
        if isinstance(duration, (int, float)):
            return float(duration)
    return None


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
