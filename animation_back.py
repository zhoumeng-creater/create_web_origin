# animation_back.py — Anonymous, cleaned backend (drop /auth/*)
from __future__ import annotations
import os, sys, uuid, asyncio, time, shutil, subprocess
from pathlib import Path
from typing import Dict, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# =========================
# Base / CORS / Static
# =========================
BASE_DIR = Path(__file__).resolve().parent

# 可用环境变量控制：CORS_ORIGINS, PIPELINE_DIR, PYTHON_EXE
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
)
ALLOW_ORIGINS = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]

app = FastAPI(title="AnimationGPT Backend (anonymous)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路径：允许通过环境变量覆盖
OUTPUT_ROOT = (BASE_DIR / "animation-web" / "animation-web" / "frontend" / "public" / "outputs" ).resolve()
PIPELINE_DIR = Path(os.getenv("PIPELINE_DIR", r"C:\Users\MotionGPT"))
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
ANIMATION_PY   = Path(r"C:\Users\MotionGPT\tools\animation.py")
PYTHON_MP4_EXE = os.getenv("PYTHON_MP4_EXE", r"C:\ProgramData\anaconda3\envs\mpl333-py39\python.exe")
FFMPEG_BIN     = os.getenv("FFMPEG_BIN", r"C:\Program Files\ffmpeg-8.0-essentials_build\ffmpeg-8.0-essentials_build\bin\ffmpeg.exe")

# 指向你的脚本
DEMO_PY   = PIPELINE_DIR / "demo.py"
CFG_YAML  = PIPELINE_DIR / "config_AGPT.yaml"
J2BVH_DIR = PIPELINE_DIR / "tools" / "npy2bvh"
J2BVH_PY  = J2BVH_DIR / "joints2bvh.py"

PYTHON_EXE = os.getenv("PYTHON_EXE", r"C:\Users\anaconda3\envs\AniGPTcp39cu118\python.exe")

# Static 挂载（与原项目兼容）
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_ROOT)), name="outputs")
app.mount("/tools_bvh", StaticFiles(directory=str(J2BVH_DIR / "bvh_folder")), name="tools_bvh")

# =========================
# Jobs & WebSocket
# =========================
JOBS: Dict[str, Dict] = {}           # job_id -> {status, progress, type, text, ...}
WS_CONN: Dict[str, Set[WebSocket]] = {}  # job_id -> set(WebSocket)

class CreateJobIn(BaseModel):
    type: str   # "mp4" | "bvh" | etc.
    text: str
    params: dict | None = None

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/jobs")
async def create_job(payload: CreateJobIn):
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {
        "status": "QUEUED",
        "progress": 0,
        "type": payload.type,
        "text": payload.text
    }
    WS_CONN.setdefault(job_id, set())
    asyncio.create_task(fake_generate(job_id))  # ✅ 明确用事件循环跑协程
    return {"job_id": job_id}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    return JOBS.get(job_id, {"status": "NOT_FOUND", "progress": 0})

@app.websocket("/ws/jobs/{job_id}")
async def ws_job(websocket: WebSocket, job_id: str):
    await websocket.accept()
    WS_CONN.setdefault(job_id, set()).add(websocket)
    try:
        await websocket.send_json(JOBS.get(job_id, {"status": "NOT_FOUND", "progress": 0}))
        # 前端通常不往回发数据；此处保持连接
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
    finally:
        WS_CONN.get(job_id, set()).discard(websocket)

async def fake_generate(job_id: str):
    """开发用假任务：每 0.1s +2%，到 100% 完成。"""
    JOBS[job_id]["status"] = "RUNNING"
    for p in range(0, 101, 2):
        JOBS[job_id]["progress"] = p
        await push(job_id)
        await asyncio.sleep(0.1)
    JOBS[job_id]["status"] = "COMPLETED"
    JOBS[job_id]["asset_id"] = f"asset-{job_id}"
    await push(job_id)

async def push(job_id: str):
    data = JOBS[job_id]
    dead: Set[WebSocket] = set()
    for ws in WS_CONN.get(job_id, set()):
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    for ws in dead:
        WS_CONN.get(job_id, set()).discard(ws)

# =========================
# BVH 生成 & 下载
# =========================
class Text2BVHIn(BaseModel):
    text: str

class Text2MP4In(BaseModel):
    text: str

@app.post("/bvh/submit")
async def submit_text2bvh(payload: Text2BVHIn):
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {
        "status": "QUEUED",
        "progress": 0,
        "type": "bvh",
        "text": payload.text,
        "download_url": None,
        "log": [],
        "hint": "",
        "hints": [],

    }
    WS_CONN.setdefault(job_id, set())
    asyncio.create_task(run_text2bvh(job_id, payload.text))
    return {"job_id": job_id}

@app.post("/mp4/submit")
async def submit_text2mp4(payload: Text2MP4In):
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {
        "status": "QUEUED",
        "progress": 0,
        "type": "mp4",
        "text": payload.text.strip(),
        "preview_url": None,
        "mp4_list": [],
        "log": [],
        "hint": "",
        "hints": [],

    }
    WS_CONN.setdefault(job_id, set())
    asyncio.create_task(run_text2mp4(job_id, payload.text.strip()))
    return {"job_id": job_id}

@app.get("/download/{job_id}/{filename}")
def download_job_bvh(job_id: str, filename: str):
    # 防止路径穿越，只允许文件名
    fname = Path(filename).name
    path = OUTPUT_ROOT / job_id / "bvh_folder" / fname
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/octet-stream", filename=fname)

@app.get("/download/tools/{filename}")
def download_tools_bvh(filename: str):
    fname = Path(filename).name
    path = J2BVH_DIR / "bvh_folder" / fname
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/octet-stream", filename=fname)

async def run_text2bvh(job_id: str, user_text: str):
    """
    1) 写入 input.txt
    2) 生成运行时配置
    3) 运行 demo.py 产出 *_out.npy （子进程输出重定向到文件防止阻塞）
    4) 调 tools/npy2bvh/joints2bvh.py 生成 .bvh（同样重定向）
    5) 回拷 .bvh 并给下载链接
    """

    # 轻量提示（只显示一行，保留最多 20 条历史，前端用 jobs[job_id].hint 显示）
    def note(msg: str):
        s = str(msg)
        JOBS[job_id]["hint"] = s
        lst = JOBS[job_id].setdefault("hints", [])
        if not lst or lst[-1] != s:
            lst.append(s)
        if len(lst) > 20:
            del lst[:-20]

    async def push_state():
        for ws in list(WS_CONN.get(job_id, set())):
            try:
                await ws.send_json(JOBS[job_id])
            except Exception:
                WS_CONN[job_id].discard(ws)

    import time, yaml

    try:
        # 初始化
        JOBS[job_id]["status"] = "RUNNING"
        JOBS[job_id]["progress"] = 2
        JOBS[job_id]["hints"] = []
        note("正在准备任务目录…")
        await push_state()

        # 目录
        job_dir = OUTPUT_ROOT / job_id
        npy_dir = job_dir / "npy_folder"
        bvh_dir = job_dir / "bvh_folder"
        job_dir.mkdir(parents=True, exist_ok=True)
        npy_dir.mkdir(parents=True, exist_ok=True)
        bvh_dir.mkdir(parents=True, exist_ok=True)

        # 写入输入
        input_txt = job_dir / "input.txt"
        text_content = (user_text or "").strip() or "A person stands still."
        input_txt.write_text(text_content + "\n", encoding="utf-8")
        JOBS[job_id]["progress"] = 10
        note("已写入输入文本")
        await push_state()

        # 路径检查
        if not DEMO_PY.exists():
            JOBS[job_id]["status"] = "FAILED"; note(f"错误：缺少 demo.py：{DEMO_PY}"); await push_state(); return
        if not CFG_YAML.exists():
            JOBS[job_id]["status"] = "FAILED"; note(f"错误：缺少配置：{CFG_YAML}"); await push_state(); return
        if not J2BVH_PY.exists():
            JOBS[job_id]["status"] = "FAILED"; note(f"错误：缺少 joints2bvh.py：{J2BVH_PY}"); await push_state(); return

        target_results_root = PIPELINE_DIR / "results" / "mgpt" / "debug--AGPT"
        target_results_root.mkdir(parents=True, exist_ok=True)

        # 生成运行配置
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "UTF-8"

        JOBS[job_id]["progress"] = 12
        note("正在生成运行配置…")
        await push_state()

        runtime_cfg = job_dir / "config_runtime.yaml"
        try:
            with open(CFG_YAML, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f)

            cfg.setdefault("DEMO", {})["EXAMPLE"] = str(input_txt.resolve())
            cfg.setdefault("TEST", {})["FOLDER"]  = str(target_results_root.resolve())

            ckpt = cfg["TEST"].get("CHECKPOINTS", "mGPT.ckpt")
            ckpt_abs = Path(ckpt) if os.path.isabs(ckpt) else (PIPELINE_DIR / ckpt)
            ckpt_abs = ckpt_abs.resolve()
            if ckpt_abs.exists():
                cfg["TEST"]["CHECKPOINTS"] = str(ckpt_abs)
            else:
                note(f"警告：未找到权重，按配置继续：{ckpt_abs}")
                await push_state()

            with open(runtime_cfg, "w", encoding="utf-8") as f:
                yaml.safe_dump(cfg, f, allow_unicode=True)
        except Exception as e:
            runtime_cfg = CFG_YAML
            note(f"生成运行配置失败，已回退默认配置（{e}）")
            await push_state()

        JOBS[job_id]["progress"] = 20
        note("运行配置就绪")
        await push_state()

        # === 启动 demo.py（输出写到文件，避免 PIPE 阻塞）===
        model_log_path = job_dir / "model.out"
        note("启动模型生成 NPY…")
        await push_state()
        with open(model_log_path, "w", encoding="utf-8", buffering=1) as model_log:
            cmd = [str(PYTHON_EXE), str(DEMO_PY), "--cfg", str(runtime_cfg), "--example", str(input_txt.resolve())]
            proc = subprocess.Popen(
                cmd, cwd=str(PIPELINE_DIR),
                stdout=model_log, stderr=subprocess.STDOUT,  # 关键点：写文件，不用 PIPE
                text=True, encoding="utf-8", env=env,
            )

            last_tick = time.time()
            JOBS[job_id]["progress"] = 25
            while proc.poll() is None:
                if time.time() - last_tick >= 1.5:
                    # 25→55 区间缓慢推进
                    JOBS[job_id]["progress"] = min(55, JOBS[job_id]["progress"] + 3)
                    p = JOBS[job_id]["progress"]
                    if p < 35:
                        note("正在加载模型与权重…")
                    elif p < 45:
                        note("模型推理中…（可能需要几十秒）")
                    else:
                        note("正在导出 NPY…")
                    await push_state()
                    last_tick = time.time()
                await asyncio.sleep(0.1)

        # 推理完成
        JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 60)
        note("推理完成，开始扫描输出…")
        await push_state()

        # 扫描 *_out.npy（最多等 90 秒，避免落盘延迟）
        def find_latest_out_npy():
            now_ts = time.time()
            found_ = []
            if target_results_root.exists():
                for p in target_results_root.glob("**/samples_*/**/*_out.npy"):
                    try:
                        if now_ts - p.stat().st_mtime < 3600:  # 1 小时内
                            found_.append(p)
                    except Exception:
                        pass
            return max(found_, key=lambda p: p.stat().st_mtime) if found_ else None

        latest = None
        for _ in range(90):  # 90s 内轮询
            latest = find_latest_out_npy()
            if latest:
                break
            await asyncio.sleep(1.0)

        if not latest:
            JOBS[job_id]["status"] = "FAILED"
            note("未找到 *_out.npy，请检查模型输出/解释器（查看 model.out）")
            await push_state()
            return

        JOBS[job_id]["progress"] = 68
        note(f"已找到最新 NPY：{latest.name}")
        await push_state()

        # 归档 NPY
        dst_npy = npy_dir / latest.name
        shutil.copyfile(latest, dst_npy)
        JOBS[job_id]["progress"] = 75
        note("已归档 NPY 到任务目录")
        await push_state()

        # 准备转换目录
        note("清理转换器目录并准备转换…")
        await push_state()
        tool_npy = J2BVH_DIR / "npy_folder"
        tool_bvh = J2BVH_DIR / "bvh_folder"
        tool_npy.mkdir(parents=True, exist_ok=True)
        tool_bvh.mkdir(parents=True, exist_ok=True)
        for old in tool_npy.glob("*_out.npy"):
            try: old.unlink()
            except Exception: pass
        for old_bvh in tool_bvh.glob("*.bvh"):
            try: old_bvh.unlink()
            except Exception: pass

        copy_target = tool_npy / (dst_npy.name if dst_npy.name.endswith("_out.npy") else (dst_npy.stem + "_out.npy"))
        shutil.copyfile(dst_npy, copy_target)
        if not any(n.name.endswith("_out.npy") for n in tool_npy.glob("*.npy")):
            JOBS[job_id]["status"] = "FAILED"; JOBS[job_id]["progress"] = 81
            note("错误：转换器目录下没有 *_out.npy")
            await push_state()
            return

        JOBS[job_id]["progress"] = 82
        note("已放入转换队列")
        await push_state()

        # === joints2bvh（也写到文件，避免阻塞）===
        conv_log_path = job_dir / "bvh_convert.out"
        note("启动 BVH 转换器…")
        await push_state()
        with open(conv_log_path, "w", encoding="utf-8", buffering=1) as conv_log:
            cmd2 = [str(PYTHON_EXE), str(J2BVH_PY)]
            proc2 = subprocess.Popen(
                cmd2, cwd=str(J2BVH_DIR),
                stdout=conv_log, stderr=subprocess.STDOUT,  # 关键点：写文件
                text=True, encoding="utf-8", env=env,
            )

            last_tick = time.time()
            JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 90)
            while proc2.poll() is None:
                if time.time() - last_tick >= 1.5:
                    JOBS[job_id]["progress"] = min(96, JOBS[job_id]["progress"] + 2)
                    note("BVH 转换中…（请稍候）")
                    await push_state()
                    last_tick = time.time()
                await asyncio.sleep(0.1)

        # 扫描 bvh（最多等 10 × 0.2s）
        made = []
        for _ in range(10):
            made = sorted((b for b in tool_bvh.glob("*.bvh")), key=lambda p: p.stat().st_mtime)
            if made: break
            await asyncio.sleep(0.2)

        if not made:
            JOBS[job_id]["status"] = "FAILED"; note("错误：BVH 转换失败且未生成输出（查看 bvh_convert.out）"); await push_state(); return

        # 回拷并生成下载链接
        JOBS[job_id]["progress"] = 98
        note("回拷 BVH 至任务目录…")
        await push_state()

        copied_any = False
        final_bvh_name = made[-1].name
        for b in made:
            try:
                shutil.copyfile(b, (bvh_dir / b.name))
                copied_any = True
            except Exception:
                pass

        JOBS[job_id]["download_url"] = (
            f"/download/{job_id}/{final_bvh_name}" if copied_any else f"/download/tools/{final_bvh_name}"
        )

        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["status"] = "COMPLETED"
        note("完成，BVH 已可下载")
        await push_state()

    except Exception as e:
        JOBS[job_id]["status"] = "FAILED"
        note(f"错误：{e}")
        await push_state()

async def run_text2mp4(job_id: str, user_text: str):
    """
    文本 -> NPY (demo.py) -> MP4 (animation.py)
    - demo.py 用 PYTHON_EXE + PIPELINE_DIR
    - animation.py 用 PYTHON_MP4_EXE（通过 env 注入 FFMPEG_BIN）
    - 单行日志：JOBS[job_id]["hint"]；至多保留最近 20 条在 JOBS[job_id]["hints"]
    """
    def note(msg: str):
        s = str(msg)
        JOBS[job_id]["hint"] = s
        lst = JOBS[job_id].setdefault("hints", [])
        if not lst or lst[-1] != s:
            lst.append(s)
        if len(lst) > 20:
            del lst[:-20]

    def set_error(msg: str):
        JOBS[job_id]["error"] = msg
        JOBS[job_id]["status"] = "FAILED"

    async def push_state():
        for ws in list(WS_CONN.get(job_id, set())):
            try:
                await ws.send_json(JOBS[job_id])
            except Exception:
                WS_CONN[job_id].discard(ws)

    try:
        # 初始化
        JOBS[job_id]["status"] = "RUNNING"
        JOBS[job_id]["progress"] = 3
        JOBS[job_id]["hints"] = []
        note("正在准备任务目录…")
        await push_state()

        # 任务目录
        job_dir  = OUTPUT_ROOT / job_id
        work_npy = job_dir / "npy_folder"
        work_mp4 = job_dir / "mp4"
        job_dir.mkdir(parents=True, exist_ok=True)
        work_npy.mkdir(parents=True, exist_ok=True)
        work_mp4.mkdir(parents=True, exist_ok=True)

        # 输入
        text = (user_text or "").strip()
        if not text:
            set_error("输入文本为空"); await push_state(); return
        input_txt = job_dir / "input.txt"
        input_txt.write_text(text + "\n", encoding="utf-8")
        JOBS[job_id]["progress"] = 10
        note("已写入输入文本")
        await push_state()

        # 运行时配置
        import yaml, time as _time
        target_results_root = PIPELINE_DIR / "results" / "mgpt" / "debug--AGPT"
        target_results_root.mkdir(parents=True, exist_ok=True)

        runtime_cfg = job_dir / "config_runtime.yaml"
        note("正在生成运行配置…"); await push_state()
        with open(CFG_YAML, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        cfg.setdefault("DEMO", {})["EXAMPLE"] = str(input_txt.resolve())
        cfg.setdefault("TEST", {})["FOLDER"] = str(target_results_root.resolve())
        ckpt = cfg["TEST"].get("CHECKPOINTS", "mGPT.ckpt")
        ckpt_abs = Path(ckpt) if os.path.isabs(ckpt) else (PIPELINE_DIR / ckpt)
        if ckpt_abs.exists():
            cfg["TEST"]["CHECKPOINTS"] = str(ckpt_abs.resolve())
        with open(runtime_cfg, "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True)

        JOBS[job_id]["progress"] = 18
        note("运行配置就绪")
        await push_state()

        # === [1] 跑 demo.py 生成 *_out.npy（输出写文件，避免阻塞）===
        env_demo = os.environ.copy()
        env_demo["PYTHONUTF8"] = "1"
        env_demo["PYTHONIOENCODING"] = "UTF-8"

        model_log = job_dir / "model.out"
        note("启动模型生成 NPY…"); await push_state()
        with open(model_log, "w", encoding="utf-8", buffering=1) as logf:
            cmd_demo = [str(PYTHON_EXE), str(DEMO_PY), "--cfg", str(runtime_cfg), "--example", str(input_txt.resolve())]
            proc = subprocess.Popen(
                cmd_demo, cwd=str(PIPELINE_DIR),
                stdout=logf, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", env=env_demo,
            )
            last = _time.time()
            JOBS[job_id]["progress"] = 25
            while proc.poll() is None:
                # 25→55 平滑推进，并滚动提示
                if _time.time() - last >= 1.5:
                    p = min(55, JOBS[job_id]["progress"] + 3)
                    JOBS[job_id]["progress"] = p
                    if p < 35: note("正在加载模型与权重…")
                    elif p < 45: note("模型推理中…（可能需要几十秒）")
                    else: note("正在导出 NPY…")
                    await push_state()
                    last = _time.time()
                await asyncio.sleep(0.1)

        JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 60)
        note("推理完成，开始扫描输出…"); await push_state()

        # 扫描 *_out.npy（近 30 分钟内；最多等 60 秒）
        now_ts = _time.time()
        latest = None
        for _ in range(60):
            found = []
            for p in target_results_root.glob("**/*_out.npy"):
                try:
                    if _time.time() - p.stat().st_mtime < 1800:
                        found.append(p)
                except Exception:
                    pass
            latest = max(found, key=lambda p: p.stat().st_mtime) if found else None
            if latest: break
            await asyncio.sleep(1.0)

        if not latest:
            set_error("未找到 *_out.npy（demo.py 未输出或路径不对）"); await push_state(); return

        note(f"已找到 NPY：{latest.name}"); await push_state()
        dst_npy = work_npy / latest.name
        shutil.copyfile(latest, dst_npy)
        JOBS[job_id]["progress"] = 68
        note("已归档 NPY 到任务目录"); await push_state()

        # === [2] 跑 animation.py 生成 MP4 ===
        env_mp4 = os.environ.copy()
        env_mp4["PYTHONUTF8"] = "1"
        env_mp4["PYTHONIOENCODING"] = "UTF-8"
        if FFMPEG_BIN and os.path.exists(FFMPEG_BIN):
            env_mp4["FFMPEG_BIN"] = FFMPEG_BIN

        anim_dir = work_npy / "animation"
        anim_dir.mkdir(exist_ok=True)

        convert_log = job_dir / "mp4_convert.out"
        note("启动视频渲染器…"); await push_state()
        with open(convert_log, "w", encoding="utf-8", buffering=1) as logf:
            cmd2 = [str(PYTHON_MP4_EXE), str(ANIMATION_PY), "--npy-folder", str(work_npy)]
            proc2 = subprocess.Popen(
                cmd2, stdout=logf, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", env=env_mp4
            )
            last = _time.time()
            JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 72)
            while proc2.poll() is None:
                # 72→96 平滑推进
                if _time.time() - last >= 1.5:
                    JOBS[job_id]["progress"] = min(96, JOBS[job_id]["progress"] + 2)
                    note("视频渲染中…（请稍候）")
                    await push_state()
                    last = _time.time()
                await asyncio.sleep(0.2)

        # 扫描生成的 mp4
        mp4s = []
        for _ in range(20):  # 最多 4s
            mp4s = sorted(anim_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
            if mp4s: break
            await asyncio.sleep(0.2)

        if not mp4s:
            set_error("没有生成 mp4（检查 FFMPEG_BIN、PYTHON_MP4_EXE、写权限）"); await push_state(); return

        JOBS[job_id]["progress"] = 98
        note("回拷 MP4 到任务目录…"); await push_state()

        # 回拷并设置预览
        copied = []
        for m in mp4s:
            dst = work_mp4 / m.name
            try:
                shutil.copyfile(m, dst)
                copied.append(dst.name)
            except Exception:
                pass

        JOBS[job_id]["mp4_list"]    = [f"/outputs/{job_id}/mp4/{name}" for name in copied]
        JOBS[job_id]["preview_url"] = f"/outputs/{job_id}/mp4/{copied[-1]}"

        # ✔ 只有可预览后才 100%
        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["status"]   = "COMPLETED"
        note("完成，视频已可预览"); await push_state()

    except Exception as e:
        set_error(str(e))
        await push_state()

# =========================
# AI: AnimationGPT Assistant
# =========================
from fastapi import APIRouter
from pydantic import BaseModel as _BaseModel  # 避免与上面冲突
from dotenv import load_dotenv
from openai import AsyncOpenAI
import json as _json

load_dotenv()

OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://127.0.0.1:11434/v1")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL",    "qwen2.5:7b-instruct")
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY",  "ollama")

oclient = AsyncOpenAI(base_url=OPENAI_BASE_URL, api_key=OPENAI_API_KEY)
AI = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = """你是“AnimationGPT 助手”，本网站的站内 AI。
【职责范围】
1) 回答与本站功能直接相关的问题：账户/登录（现为匿名）、任务与进度（Jobs/WS）、文本→MP4、文本→BVH、资源管理（Assets）、页面导航与使用指南。
2) 生成可直接用于本站生成器的“提示词文本”（prompt）。
3) 返回内容以简洁中文为主；如需给出“可复制”的提示词，请用清晰的块状格式。
【越界处理】
- 对与本站无直接关系的问题婉拒并引导回“如何使用本站”。
【输出规范】
- 普通问答：直接回答并给步骤/按钮路径。
- 需要生成提示词：输出一个“可复制”的 Prompt 区块。
"""

FEWSHOT = [
    {"role": "user", "content": "给一个摇滚流行歌的音乐提示词"},
    {"role": "assistant", "content":
        "【音乐生成 Prompt】\n风格：80 年代流行 × 轻摇滚\n节奏/速度：中速（约 100–112 BPM）\n编配：低音鼓四拍踏 + 合成器铺底，干净电吉他分解与和弦，贝斯跟随底鼓\n情绪：明亮、复古、略带城市感\n结构：Intro 4 小节 → A 8 小节 → B 8 小节 → Hook 8 小节\n音色参考：Juno 合成贝斯、Linn 电子鼓、清亮合成 Pad\n质感：少量磁带饱和与合唱\n时长：30–45 秒\n—— 直接复制以上文本到音乐生成器即可。"
    },
]

def build_server_messages(user_messages: list[dict]) -> list[dict]:
    clean: list[dict] = []
    for m in user_messages or []:
        role = (m.get("role") or "").lower()
        if role not in ("user", "assistant", "tool", "system"):
            continue
        if role == "system":
            continue  # 丢弃前端 system，防越狱
        content = m.get("content") or ""
        clean.append({"role": role, "content": str(content)})

    if len(clean) > 18:
        clean = clean[-18:]

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += FEWSHOT
    messages += clean
    return messages

class ChatMsg(_BaseModel):
    role: str
    content: str

class ChatIn(_BaseModel):
    messages: list[ChatMsg]
    temperature: float = 0.7

@AI.post("/chat")
async def ai_chat(body: ChatIn):
    srv_messages = build_server_messages([m.model_dump() for m in body.messages])
    resp = await oclient.chat.completions.create(
        model=OPENAI_MODEL,
        messages=srv_messages,
        temperature=body.temperature,
        stream=False,
    )
    reply = resp.choices[0].message.content or ""
    return {"reply": reply}

@AI.websocket("/ws")
async def ai_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        init = await websocket.receive_text()
        data = _json.loads(init)
        client_msgs = data.get("messages", [])
        temperature = float(data.get("temperature", 0.7))

        srv_messages = build_server_messages(client_msgs)
        stream = await oclient.chat.completions.create(
            model=OPENAI_MODEL,
            messages=srv_messages,
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    await websocket.send_json({"delta": delta})
        await websocket.send_json({"event": "done"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        finally:
            await websocket.close()

# ========= MusicGPT 集成（完整可粘贴版，含中文→英文翻译，GPU/CPU 由系统自行决定） =========
import os
import re
import time
import asyncio
import shutil
import platform
import contextlib
from pathlib import Path
from typing import List
import subprocess

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent  # animation_back.py 所在的目录

MUSICGPT_BIN = BASE_DIR / "animation-web" / "musicgpt-x86_64-pc-windows-msvc.exe"

print(">>> [MusicGPT] USING MUSICGPT_BIN =", MUSICGPT_BIN, "exists?", Path(MUSICGPT_BIN).exists())

if not Path(MUSICGPT_BIN).exists():
    raise RuntimeError("MusicGPT exe 文件不存在，路径配置错误！")


# ========= 环境变量注入（现在不再禁用 GPU，只是预留扩展点） =========
def _music_env() -> dict:
    """
    返回运行 musicgpt 子进程时使用的环境变量。
    当前不修改任何 GPU 相关变量，保持系统默认行为（能用 GPU 就用 GPU）。
    如果以后需要调试，比如强制 CPU / 指定代理，可以在这里加：
        env['ORT_DISABLE_GPU'] = '1'
    """
    env = os.environ.copy()
    return env

def _win_high_priority_flags() -> int:
    """Windows 下返回 High 优先级的 creationflags；其它平台返回 0。"""
    if os.name == "nt":
        return subprocess.HIGH_PRIORITY_CLASS
    return 0


MUSICGPT_BASE = os.getenv("MUSICGPT_BASE", "http://127.0.0.1:8642")

# —— MusicGPT 默认数据目录（仅用于回退/调试，可不使用）——
MUSICGPT_DATA_DIR = Path(
    os.getenv("MUSICGPT_DATA_DIR", os.path.expanduser("~/Library/Application Support/com.gabotechs.musicgpt"))
)

# —— 对外可访问的音频目录（建议放在 frontend/public/Musicdata）——
AUDIO_PUBLIC_DIR = (BASE_DIR / "animation-web" / "animation-web" / "frontend" / "public" / "Musicdata").resolve()
AUDIO_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

# 将上面的目录映射为 /musicdata，使前端可以用 ./musicdata/<file> 相对路径访问
try:
    app.mount("/musicdata", StaticFiles(directory=str(AUDIO_PUBLIC_DIR)), name="musicdata")  # type: ignore  # noqa
except Exception:
    pass


# —— 路由分组 ——
MGPT = APIRouter(prefix="/musicgpt", tags=["musicgpt"])
MUSIC = APIRouter(prefix="/music", tags=["music"])

# —— 任务参数 ——
DEFAULT_SECS = int(os.getenv("MUSICGPT_DEFAULT_SECS", "20"))
MAX_RUNTIME  = int(os.getenv("MUSICGPT_MAX_RUNTIME",  "360"))
AUDIO_EXTS   = (".wav", ".mp3", ".m4a", ".flac", ".ogg")


# —— 翻译开关/模型 ——
MUSIC_PROMPT_TRANSLATE = os.getenv("MUSIC_PROMPT_TRANSLATE", "1") != "0"
MUSIC_TRANSLATE_MODEL  = os.getenv("MUSIC_TRANSLATE_MODEL", os.getenv("OPENAI_MODEL", "qwen2.5:7b-instruct"))


# ========== 可选：反向代理到 MusicGPT WebUI ==========
@MGPT.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_musicgpt(path: str, request: Request):
    url = f"{MUSICGPT_BASE}/{path}"
    try:
        raw = await request.body()
        headers = dict(request.headers)
        headers.pop("host", None)
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.request(
                request.method, url, content=raw, headers=headers, params=request.query_params
            )
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers={k: v for k, v in resp.headers.items()
                     if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
        )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Cannot reach MusicGPT: {e!s}")


# ========== 类型 ==========
class MusicIn(BaseModel):
    prompt: str
    model: str | None = None
    duration: int | None = None


# ========== 工具 ==========
async def _read_stream(stream, buf: list[str], job: dict):
    if "debug" not in job or not isinstance(job["debug"], list):
        job["debug"] = []
    debug_list = job["debug"]

    try:
        while True:
            line = await stream.readline()
            if not line:
                break
            s = line.decode("utf-8", "ignore").strip()
            buf.append(s)
            if len(debug_list) < 160:
                debug_list.append(s)
    except Exception:
        pass


async def _maybe_zh_to_en(text: str) -> tuple[str, bool, str]:
    try:
        if not MUSIC_PROMPT_TRANSLATE or not text:
            return text, False, "disabled_or_empty"
        if not re.search(r"[\u4e00-\u9fff]", text):
            return text, False, "no_zh"

        if "oclient" not in globals():
            return text, False, "no_oclient"

        sys = (
            "You are a professional bilingual music prompt translator. "
            "Translate the user's Chinese music prompt into concise, idiomatic English "
            "optimized for text-to-music models."
        )
        resp = await oclient.chat.completions.create(
            model=MUSIC_TRANSLATE_MODEL, temperature=0.2,
            messages=[{"role": "system", "content": sys},
                      {"role": "user",   "content": text.strip()}],
            stream=False,
        )
        out = (resp.choices[0].message.content or "").strip()
        if len(out) < 2:
            return text, False, "empty_result"
        return out, True, "ok"
    except Exception as e:
        return text, False, f"translate_error: {e}"


# ========== 同步生成 ==========
@MUSIC.post("/generate")
async def generate_music(inb: MusicIn):
    if not Path(MUSICGPT_BIN).exists():
        raise HTTPException(500, f"未找到可执行文件：{MUSICGPT_BIN}")

    secs = inb.duration if inb.duration is not None else DEFAULT_SECS

    final_name = f"{int(time.time())}.wav"
    tmp_name   = f".{final_name}.part"
    final_path = AUDIO_PUBLIC_DIR / final_name
    tmp_path   = AUDIO_PUBLIC_DIR / tmp_name

    used_prompt, _, _ = await _maybe_zh_to_en(inb.prompt)

    cmd = [
        MUSICGPT_BIN,
        used_prompt,
        "--secs", str(secs),
        "--no-playback",
        "--no-interactive",
        "--output", str(tmp_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_music_env(),
        creationflags=_win_high_priority_flags(), 
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        with contextlib.suppress(Exception):
            tmp_path.unlink()
        raise HTTPException(
            500,
            f"musicgpt 运行失败：{(stderr or b'').decode('utf-8', 'ignore')}"
        )

    await asyncio.sleep(0.2)
    if not tmp_path.exists():
        raise HTTPException(500, f"未找到输出文件：{tmp_path}")

    os.replace(tmp_path, final_path)
    return {"audio_url": f"/musicdata/{final_name}"}


# ========== 异步任务版 ==========
MUSIC_JOBS: dict[str, dict] = {}


@MUSIC.post("/generate_async")
async def music_generate_async(inb: MusicIn):
    if not Path(MUSICGPT_BIN).exists():
        raise HTTPException(500, f"未找到可执行文件：{MUSICGPT_BIN}")

    if inb.duration is None:
        inb.duration = DEFAULT_SECS

    used_prompt, translated, note = await _maybe_zh_to_en(inb.prompt)

    job_id = os.urandom(6).hex()
    MUSIC_JOBS[job_id] = {
        "status": "QUEUED",
        "progress": 0,
        "audio_url": None,
        "error": None,
        "started_at": time.time(),
        "debug": [],
        "prompt": inb.prompt,
        "prompt_en": used_prompt,
        "translated": translated,
        "translate_note": note,
        "duration": inb.duration,
        "model": inb.model,
    }

    inb.prompt = used_prompt
    asyncio.create_task(_run_music_job(job_id, inb))
    return {"job_id": job_id}


@MUSIC.get("/status/{job_id}")
def music_status(job_id: str):
    job = MUSIC_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job_not_found")
    return job


@MUSIC.get("/debug/{job_id}")
def music_debug(job_id: str):
    job = MUSIC_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job_not_found")
    return job


# ========== 异步执行器 ==========
async def _run_music_job(job_id: str, inb: MusicIn):
    job = MUSIC_JOBS[job_id]
    job["status"] = "RUNNING"
    job["progress"] = 1

    final_name = f"{int(time.time())}.wav"
    tmp_name   = f".{final_name}.part"
    tmp_path = AUDIO_PUBLIC_DIR / tmp_name
    final_path = AUDIO_PUBLIC_DIR / final_name

    cmd = [
        MUSICGPT_BIN,
        inb.prompt,
        "--secs", str(inb.duration),
        "--no-playback",
        "--no-interactive",
        "--output", str(tmp_path),
    ]

    start_ts = time.time()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_music_env(),
            creationflags=_win_high_priority_flags(),
        )

        stdout_buf, stderr_buf = [], []
        readers = []
        if proc.stdout:
            readers.append(asyncio.create_task(_read_stream(proc.stdout, stdout_buf, job)))
        if proc.stderr:
            readers.append(asyncio.create_task(_read_stream(proc.stderr, stderr_buf, job)))

        # 进度推进到 90%
        while True:
            if time.time() - start_ts > MAX_RUNTIME:
                with contextlib.suppress(Exception):
                    proc.kill()
                job["status"] = "FAILED"
                job["error"]  = "生成超时"
                return

            try:
                await asyncio.wait_for(proc.wait(), timeout=1.0)
                break
            except asyncio.TimeoutError:
                job["progress"] = min(90, job["progress"] + 2)

        await asyncio.gather(*readers, return_exceptions=True)

        if proc.returncode != 0:
            job["status"] = "FAILED"
            job["error"]  = "\n".join(stderr_buf[-30:])
            return

        job["progress"] = 95

        await asyncio.sleep(0.2)
        if not tmp_path.exists():
            job["status"] = "FAILED"
            job["error"]  = "未找到输出文件"
            return

        os.replace(tmp_path, final_path)

        job["audio_url"] = f"/musicdata/{final_name}"
        job["progress"]  = 100
        job["status"]    = "COMPLETED"

    except Exception as e:
        job["status"] = "FAILED"
        job["error"]  = str(e)


# ========== 查询/列出 ==========
def _safe_path(p: Path) -> Path:
    base = AUDIO_PUBLIC_DIR.resolve()
    rp = p.resolve()
    if not str(rp).startswith(str(base)):
        raise HTTPException(400, "bad_path")
    return rp


@MUSIC.get("/find/{job_id}")
def music_find(job_id: str):
    cand = _safe_path(AUDIO_PUBLIC_DIR / f"{job_id}.wav")
    if not cand.exists():
        raise HTTPException(404, "not_found")
    st = cand.stat()
    return {
        "audio_url": f"/musicdata/{job_id}.wav",
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "abs_path": str(cand),
    }


@MUSIC.get("/list")
def music_list():
    items = []
    for p in sorted(AUDIO_PUBLIC_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS:
            st = p.stat()
            items.append({
                "name": p.name,
                "url": f"/musicdata/{p.name}",
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            })
    return {"files": items}

# ========= 多模态集成（完整可粘贴版，含中文→英文翻译，GPU/CPU 由系统自行决定） =========
import os
import re
import time
import asyncio
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from fastapi import HTTPException

# ---- 多模态输入模型 ----
class Text2ComboIn(BaseModel):
    text: str
    # 如果你想强制指定音乐时长（秒），可以传；否则自动用视频时长
    duration: Optional[int] = None


# ---- 文本拆分：战斗文本 + 音乐描述（根据第一个 " in " 切分） ----
def split_motion_music(raw: str) -> tuple[str, str]:
    s = (raw or "").strip()
    if not s:
        return "A person stands still.", "epic orchestral background music"
    # 找第一个独立的 in
    m = re.search(r"\s+in\s+", s, flags=re.IGNORECASE)
    if not m:
        # 没有 in：全部当作动作文本，音乐给默认
        return s, "epic orchestral battle music, fast tempo"
    motion = s[:m.start()].strip()
    music = s[m.end():].strip()
    if not motion:
        motion = "A person stands still."
    if not music:
        music = "epic orchestral background music"
    return motion, music


# ---- 读取视频时长（秒） ----
def get_video_duration(video_path: Path) -> float:
    """
    使用 ffprobe 获取视频时长，失败返回 0.
    默认假设 ffprobe 与 FFMPEG_BIN 同目录。
    """
    if not FFMPEG_BIN or not os.path.exists(FFMPEG_BIN):
        return 0.0

    ffmpeg_p = Path(FFMPEG_BIN)
    ffprobe = ffmpeg_p.with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if not ffprobe.exists():
        return 0.0

    try:
        proc = subprocess.run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return float(proc.stdout.strip())
    except Exception:
        return 0.0


# ---- 合并无声视频 + 音频 → 带 BGM 的 MP4 ----
def merge_video_audio(video: Path, audio: Path, out_path: Path):
    """
    使用 ffmpeg 将无声视频和音频合成一个 mp4：
    - 视频流 copy，不重新编码
    - 音频流也直接 copy（避免 aac 编码器报错）
    - -shortest：以更短的轨道为结束时间，避免黑屏或静音长尾
    """
    if not FFMPEG_BIN or not os.path.exists(FFMPEG_BIN):
        raise RuntimeError("FFMPEG_BIN 未配置或不存在")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-i", str(video),
        "-i", str(audio),
        "-c:v", "copy",   # 视频直接 copy
        "-c:a", "copy",   # 音频也直接 copy，避免 aac 转码失败
        "-shortest",
        str(out_path),
    ]

    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg merge failed (code {proc.returncode}):\n{proc.stderr.strip()}"
        )

# ---- 生成音乐（复用 MusicGPT 的中文→英文翻译 & 环境） ----
async def generate_music_once(prompt: str, duration: int | None = None) -> tuple[str, Path]:
    """
    同步生成一段音乐：
    - prompt：中文/英文均可（内部会调用 _maybe_zh_to_en）
    - duration：时长（秒）；None 时使用 DEFAULT_SECS
    返回：(audio_url, 本地路径)
    """
    if not MUSICGPT_BIN or not Path(MUSICGPT_BIN).exists():
        raise RuntimeError(f"未找到 MusicGPT 可执行文件：{MUSICGPT_BIN}")

    # 统一一下时长（至少 1 秒，默认用 DEFAULT_SECS）
    secs = int(duration) if duration and duration > 0 else DEFAULT_SECS
    if secs <= 0:
        secs = 1

    AUDIO_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    # 直接用最终文件名，不再搞 .tmp/.part，中间不重命名，避免 xxx.wav.tmp.wav 这种问题
    final_name = f"{int(time.time())}.wav"
    final_path = AUDIO_PUBLIC_DIR / final_name

    # 中文 → 英文翻译（已在 MusicGPT 集成中实现）
    used_prompt, _, _ = await _maybe_zh_to_en(prompt)

    env = _music_env()

    cmd = [
        str(MUSICGPT_BIN),
        used_prompt,
        "--secs",
        str(secs),
        "--no-playback",
        "--no-interactive",
        "--output",
        str(final_path),
    ]

    # 高优先级跑 MusicGPT，避免卡死（Windows 下 creationflags 有效）
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        creationflags=_win_high_priority_flags(),
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        # 把 stderr 带进去方便你看具体错误
        raise RuntimeError(f"Music generation failed: {stderr.decode('utf-8', 'ignore')}")

    # 只检查输出文件是否存在，不再按大小判失败（短音频也算成功）
    if not final_path.exists():
        raise RuntimeError(f"Music generation failed: 输出文件未找到：{final_path}")

    audio_url = f"/musicdata/{final_name}"
    return audio_url, final_path

import numpy as np
def extract_motion_energy(npy_path: Path, fps: float = 20.0):
    """
    从 MotionGPT 输出的 *_out.npy 中提取动作能量曲线与峰值。
    自动兼容 shape:
        (F, J, 3)
        (1, F, J, 3)
    返回：
        energy: 平滑后的能量序列（list[float]）
        peaks:  峰值所在的帧索引（list[int]，对应 energy 的下标）
    """
    from scipy.signal import find_peaks

    arr = np.load(npy_path, allow_pickle=True)

    # --- 兼容 batch 维度 (1, F, J, 3) ---
    if arr.ndim == 4 and arr.shape[0] == 1:
        arr = arr[0]  # -> (F, J, 3)

    if arr.ndim != 3:
        raise ValueError(f"Unexpected NPY shape: {arr.shape}, expected (F, J, 3)")

    F, J, C = arr.shape
    if C != 3:
        raise ValueError(f"Last dim must be 3 coordinates, got {C}")

    if F < 2:
        # 帧数太少，无法计算速度
        return [], []

    # --- 计算逐帧速度与能量 ---
    # vel: 相邻帧差分后的速度向量模长 (F-1, J)
    vel = np.linalg.norm(arr[1:] - arr[:-1], axis=2)
    # energy: 各关节速度的平均，得到单通道能量曲线 (F-1,)
    energy = vel.mean(axis=1)

    # --- 简单平滑，避免抖动 ---
    if len(energy) > 3:
        kernel = np.ones(3, dtype=np.float32) / 3.0
        energy_smooth = np.convolve(energy, kernel, mode="same")
    else:
        energy_smooth = energy

    # --- 寻找能量峰值 ---
    # 至少间隔 0.25 秒，避免太密集的峰
    distance = max(1, int(fps * 0.25))
    std_val = float(np.std(energy_smooth))
    # prominence 根据能量波动自适应设定，太小会到处是峰，太大又一个都没有
    prominence = std_val * 0.1 if std_val > 0 else 0.0

    peaks, _ = find_peaks(energy_smooth, distance=distance, prominence=prominence)

    return energy_smooth.tolist(), peaks.tolist()



def build_rhythm_prompt(text_prompt: str, peaks, energy, fps: float = 20.0):
    """
    根据动作能量和峰值，构造 MusicGPT 能理解的节奏提示词。

    text_prompt: 你传给后端的原始文本（“动作描述 + In a ... music ...”）
    peaks:       extract_motion_energy 返回的峰值帧索引
    energy:      extract_motion_energy 返回的能量序列
    fps:         动画帧率，用于换算时间（秒）
    """
    peaks = list(peaks or [])
    energy = list(energy or [])

    # --- 计算整体强度，用于补充说明 ---
    if len(energy) > 0:
        avg_energy = float(sum(energy) / len(energy))
        peak_energy = float(max(energy))
    else:
        avg_energy = 0.0
        peak_energy = 0.0

    if peak_energy <= 0 or avg_energy <= 0:
        intensity_desc = (
            "The overall motion intensity is relatively low, so the music can stay more subtle, "
            "with soft rhythmic pulses and occasional accents that do not dominate the scene."
        )
    elif peak_energy > avg_energy * 1.6:
        intensity_desc = (
            "The action contains frequent high-energy impacts, so the music should stay fast, "
            "intense, and rhythmic with strong percussion and clearly defined downbeats."
        )
    else:
        intensity_desc = (
            "The action has moderate intensity, so the music should maintain a clear beat with "
            "regular accents, balancing tension and breathing space."
        )

    # --- 如果没有检测到峰值，就不给具体时间点，只给强度建议 ---
    if not peaks:
        return f"""
Generate background music for a combat animation.

Action description:
{text_prompt}

Rhythm alignment instructions:
- Use a clear, steady beat that matches the overall pace of the movement.
- Emphasize stronger drum hits during visually intense moments of the motion.
- Keep a coherent tempo suitable for action scenes.
- Style suggestion: If no specific style was provided, use an epic battle style with percussion accents.

{intensity_desc}
"""
    offset_frames = max(1, int(0.5 * fps))
    adjusted_peaks = [max(0, int(p) - offset_frames) for p in peaks]

    # 转成秒（保留两位小数）
    peak_times = [round(p / fps, 2) for p in adjusted_peaks]
    # 最多取前 6 个，避免提示太长
    peak_times_short = peak_times[:6]
    peak_str = ", ".join(f"{t}s" for t in peak_times_short)

    return f"""
Generate background music for a combat animation.

Action description:
{text_prompt}

Rhythm alignment instructions:
- Rhythmic hits should occur on the downbeats at {peak_str}.
- Place **clear percussive hits** (e.g., low drum or impact sounds) exactly at each of: {peak_str}.
- Treat these times as the main rhythmic anchors, keeping the core beat locked to these impacts.
- Between these impacts, keep a driving rhythm that smoothly connects one hit to the next.
- Keep the tempo consistent and suitable for an action / battle scene.
- Style suggestion: epic orchestral battle music with strong drums and percussion, supporting the sense of momentum.

{intensity_desc}
"""

# ---- 多模态核心任务：文本 → NPY → MP4 + BVH + 音频 + 合成 MP4 ----
async def run_combo(job_id: str):
    """
    多模态任务：
    1) 拆分战斗文本 & 音乐文本
    2) demo.py → NPY
    3) NPY → MP4（无声）
    4) 根据视频时长生成音乐（MusicGPT）
    5) 使用 ffmpeg 合成「带 BGM 的 MP4」
    6) 使用 joints2bvh.py 从同一个 NPY 生成 BVH
    """
    def note(msg: str):
        s = str(msg)
        JOBS[job_id]["hint"] = s
        lst = JOBS[job_id].setdefault("hints", [])
        if not lst or lst[-1] != s:
            lst.append(s)
        if len(lst) > 20:
            del lst[:-20]

    def set_error(msg: str):
        JOBS[job_id]["error"] = msg
        JOBS[job_id]["status"] = "FAILED"

    async def push_state():
        for ws in list(WS_CONN.get(job_id, set())):
            try:
                await ws.send_json(JOBS[job_id])
            except Exception:
                WS_CONN[job_id].discard(ws)

    import yaml  # 局部导入，避免和上文重复

    try:
        # 初始化
        JOBS[job_id]["status"] = "RUNNING"
        JOBS[job_id]["progress"] = 3
        JOBS[job_id]["hints"] = []
        note("正在准备多模态任务目录…")
        await push_state()

        # 任务目录
        job_dir = OUTPUT_ROOT / job_id
        work_npy = job_dir / "npy_folder"
        work_mp4 = job_dir / "mp4"
        work_bvh = job_dir / "bvh"
        job_dir.mkdir(parents=True, exist_ok=True)
        work_npy.mkdir(parents=True, exist_ok=True)
        work_mp4.mkdir(parents=True, exist_ok=True)
        work_bvh.mkdir(parents=True, exist_ok=True)

        # 拆分文本（在 /combo/submit 时已经拆，但这里再兜底一次）
        full_text = (JOBS[job_id].get("text") or "").strip()
        motion_text = JOBS[job_id].get("motion_text")
        music_text = JOBS[job_id].get("music_text")
        if not motion_text or not music_text:
            motion_text, music_text = split_motion_music(full_text)
            JOBS[job_id]["motion_text"] = motion_text
            JOBS[job_id]["music_text"] = music_text

        if not motion_text:
            set_error("战斗文本为空"); await push_state(); return

        # 写入 input.txt
        input_txt = job_dir / "input.txt"
        input_txt.write_text(motion_text + "\n", encoding="utf-8")
        JOBS[job_id]["progress"] = 10
        note("已写入战斗文本")
        await push_state()

        # === 生成运行时配置 ===
        target_results_root = PIPELINE_DIR / "results" / "mgpt" / "debug--AGPT"
        target_results_root.mkdir(parents=True, exist_ok=True)

        runtime_cfg = job_dir / "config_runtime.yaml"
        note("正在生成运行配置…")
        await push_state()
        with open(CFG_YAML, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        cfg.setdefault("DEMO", {})["EXAMPLE"] = str(input_txt.resolve())
        cfg.setdefault("TEST", {})["FOLDER"] = str(target_results_root.resolve())
        ckpt = cfg["TEST"].get("CHECKPOINTS", "mGPT.ckpt")
        ckpt_abs = Path(ckpt) if os.path.isabs(ckpt) else (PIPELINE_DIR / ckpt)
        if ckpt_abs.exists():
            cfg["TEST"]["CHECKPOINTS"] = str(ckpt_abs.resolve())
        with open(runtime_cfg, "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True)

        JOBS[job_id]["progress"] = 18
        note("运行配置就绪")
        await push_state()

        # === [1] 跑 demo.py 生成 *_out.npy ===
        env_demo = os.environ.copy()
        env_demo["PYTHONUTF8"] = "1"
        env_demo["PYTHONIOENCODING"] = "UTF-8"

        model_log = job_dir / "model.out"
        note("启动模型生成 NPY…")
        await push_state()
        import time as _time
        with open(model_log, "w", encoding="utf-8", buffering=1) as logf:
            cmd_demo = [
                str(PYTHON_EXE),
                str(DEMO_PY),
                "--cfg",
                str(runtime_cfg),
                "--example",
                str(input_txt.resolve()),
            ]
            proc = subprocess.Popen(
                cmd_demo,
                cwd=str(PIPELINE_DIR),
                stdout=logf,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                env=env_demo,
            )
            last = _time.time()
            JOBS[job_id]["progress"] = 25
            while proc.poll() is None:
                if _time.time() - last >= 1.5:
                    JOBS[job_id]["progress"] = min(55, JOBS[job_id]["progress"] + 3)
                    p = JOBS[job_id]["progress"]
                    if p < 35:
                        note("正在加载模型与权重…")
                    elif p < 45:
                        note("正在推理生成动作序列…")
                    else:
                        note("正在写入 NPY…")
                    await push_state()
                    last = _time.time()
                await asyncio.sleep(0.2)

        if proc.returncode != 0:
            set_error("demo.py 执行失败（详见 model.out）")
            await push_state()
            return

        # 查找最新 *_out.npy
        note("正在查找最新 NPY …")
        await push_state()

        latest = None
        for _ in range(90):
            found = []
            now = _time.time()
            if target_results_root.exists():
                for p in target_results_root.glob("**/*_out.npy"):
                    try:
                        if now - p.stat().st_mtime < 1800:
                            found.append(p)
                    except Exception:
                        pass
            latest = max(found, key=lambda p: p.stat().st_mtime) if found else None
            if latest:
                break
            await asyncio.sleep(1.0)

        if not latest:
            set_error("未找到 *_out.npy（demo.py 未输出或路径不对）")
            await push_state()
            return

        note(f"已找到 NPY：{latest.name}")
        await push_state()
        dst_npy = work_npy / latest.name
        shutil.copyfile(latest, dst_npy)
        JOBS[job_id]["progress"] = 60
        note("已归档 NPY 到任务目录")
        await push_state()

        # === [2] 跑 animation.py 生成 MP4（无声） ===
        env_mp4 = os.environ.copy()
        env_mp4["PYTHONUTF8"] = "1"
        env_mp4["PYTHONIOENCODING"] = "UTF-8"
        if FFMPEG_BIN and os.path.exists(FFMPEG_BIN):
            env_mp4["FFMPEG_BIN"] = FFMPEG_BIN

        anim_dir = work_npy / "animation"
        anim_dir.mkdir(exist_ok=True)

        convert_log = job_dir / "mp4_convert.out"
        note("启动视频渲染器…")
        await push_state()
        with open(convert_log, "w", encoding="utf-8", buffering=1) as logf:
            cmd2 = [str(PYTHON_MP4_EXE), str(ANIMATION_PY), "--npy-folder", str(work_npy)]
            proc2 = subprocess.Popen(
                cmd2,
                cwd=str(work_npy),
                stdout=logf,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                env=env_mp4,
            )
            last = _time.time()
            JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 72)
            while proc2.poll() is None:
                if _time.time() - last >= 1.5:
                    JOBS[job_id]["progress"] = min(96, JOBS[job_id]["progress"] + 2)
                    note("视频渲染中…（请稍候）")
                    await push_state()
                    last = _time.time()
                await asyncio.sleep(0.2)

        # 扫描生成的 mp4
        mp4s = []
        for _ in range(20):  # 最多 4s
            mp4s = sorted(anim_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
            if mp4s:
                break
            await asyncio.sleep(0.2)

        if not mp4s:
            set_error("没有生成 mp4（检查 FFMPEG_BIN、PYTHON_MP4_EXE、写权限）")
            await push_state()
            return

        note("回拷 MP4 到任务目录…")
        await push_state()

        copied = []
        for m in mp4s:
            dst = work_mp4 / m.name
            try:
                shutil.copyfile(m, dst)
                copied.append(dst.name)
            except Exception:
                pass

        if not copied:
            set_error("生成了 mp4 但回拷失败（检查 outputs 目录权限）")
            await push_state()
            return

        # 原始无声视频（最后一个）
        raw_video_name = copied[-1]
        raw_video_path = work_mp4 / raw_video_name
        raw_video_url = f"/outputs/{job_id}/mp4/{raw_video_name}"

        # === [3] 生成背景音乐（时长匹配视频） ===
        note("开始生成背景音乐 …")
        await push_state()

        video_secs = int(round(get_video_duration(raw_video_path))) or DEFAULT_SECS
        audio_url, audio_path = await generate_music_once(music_text, duration=video_secs)
        JOBS[job_id]["audio_url"] = audio_url

        # === [4] 合成带 BGM 的 MP4 ===
        note("正在合成带背景音乐的视频 …")
        await push_state()

        merged_name = f"with_bgm_{raw_video_name}"
        merged_path = work_mp4 / merged_name
        merge_video_audio(raw_video_path, audio_path, merged_path)

        merged_url = f"/outputs/{job_id}/mp4/{merged_name}"

        JOBS[job_id]["preview_url"] = merged_url
        JOBS[job_id]["mp4_list"] = [
            merged_url,
            raw_video_url,
        ]

        JOBS[job_id]["progress"] = 90
        note("视频与音乐合成完成，开始生成 BVH …")
        await push_state()

        # === [5] 使用 joints2bvh.py 从同一 NPY 生成 BVH ===
        tool_npy = J2BVH_DIR / "npy_folder"
        tool_bvh = J2BVH_DIR / "bvh_folder"
        tool_npy.mkdir(parents=True, exist_ok=True)
        tool_bvh.mkdir(parents=True, exist_ok=True)

        note("清理转换器目录并准备转换…")
        await push_state()
        for p in list(tool_npy.glob("*.npy")) + list(tool_bvh.glob("*.bvh")):
            try:
                p.unlink()
            except Exception:
                pass

        # 将我们刚才的 NPY 拷贝到转换目录
        npy_name = dst_npy.name
        shutil.copyfile(dst_npy, tool_npy / npy_name)

        if not any(n.name.endswith("_out.npy") for n in tool_npy.glob("*.npy")):
            set_error("转换器目录下没有 *_out.npy（请检查 NPY 拷贝）")
            await push_state()
            return

        JOBS[job_id]["progress"] = 92
        note("已放入 BVH 转换队列")
        await push_state()

        conv_log_path = job_dir / "bvh_convert.out"
        note("启动 BVH 转换器…")
        await push_state()
        with open(conv_log_path, "w", encoding="utf-8", buffering=1) as conv_log:
            cmd2 = [str(PYTHON_EXE), str(J2BVH_PY)]
            proc2 = subprocess.Popen(
                cmd2,
                cwd=str(J2BVH_DIR),
                stdout=conv_log,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                env=env_demo,
            )
            last_tick = _time.time()
            JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], 94)
            while proc2.poll() is None:
                if _time.time() - last_tick >= 1.5:
                    JOBS[job_id]["progress"] = min(98, JOBS[job_id]["progress"] + 1)
                    note("BVH 转换中…（请稍候）")
                    await push_state()
                    last_tick = _time.time()
                await asyncio.sleep(0.1)

        made = []
        for _ in range(10):
            made = sorted(
                (b for b in tool_bvh.glob("*.bvh")),
                key=lambda p: p.stat().st_mtime,
            )
            if made:
                break
            await asyncio.sleep(0.2)

        if not made:
            set_error("BVH 转换失败且未生成输出（查看 bvh_convert.out）")
            await push_state()
            return

        note("回拷 BVH 至任务目录…")
        await push_state()

        final_bvh_name = made[-1].name
        copied_any = False
        for b in made:
            try:
                dstb = work_bvh / b.name
                shutil.copyfile(b, dstb)
                copied_any = True
            except Exception:
                pass

        if not copied_any:
            set_error("BVH 已生成，但回拷失败（检查 outputs 目录权限）")
            await push_state()
            return

        JOBS[job_id]["bvh_download_url"] = f"/outputs/{job_id}/bvh/{final_bvh_name}"

        # === 全部完成 ===
        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["status"] = "COMPLETED"
        note("多模态生成完成：视频+音乐可预览，BVH 可下载")
        await push_state()

    except Exception as e:
        set_error(str(e))
        note(f"错误：{e}")
        await push_state()


# ---- 提交接口：/combo/submit ----
@app.post("/combo/submit")
async def submit_combo(payload: Text2ComboIn):
    """
    前端使用的多模态提交接口：
    - 输入：Text2ComboIn(text="战斗文本 in 音乐描述")
    - 输出：{ "job_id": "xxxxxx" }
    前端通过现有的 /ws/jobs/{job_id} 即可实时获取进度和结果：
      - preview_url: 合成后的带 BGM 视频
      - audio_url: 背景音乐音频
      - bvh_download_url: BVH 下载链接
    """
    full_text = (payload.text or "").strip()
    motion_text, music_text = split_motion_music(full_text)

    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {
        "status": "QUEUED",
        "progress": 0,
        "type": "combo",
        "text": full_text,
        "motion_text": motion_text,
        "music_text": music_text,
        "preview_url": None,
        "mp4_list": [],
        "bvh_download_url": None,
        "audio_url": None,
        "hint": "",
        "hints": [],
        "error": None,
    }
    WS_CONN.setdefault(job_id, set())
    asyncio.create_task(run_combo(job_id))
    return {"job_id": job_id}



# ========== 注册路由 ==========
try:
    app.include_router(MGPT)
    app.include_router(MUSIC)
except Exception:
    pass


app.include_router(AI)
