# apps/web

## Mock mode

Set `VITE_USE_MOCK=1` before running the dev server to enable local mock assets and simulated job events.

Mock assets live under `apps/web/public/mock/assets/demo_job` and mirror `/assets/<job_id>` paths.

### Demo flow

1. Start the frontend normally (same command you already use for apps/web).
2. Open the Create page at `/`.
3. Enter `demo_job` as the Job ID and click "Load preview".
4. If you wire the create flow, `createJob` returns `demo_job` and SSE events will advance through PLANNING -> RUNNING_MOTION -> RUNNING_SCENE -> RUNNING_MUSIC -> DONE.
