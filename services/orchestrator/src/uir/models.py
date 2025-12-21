from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple, Literal

try:
    from pydantic.v1 import (
        BaseModel,
        Field,
        conint,
        conlist,
        confloat,
        constr,
        root_validator,
        validator,
    )
except ImportError:  # pragma: no cover - pydantic v1 fallback
    from pydantic import (
        BaseModel,
        Field,
        conint,
        conlist,
        confloat,
        constr,
        root_validator,
        validator,
    )

Targets = conlist(constr(min_length=1), min_items=1, unique_items=True)
Resolution = conlist(conint(ge=1), min_items=2, max_items=2)
ExportResolution = conlist(conint(ge=1), min_items=2, max_items=2)

KNOWN_MODULES: Tuple[str, ...] = (
    "scene",
    "motion",
    "music",
    "character",
    "preview",
    "export",
)


class UIRBase(BaseModel):
    class Config:
        extra = "allow"
        allow_population_by_field_name = True


class AssetRef(UIRBase):
    id: constr(min_length=1)
    role: constr(min_length=1)
    mime: constr(min_length=1)
    uri: constr(min_length=1)
    sha256: Optional[constr(min_length=1)] = None
    bytes: Optional[conint(ge=0)] = None
    meta: Optional[Dict[str, Any]] = None


class Job(UIRBase):
    id: constr(min_length=1)
    created_at: datetime
    title: Optional[constr(min_length=1)] = None
    client: Optional[Dict[str, Any]] = None
    tags: Optional[List[constr(min_length=1)]] = None
    parent_job_id: Optional[constr(min_length=1)] = None


class Input(UIRBase):
    raw_prompt: constr(min_length=1)
    lang: Optional[constr(min_length=2)] = None
    references: Optional[List[AssetRef]] = None
    ui_choices: Optional[Dict[str, Any]] = None


class Intent(UIRBase):
    targets: Targets
    duration_s: confloat(ge=1) = 12
    style: Optional[constr(min_length=1)] = None
    mood: Optional[constr(min_length=1)] = None
    storybeat: Optional[constr(min_length=1)] = None
    language_policy: Optional[Dict[str, Any]] = None


class RoutingItem(UIRBase):
    provider: Optional[constr(min_length=1)] = None


class Routing(UIRBase):
    scene: Optional[RoutingItem] = None
    motion: Optional[RoutingItem] = None
    music: Optional[RoutingItem] = None
    character: Optional[RoutingItem] = None
    preview: Optional[RoutingItem] = None
    export: Optional[RoutingItem] = None


class Scene(UIRBase):
    enabled: bool = False
    prompt: Optional[constr(min_length=1)] = None
    negative_prompt: Optional[str] = None
    resolution: Resolution = Field(default_factory=lambda: [2048, 1024])
    seed: Optional[conint(ge=0)] = None
    steps: Optional[conint(ge=1)] = None
    cfg_scale: Optional[confloat(ge=0)] = None
    upscale: Optional[bool] = None
    output: Optional[Dict[str, Any]] = None

    @validator("resolution")
    def _validate_resolution(cls, value: List[int]) -> List[int]:
        if value[0] != value[1] * 2:
            raise ValueError("resolution width must be 2x height")
        return value


class Motion(UIRBase):
    enabled: bool = False
    prompt: Optional[constr(min_length=1)] = None
    duration_s: Optional[confloat(ge=1)] = None
    fps: conint(ge=15, le=60) = 30
    style: Optional[constr(min_length=1)] = None
    action_params: Optional[Dict[str, Any]] = None
    postprocess: Optional[Dict[str, Any]] = None


class Music(UIRBase):
    enabled: bool = False
    prompt: Optional[constr(min_length=1)] = None
    duration_s: Optional[confloat(ge=1)] = None
    tempo_bpm: Optional[confloat(ge=1)] = None
    genre: Optional[constr(min_length=1)] = None
    output: Optional[Dict[str, Any]] = None


class Character(UIRBase):
    enabled: bool = False
    character_id: Optional[constr(min_length=1)] = None
    style: Optional[constr(min_length=1)] = None
    retarget: Optional[Dict[str, Any]] = None


class Preview(UIRBase):
    enabled: bool = False
    camera_preset: Optional[constr(min_length=1)] = None
    autoplay: Optional[bool] = None
    timeline: Optional[Dict[str, Any]] = None


class Export(UIRBase):
    enabled: bool = False
    format: Optional[constr(min_length=1)] = None
    resolution: Optional[ExportResolution] = None
    fps: Optional[conint(ge=1)] = None
    bitrate: Optional[constr(min_length=1)] = None
    include: Optional[List[constr(min_length=1)]] = None


class Modules(UIRBase):
    scene: Scene = Field(default_factory=Scene)
    motion: Motion = Field(default_factory=Motion)
    music: Music = Field(default_factory=Music)
    character: Character = Field(default_factory=Character)
    preview: Preview = Field(default_factory=Preview)
    export: Export = Field(default_factory=Export)

    def enabled_targets(self) -> Set[str]:
        enabled: Set[str] = set()
        for name in KNOWN_MODULES:
            module = getattr(self, name, None)
            if module and getattr(module, "enabled", False):
                enabled.add(name)
        return enabled


class Constraints(UIRBase):
    max_runtime_s: Optional[confloat(ge=1)] = None
    quality: Optional[constr(min_length=1)] = None
    safety: Optional[Dict[str, Any]] = None


class Runtime(UIRBase):
    priority: Optional[conint(ge=0, le=10)] = None
    concurrency_key: Optional[constr(min_length=1)] = None
    locks: Optional[Dict[str, Any]] = None
    fallback: Optional[Dict[str, Any]] = None
    cache_policy: Optional[Dict[str, Any]] = None


class Hooks(UIRBase):
    event_stream: Optional[bool] = None


class UIR(UIRBase):
    uir_version: Literal["1.0"]
    job: Job
    input_: Input = Field(..., alias="input")
    intent: Intent
    routing: Optional[Routing] = None
    modules: Modules
    constraints: Optional[Constraints] = None
    runtime: Optional[Runtime] = None
    hooks: Optional[Hooks] = None

    @root_validator(skip_on_failure=True)
    def _apply_duration_defaults(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        intent = values.get("intent")
        modules = values.get("modules")
        if not intent or not modules:
            return values
        duration = getattr(intent, "duration_s", None)
        if duration is None:
            return values
        motion = getattr(modules, "motion", None)
        if motion is not None and motion.duration_s is None and motion.enabled:
            motion.duration_s = duration
        music = getattr(modules, "music", None)
        if music is not None and music.duration_s is None and music.enabled:
            music.duration_s = duration
        return values
