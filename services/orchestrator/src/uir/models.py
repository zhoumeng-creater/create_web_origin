from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union

try:
    from pydantic.v1 import (
        BaseModel,
        Field,
        ValidationError,
        conint,
        conlist,
        confloat,
        constr,
    )
except ImportError:  # pragma: no cover - pydantic v1 fallback
    from pydantic import (
        BaseModel,
        Field,
        ValidationError,
        conint,
        conlist,
        confloat,
        constr,
    )

Targets = conlist(
    Literal["scene", "motion", "music"],
    min_items=1,
    unique_items=True,
)
Resolution = conlist(conint(ge=1), min_items=2, max_items=2)


class UIRBase(BaseModel):
    class Config:
        extra = "forbid"
        allow_population_by_field_name = True


class Project(UIRBase):
    title: constr(min_length=1)
    created_at: datetime


class Input(UIRBase):
    raw_prompt: constr(min_length=1)
    lang: constr(min_length=2)


class Intent(UIRBase):
    duration_s: confloat(ge=1) = 12
    style: constr(min_length=1)
    mood: constr(min_length=1)
    targets: Targets = Field(default_factory=lambda: ["scene", "motion", "music"])


class Scene(UIRBase):
    provider: constr(min_length=1) = "diffusion360"
    prompt: constr(min_length=1)
    negative: Optional[str] = None
    resolution: Resolution
    seed: Optional[conint(ge=0)] = None
    steps: Optional[conint(ge=1)] = None
    cfg: Optional[confloat(ge=0)] = None


class Motion(UIRBase):
    provider: constr(min_length=1) = "animationgpt"
    prompt: constr(min_length=1)
    fps: conint(ge=1) = 30
    length_s: confloat(ge=1)
    seed: Optional[conint(ge=0)] = None


class Music(UIRBase):
    provider: constr(min_length=1) = "musicgpt"
    prompt: constr(min_length=1)
    secs: confloat(ge=1)
    bpm: Optional[confloat(ge=1)] = None
    seed: Optional[conint(ge=0)] = None


class Output(UIRBase):
    need_preview: bool
    need_export_video: bool
    export_preset: constr(min_length=1)


class UIR(UIRBase):
    project: Project
    input_: Input = Field(..., alias="input")
    intent: Intent
    scene: Scene
    motion: Motion
    music: Music
    output: Output


def validate_uir(uir_dict: Dict[str, Any]) -> UIR:
    try:
        return UIR.parse_obj(uir_dict)
    except ValidationError as exc:
        raise ValueError(_format_validation_error(exc)) from exc


def uir_hash(uir_dict: Union[UIR, Dict[str, Any]]) -> str:
    model = uir_dict if isinstance(uir_dict, UIR) else validate_uir(uir_dict)
    canonical = _canonical_dict(model)
    payload = json.dumps(
        canonical,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _canonical_dict(model: UIR) -> Dict[str, Any]:
    data = json.loads(model.json(by_alias=True, exclude_none=True))
    return _strip_keys(data, {"created_at"})


def _strip_keys(value: Any, drop_keys: Set[str]) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_keys(item, drop_keys)
            for key, item in value.items()
            if key not in drop_keys
        }
    if isinstance(value, list):
        return [_strip_keys(item, drop_keys) for item in value]
    return value


def _format_validation_error(error: ValidationError) -> str:
    parts: List[str] = []
    for entry in error.errors():
        loc = ".".join(_normalize_loc(entry.get("loc", ())))
        msg = entry.get("msg", "invalid value")
        parts.append(f"{loc}: {msg}")
    return "UIR validation failed: " + "; ".join(parts)


def _normalize_loc(loc: Tuple[Any, ...]) -> List[str]:
    normalized: List[str] = []
    for part in loc:
        name = "input" if part == "input_" else str(part)
        normalized.append(name)
    return normalized
