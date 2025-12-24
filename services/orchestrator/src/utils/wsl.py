from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple, Union

_UNC_PREFIXES = (r"\\wsl.localhost\\", r"\\wsl$\\")


def should_use_wsl(python_exe: str) -> bool:
    return os.name == "nt" and is_wsl_path(python_exe)


def is_wsl_path(value: str) -> bool:
    if not isinstance(value, str):
        return False
    if value.startswith(("/", "~")):
        return True
    lowered = value.lower()
    return any(lowered.startswith(prefix) for prefix in _UNC_PREFIXES)


def to_wsl_path(value: Union[str, Path]) -> str:
    if isinstance(value, Path):
        value = str(value)
    if not value:
        return ""
    normalized = _normalize_wsl_unc(value)
    if normalized:
        return normalized
    if value.startswith(("/", "~")):
        return value
    path = Path(value)
    if path.drive:
        drive = path.drive.rstrip(":").lower()
        posix = path.as_posix()
        if ":" in posix:
            posix = posix.split(":", 1)[1]
        return f"/mnt/{drive}{posix}"
    return value.replace("\\", "/")


def build_wsl_command(
    args: Iterable[str],
    env: Optional[Dict[str, str]] = None,
    distro: Optional[str] = None,
    cwd: Optional[str] = None,
) -> List[str]:
    cmd: List[str] = ["wsl.exe"]
    if distro:
        cmd += ["-d", distro]
    if cwd:
        cmd += ["--cd", cwd]
    cmd.append("--")
    if env:
        cmd.append("env")
        for key, value in env.items():
            if value is None:
                continue
            cmd.append(f"{key}={value}")
    cmd.extend(list(args))
    return cmd


def wsl_distro() -> str:
    return os.getenv("WSL_DISTRO") or os.getenv("WSL_DISTRIBUTION") or "Ubuntu"


def _normalize_wsl_unc(value: str) -> Optional[str]:
    lowered = value.lower()
    for prefix in _UNC_PREFIXES:
        if lowered.startswith(prefix):
            tail = value[len(prefix) :].lstrip("\\/")
            tail = tail.replace("\\", "/")
            parts = tail.split("/", 1)
            if len(parts) == 2:
                return "/" + parts[1].lstrip("/")
            return "/" + tail.lstrip("/")
    return None
