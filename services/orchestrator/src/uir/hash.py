from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Set, Union

from .models import UIR
from .validate import parse_uir


def stable_hash(uir: Union[UIR, Dict[str, Any]]) -> str:
    model = uir if isinstance(uir, UIR) else parse_uir(uir)
    canonical = _canonical_dict(model)
    payload = json.dumps(
        canonical,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def uir_hash(uir: Union[UIR, Dict[str, Any]]) -> str:
    return stable_hash(uir)


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
