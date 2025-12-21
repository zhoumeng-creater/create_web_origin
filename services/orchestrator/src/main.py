from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .api.router import router as api_router
from .config.runtime import get_runtime_paths


def create_app() -> FastAPI:
    app = FastAPI()

    # TODO: Restrict origins to apps/web dev ports once known.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    runtime_paths = get_runtime_paths()
    app.mount("/assets", StaticFiles(directory=runtime_paths.assets_dir), name="assets")

    @app.get("/healthz", response_class=PlainTextResponse)
    def healthz() -> str:
        return "ok"

    return app


app = create_app()
