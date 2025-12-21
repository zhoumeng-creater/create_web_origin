from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Tuple, TypedDict, Union

from ..storage.manifest import make_asset_url
from ..uir.validate import validate_uir

ERROR_CODE_PREFIXES = (
    "E_VALIDATION_",
    "E_DEPENDENCY_",
    "E_MODEL_RUNTIME",
    "E_TIMEOUT",
    "E_IO_",
    "E_UNSUPPORTED",
)


class AdapterError(TypedDict):
    code: str
    message: str
    detail: Dict[str, Any]
    retryable: bool


class AdapterResult(TypedDict):
    ok: bool
    provider: str
    artifacts: List[Dict[str, Any]]
    meta: Dict[str, Any]
    warnings: List[str]
    error: Optional[AdapterError]


def build_error(
    code: str,
    message: str,
    detail: Optional[Dict[str, Any]] = None,
    retryable: bool = False,
) -> AdapterError:
    return {
        "code": code,
        "message": message,
        "detail": detail or {},
        "retryable": retryable,
    }


class ProgressReporter(Protocol):
    def stage(
        self,
        name: str,
        progress: float,
        message: str = "",
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        ...

    def log(self, line: str) -> None:
        ...


class ModelAdapter(Protocol):
    provider_id: str
    modality: str
    max_concurrency: int

    def validate(self, uir: Dict[str, Any]) -> None:
        ...

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        ...


class BaseAdapter:
    provider_id = ""
    modality = ""
    max_concurrency = 1

    def validate(self, uir: Dict[str, Any]) -> None:
        validate_uir(uir)

    def run(
        self, uir: Dict[str, Any], out_dir: Path, reporter: ProgressReporter
    ) -> AdapterResult:
        raise NotImplementedError

    def output_dir(self, out_dir: Path) -> Path:
        return resolve_output_dir(out_dir, self.modality)


def resolve_output_dir(out_dir: Path, subdir: str) -> Path:
    # Disallow nested subpaths so adapters cannot escape out_dir.
    if not subdir or Path(subdir).name != subdir:
        raise ValueError("subdir must be a single path segment")
    output_dir = Path(out_dir) / subdir
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def build_asset_ref(
    file_path: Union[Path, str],
    job_id: str,
    role: str,
    mime: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    path = Path(file_path)
    rel_path = _relative_asset_path(path, job_id)
    asset: Dict[str, Any] = {
        "id": f"{job_id}:{role}",
        "role": role,
        "uri": make_asset_url(job_id, rel_path),
        "mime": mime,
    }
    if meta:
        asset["meta"] = dict(meta)
    if path.exists() and path.is_file():
        asset["bytes"] = path.stat().st_size
    return asset


def _relative_asset_path(path: Path, job_id: str) -> str:
    if path.is_absolute():
        rel_parts = _relative_parts_from_job_id(path.parts, job_id)
    else:
        rel_parts = list(path.parts)
        if rel_parts and _match_job_id(rel_parts[0], job_id):
            rel_parts = rel_parts[1:]
    if len(rel_parts) < 2:
        raise ValueError("asset path must be under out_dir/<subdir>/")
    return "/".join(rel_parts)


def _relative_parts_from_job_id(parts: Tuple[str, ...], job_id: str) -> List[str]:
    for idx, part in enumerate(parts):
        if _match_job_id(part, job_id):
            rel_parts = list(parts[idx + 1 :])
            return rel_parts
    raise ValueError(f"file_path must be under the job_id directory: {job_id}")


def _match_job_id(part: str, job_id: str) -> bool:
    return part == job_id or part.lower() == job_id.lower()
