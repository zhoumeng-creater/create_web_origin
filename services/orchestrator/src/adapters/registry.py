from __future__ import annotations

from typing import Dict, Iterable, List

from .animationgpt import AnimationGPTAdapter
from .base import ModelAdapter
from .builtin_character import BuiltinCharacterSelector
from .dummy import DummyAdapter
from .dummy_media import DummyMusicAdapter, DummySceneAdapter
from .diffusion360 import Diffusion360Adapter
from .ffmpeg_export import FfmpegExportAdapter
from .musicgpt_cli import MusicGPTCliAdapter
from .preview import PreviewConfigBuilder

class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: Dict[str, List[ModelAdapter]] = {}

    def register(self, adapter: ModelAdapter) -> None:
        provider_id = getattr(adapter, "provider_id", "")
        if not isinstance(provider_id, str) or not provider_id:
            raise ValueError("adapter provider_id is required")
        self._adapters.setdefault(provider_id, []).append(adapter)

    def get(self, provider_id: str) -> ModelAdapter:
        adapters = self._adapters.get(provider_id)
        if not adapters:
            raise KeyError(provider_id)
        return adapters[-1]

    def providers(self) -> Iterable[str]:
        return tuple(self._adapters.keys())


_REGISTRY = AdapterRegistry()


def register_adapter(adapter: ModelAdapter) -> None:
    _REGISTRY.register(adapter)


def get_adapter(provider_id: str) -> ModelAdapter:
    return _REGISTRY.get(provider_id)


def list_adapters() -> Iterable[str]:
    return _REGISTRY.providers()


def _register_defaults() -> None:
    register_adapter(DummyAdapter())
    register_adapter(AnimationGPTAdapter())
    register_adapter(BuiltinCharacterSelector())
    register_adapter(PreviewConfigBuilder())
    register_adapter(MusicGPTCliAdapter())
    register_adapter(Diffusion360Adapter())
    register_adapter(FfmpegExportAdapter())
    register_adapter(DummySceneAdapter())
    register_adapter(DummyMusicAdapter())


_register_defaults()
