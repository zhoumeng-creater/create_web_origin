from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .base import AdapterResult, BaseAdapter, ProgressReporter, build_asset_ref, build_error
from ..config.runtime import get_runtime_paths
from ..uir.validate import validate_uir

_STATIC_CHARACTER_BASE_ENV = "ORCH_CHARACTER_STATIC_BASE"
_DEFAULT_STATIC_CHARACTER_BASE = "/static/characters"
_DEFAULT_CHARACTER_ID = "samurai_01"
_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class CharacterEntry:
    character_id: str
    tags: Tuple[str, ...]
    model_uri: Optional[str] = None
    skeleton: str = "SMPL_22"
    scale: float = 1.0

    def resolved_model_uri(self, base_uri: str) -> str:
        if self.model_uri:
            return self.model_uri
        base_uri = base_uri.rstrip("/")
        if not base_uri:
            base_uri = _DEFAULT_STATIC_CHARACTER_BASE
        return f"{base_uri}/{self.character_id}.glb"


_CHARACTER_LIBRARY: Tuple[CharacterEntry, ...] = (
    CharacterEntry(
        character_id="samurai_01",
        tags=("samurai", "warrior", "action", "epic", "cinematic", "fight"),
    ),
    CharacterEntry(
        character_id="anime_01",
        tags=("anime", "manga", "stylized", "cute"),
    ),
    CharacterEntry(
        character_id="toon_01",
        tags=("cartoon", "toon", "stylized", "playful"),
    ),
    CharacterEntry(
        character_id="lowpoly_01",
        tags=("lowpoly", "stylized", "playful"),
    ),
    CharacterEntry(
        character_id="realistic_01",
        tags=("realistic", "photoreal", "cinematic", "modern"),
    ),
)

_CHARACTER_INDEX = {entry.character_id: entry for entry in _CHARACTER_LIBRARY}


class BuiltinCharacterSelector(BaseAdapter):
    provider_id = "builtin_library"
    modality = "character"
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(_normalized_uir_for_validation(uir))
        character = _character_section(uir)
        if not character.get("enabled", False):
            raise ValueError("modules.character.enabled must be true")

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        warnings: List[str] = []
        job_id = ""
        try:
            job_id = _job_id_from_uir(uir)
        except ValueError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error("E_VALIDATION_INPUT", str(exc), retryable=False),
            )

        log_path = _resolve_log_path(out_dir, job_id)
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return _error_result(
                self.provider_id,
                warnings,
                build_error(
                    "E_IO_WRITE",
                    "failed to create log directory",
                    detail={"path": str(log_path.parent), "error": str(exc)},
                    retryable=True,
                ),
            )

        with log_path.open("a", encoding="utf-8") as log_handle:
            try:
                self.validate(uir)
            except Exception as exc:
                _log_line(log_handle, f"[validate] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_VALIDATION_INPUT",
                        "validation failed",
                        detail={"error": str(exc)},
                        retryable=False,
                    ),
                )

            output_dir: Optional[Path] = None
            try:
                output_dir = self.output_dir(out_dir)
                _assert_dir_writable(output_dir)
            except OSError as exc:
                _log_line(log_handle, f"[io] {exc}")
                return _error_result(
                    self.provider_id,
                    warnings,
                    build_error(
                        "E_IO_WRITE",
                        "output directory is not writable",
                        detail={"path": str(output_dir or out_dir), "error": str(exc)},
                        retryable=True,
                    ),
                )

            reporter.stage("select", 0.2, "selecting built-in character")
            selection = _select_character(uir, warnings, log_handle)
            manifest = {
                "character_id": selection.character_id,
                "model_uri": selection.model_uri,
                "skeleton": selection.skeleton,
                "scale": selection.scale,
                "notes": list(selection.notes),
            }
            manifest_path = output_dir / "character_manifest.json"
            try:
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=True, indent=2),
                    encoding="utf-8",
                )
            except OSError as exc:
                _log_line(log_handle, f"[io] {exc}")
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

            artifact = build_asset_ref(
                manifest_path,
                job_id,
                "character_manifest",
                "application/json",
                meta={"character_id": selection.character_id},
            )
            reporter.stage("done", 1.0, "character manifest ready")
            return {
                "ok": True,
                "provider": self.provider_id,
                "artifacts": [artifact],
                "meta": {"character_id": selection.character_id},
                "warnings": warnings,
                "error": None,
            }


@dataclass(frozen=True)
class _SelectionResult:
    character_id: str
    model_uri: str
    skeleton: str
    scale: float
    notes: Sequence[str]


def _select_character(
    uir: Dict[str, Any], warnings: List[str], log_handle: Any
) -> _SelectionResult:
    character = _character_section(uir)
    requested_id = _string_value(character.get("character_id"))
    base_uri = _static_character_base()
    if requested_id:
        entry = _CHARACTER_INDEX.get(requested_id)
        if entry is None:
            warnings.append(
                f"character_id '{requested_id}' not found in builtin library; using static path"
            )
            entry = CharacterEntry(character_id=requested_id, tags=tuple())
        model_uri = entry.resolved_model_uri(base_uri)
        _log_line(log_handle, f"[select] requested character_id={requested_id}")
        return _SelectionResult(
            character_id=entry.character_id,
            model_uri=model_uri,
            skeleton=entry.skeleton,
            scale=entry.scale,
            notes=("selected_by=character_id",),
        )

    tokens = _selection_tokens(uir)
    if tokens:
        entry, matched = _best_match(tokens)
        if entry is not None and matched:
            _log_line(
                log_handle,
                f"[select] matched tags={sorted(matched)} -> {entry.character_id}",
            )
            return _SelectionResult(
                character_id=entry.character_id,
                model_uri=entry.resolved_model_uri(base_uri),
                skeleton=entry.skeleton,
                scale=entry.scale,
                notes=(f"selected_by=tags:{','.join(sorted(matched))}",),
            )
        warnings.append("no tag match found; using default character")

    entry = _default_character()
    _log_line(log_handle, f"[select] default character_id={entry.character_id}")
    return _SelectionResult(
        character_id=entry.character_id,
        model_uri=entry.resolved_model_uri(base_uri),
        skeleton=entry.skeleton,
        scale=entry.scale,
        notes=("selected_by=default",),
    )


def _best_match(tokens: Set[str]) -> Tuple[Optional[CharacterEntry], Set[str]]:
    best_entry: Optional[CharacterEntry] = None
    best_matches: Set[str] = set()
    for entry in _CHARACTER_LIBRARY:
        entry_tags = set(entry.tags)
        matches = entry_tags & tokens
        if len(matches) > len(best_matches):
            best_entry = entry
            best_matches = matches
    return best_entry, best_matches


def _static_character_base() -> str:
    value = os.getenv(_STATIC_CHARACTER_BASE_ENV, _DEFAULT_STATIC_CHARACTER_BASE)
    value = value.strip()
    if not value:
        return _DEFAULT_STATIC_CHARACTER_BASE
    return value


def _selection_tokens(uir: Dict[str, Any]) -> Set[str]:
    tokens: Set[str] = set()
    character = _character_section(uir)
    motion = _motion_section(uir)
    intent = _intent_section(uir)
    tokens |= _tokenize(character.get("style"))
    tokens |= _tokenize(motion.get("style"))
    tokens |= _tokenize(intent.get("style"))
    tokens |= _tokenize(intent.get("mood"))
    return tokens


def _tokenize(value: Any) -> Set[str]:
    if not isinstance(value, str):
        return set()
    text = value.strip().lower()
    if not text:
        return set()
    tokens = {token for token in _TOKEN_SPLIT.split(text) if token}
    collapsed = re.sub(r"[^a-z0-9]", "", text)
    if collapsed and collapsed not in tokens:
        tokens.add(collapsed)
    return tokens


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _default_character() -> CharacterEntry:
    entry = _CHARACTER_INDEX.get(_DEFAULT_CHARACTER_ID)
    if entry is not None:
        return entry
    if _CHARACTER_LIBRARY:
        return _CHARACTER_LIBRARY[0]
    raise ValueError("builtin character library is empty")


def _normalized_uir_for_validation(uir: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(uir, dict):
        return uir
    modules = uir.get("modules")
    if not isinstance(modules, dict):
        return uir
    character = modules.get("character")
    if not isinstance(character, dict):
        return uir
    character_id = character.get("character_id")
    if isinstance(character_id, str) and not character_id.strip():
        uir_copy = dict(uir)
        modules_copy = dict(modules)
        character_copy = dict(character)
        character_copy.pop("character_id", None)
        modules_copy["character"] = character_copy
        uir_copy["modules"] = modules_copy
        return uir_copy
    return uir


def _character_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        character = modules.get("character")
        if isinstance(character, dict):
            return character
    return {}


def _motion_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    modules = uir.get("modules")
    if isinstance(modules, dict):
        motion = modules.get("motion")
        if isinstance(motion, dict):
            return motion
    return {}


def _intent_section(uir: Dict[str, Any]) -> Dict[str, Any]:
    intent = uir.get("intent")
    if isinstance(intent, dict):
        return intent
    return {}


def _job_id_from_uir(uir: Dict[str, Any]) -> str:
    job = uir.get("job")
    if isinstance(job, dict):
        job_id = job.get("id")
        if job_id:
            return str(job_id)
    raise ValueError("missing job.id")


def _assert_dir_writable(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".write_check"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()


def _resolve_log_path(out_dir: Path, job_id: str) -> Path:
    job_dir = _find_job_dir(out_dir, job_id)
    if job_dir is not None:
        return job_dir / "logs" / "character.log"
    return out_dir.parent / "logs" / "character.log"


def _find_job_dir(out_dir: Path, job_id: str) -> Optional[Path]:
    if not job_id:
        return None
    for parent in (out_dir, *out_dir.parents):
        if parent.name == job_id:
            return parent
    runtime_paths = get_runtime_paths()
    candidate = runtime_paths.assets_dir / job_id
    if candidate.exists():
        return candidate
    return None


def _log_line(handle: Any, line: str) -> None:
    handle.write(line.rstrip() + "\n")
    handle.flush()


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
