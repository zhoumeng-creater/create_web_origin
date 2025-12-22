# apps/web

## Setup

Install dependencies (npm):

```bash
npm install
```

## Development

```bash
npm run dev
```

Build/preview:

```bash
npm run build
npm run preview
```

## Backend proxy (dev)

- Backend default: `http://localhost:8000`
- Vite proxy forwards `/api` and `/assets` to the backend (configure via `VITE_DEV_PROXY_TARGET`)
- `VITE_API_BASE` stays empty by default to use same-origin URLs in the app

## Mock mode

Set `VITE_USE_MOCK=1` before running the dev server to enable local mock assets and simulated job events.

Mock assets live under `apps/web/public/mock/assets/demo_job` and mirror `/assets/<job_id>` paths.

### Demo flow

1. Start the frontend normally (same command you already use for apps/web).
2. Open the Create page at `/`.
3. Enter `demo_job` as the Job ID and click "Load preview".
4. If you wire the create flow, `createJob` returns `demo_job` and SSE events will advance through PLANNING -> RUNNING_MOTION -> RUNNING_SCENE -> RUNNING_MUSIC -> DONE.
