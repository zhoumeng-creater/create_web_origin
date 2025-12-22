from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Tuple

if TYPE_CHECKING:
    from pydantic import ValidationError
else:
    try:
        from pydantic.v1 import ValidationError
    except ImportError:  # pragma: no cover - pydantic v1 fallback
        from pydantic import ValidationError

from .models import KNOWN_MODULES, UIR


class UIRValidationError(ValueError):
    def __init__(self, errors: List[Dict[str, Any]]) -> None:
        self.errors = errors
        message = _format_validation_errors(errors)
        super().__init__(message)


def validate_uir(uir: Dict[str, Any]) -> None:
    parse_uir(uir)


def parse_uir(uir: Dict[str, Any]) -> UIR:
    try:
        model = UIR.parse_obj(uir)
    except ValidationError as exc:
        raise UIRValidationError(_errors_from_pydantic(exc)) from exc

    semantic_errors = _semantic_errors(model)
    if semantic_errors:
        raise UIRValidationError(semantic_errors)
    return model


def _semantic_errors(model: UIR) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    targets = set(model.intent.targets or [])
    modules = model.modules
    for name in KNOWN_MODULES:
        module = getattr(modules, name, None)
        if module and getattr(module, "enabled", False) and name not in targets:
            errors.append(
                {
                    "loc": ["modules", name, "enabled"],
                    "msg": "enabled module must be listed in intent.targets",
                    "type": "value_error.missing_target",
                }
            )
    return errors


def _errors_from_pydantic(error: ValidationError) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    for entry in error.errors():
        loc = _normalize_loc(entry.get("loc", ()))
        errors.append(
            {
                "loc": loc,
                "msg": entry.get("msg", "invalid value"),
                "type": entry.get("type", "value_error"),
            }
        )
    return errors


def _normalize_loc(loc: Tuple[Any, ...]) -> List[str]:
    normalized: List[str] = []
    for part in loc:
        name = "input" if part == "input_" else str(part)
        normalized.append(name)
    return normalized


def _format_validation_errors(errors: List[Dict[str, Any]]) -> str:
    if not errors:
        return "UIR validation failed"
    parts: List[str] = []
    for entry in errors:
        loc = entry.get("loc") or []
        msg = entry.get("msg", "invalid value")
        if loc:
            parts.append(f"{'.'.join(loc)}: {msg}")
        else:
            parts.append(msg)
    return "UIR validation failed: " + "; ".join(parts)
