# Orchestrator Local Smoke Test

This is a minimal end-to-end flow to verify job creation, SSE events, and
generated assets (manifest + preview_config).

1) Start the orchestrator:

```bash
set ORCH_RUNTIME_DIR=runtime
python -m uvicorn services.orchestrator.src.main:app --reload --port 8000
```

2) Create a job (UIR required):

```bash
curl -X POST "http://localhost:8000/api/jobs" ^
  -H "Content-Type: application/json" ^
  -d "{\"uir_version\":\"1.0\",\"job\":{\"id\":\"job_placeholder\",\"created_at\":\"2025-12-20T00:00:00Z\"},\"input\":{\"raw_prompt\":\"A warrior dashes forward\",\"lang\":\"en\"},\"intent\":{\"targets\":[\"scene\",\"motion\",\"music\",\"preview\"],\"duration_s\":12},\"routing\":{\"scene\":{\"provider\":\"diffusion360_local\"},\"motion\":{\"provider\":\"animationgpt_local\"},\"music\":{\"provider\":\"musicgpt_cli\"},\"preview\":{\"provider\":\"web_threejs\"}},\"modules\":{\"scene\":{\"enabled\":true,\"prompt\":\"A cinematic 360 panorama\",\"resolution\":[2048,1024]},\"motion\":{\"enabled\":true,\"prompt\":\"walk cycle\",\"fps\":30},\"music\":{\"enabled\":true,\"prompt\":\"ambient pad\"},\"character\":{\"enabled\":true,\"character_id\":\"samurai_01\"},\"preview\":{\"enabled\":true,\"camera_preset\":\"orbit\",\"autoplay\":true},\"export\":{\"enabled\":false}}}"
```

The response returns `{ "job_id": "..." }`.

3) Stream events:

```bash
curl -N "http://localhost:8000/api/jobs/<job_id>/events"
```

4) Verify outputs:

```bash
curl "http://localhost:8000/assets/<job_id>/manifest.json"
curl "http://localhost:8000/assets/<job_id>/preview/preview_config.json"
```

Notes:
- `motion` uses `animationgpt_local`; make sure its dependencies are available.
- `scene`/`music` can use real adapters (Diffusion360/MusicGPT) when configured.
- To export MP4, enable `modules.export.enabled=true` and include `"export"` in
  `intent.targets`, then set `FFMPEG_BIN` and `PYTHON_MP4_EXE` so the renderer
  can run `third_party/AnimationGPT/tools/animation.py`.
- If Diffusion360 is installed in a separate conda env, set `DIFFUSION360_PYTHON`
  to that env's `python.exe` so the adapter runs it out-of-process.
- On Windows, Linux-style paths (e.g. `/home/.../python`) trigger WSL execution.
  Set `WSL_DISTRO` to pick the distro if it is not `Ubuntu`.
