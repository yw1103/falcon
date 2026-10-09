import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import storage
from .api.management import router
from .services import scheduler


@asynccontextmanager
async def lifespan(app):
    storage.initialize()
    stop = threading.Event()
    worker = threading.Thread(target=scheduler, args=(stop,), daemon=True)
    worker.start()
    yield
    stop.set()


def create_app():
    app = FastAPI(title="猎隼 · 管理后台", version="0.2.0", lifespan=lifespan)
    app.include_router(router, prefix="/api")
    dist = Path(__file__).resolve().parents[2] / "admin_frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app
