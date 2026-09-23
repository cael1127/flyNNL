"""FastAPI: static UI, protocol POST, WebSocket stream."""

from __future__ import annotations

import asyncio
import base64
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .fly_sim import FlySim, run_loop
from .vfb_poller import VfbCache, start_poller

ROOT = Path(__file__).resolve().parent.parent

sim = FlySim()
vfb = VfbCache()
_stop = threading.Event()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_poller(vfb)
    loop_thread = threading.Thread(target=run_loop, args=(sim, _stop), name="fly-sim", daemon=True)
    loop_thread.start()
    yield
    _stop.set()


app = FastAPI(title="flyNNL", lifespan=lifespan)


class ProtocolBody(BaseModel):
    action: str
    speed: float | None = None


@app.post("/protocol")
def protocol(body: ProtocolBody) -> dict:
    if body.action not in {"submerge", "surface", "reset", "speed"}:
        return {"ok": False, "error": "unknown action"}
    sim.protocol(body.action, body.speed)
    return {"ok": True}


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "ready": sim.ready,
        "engine": sim.engine,
        "error": sim.error,
    }


@app.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            with sim.lock:
                jpeg = sim.latest_jpeg
                physio = sim.physio.snapshot()
                engine = sim.engine
                ready = sim.ready
                err = sim.error
            payload = {
                "jpeg": base64.b64encode(jpeg).decode("ascii") if jpeg else None,
                "physio": physio,
                "vfb": vfb.snapshot(),
                "engine": engine,
                "ready": ready,
                "error": err,
            }
            await ws.send_json(payload)
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        return


NO_CACHE = {"Cache-Control": "no-store"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT / "index.html", headers=NO_CACHE)


@app.get("/styles.css")
def styles() -> FileResponse:
    return FileResponse(ROOT / "styles.css", media_type="text/css", headers=NO_CACHE)


@app.get("/app.js")
def script() -> FileResponse:
    return FileResponse(ROOT / "app.js", media_type="text/javascript", headers=NO_CACHE)


@app.get("/physio.js")
def physio_script() -> FileResponse:
    return FileResponse(ROOT / "physio.js", media_type="text/javascript", headers=NO_CACHE)


@app.get("/flybody.js")
def flybody_script() -> FileResponse:
    return FileResponse(ROOT / "flybody.js", media_type="text/javascript", headers=NO_CACHE)
