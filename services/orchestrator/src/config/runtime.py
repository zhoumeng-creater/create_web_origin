import os
from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_RUNTIME_DIR = _REPO_ROOT / "runtime"


@dataclass(frozen=True)
class RuntimePaths:
    runtime_dir: Path
    assets_dir: Path
    cache_dir: Path
    logs_dir: Path


def _ensure_dirs(*paths: Path) -> None:
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)


def get_runtime_paths() -> RuntimePaths:
    runtime_dir = Path(
        os.getenv("ORCH_RUNTIME_DIR", str(_DEFAULT_RUNTIME_DIR))
    ).expanduser()
    if not runtime_dir.is_absolute():
        runtime_dir = _REPO_ROOT / runtime_dir
    try:
        runtime_dir = runtime_dir.resolve()
    except OSError:
        runtime_dir = runtime_dir.absolute()
    assets_dir = runtime_dir / "assets"
    cache_dir = runtime_dir / "cache"
    logs_dir = runtime_dir / "logs"
    _ensure_dirs(runtime_dir, assets_dir, cache_dir, logs_dir)
    return RuntimePaths(
        runtime_dir=runtime_dir,
        assets_dir=assets_dir,
        cache_dir=cache_dir,
        logs_dir=logs_dir,
    )
