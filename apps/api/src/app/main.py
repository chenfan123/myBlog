"""FastAPI 应用入口。

这个文件负责组装应用：注册路由、中间件，以及应用启动/关闭时要执行的任务。
业务逻辑尽量放在 services 目录，避免入口文件越来越复杂。
"""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.auth import bootstrap_admin
from app.services.captcha import run_captcha_log_cleanup


@asynccontextmanager
async def lifespan(_: FastAPI):
    """管理应用生命周期。

    yield 之前的代码在服务启动时执行；yield 之后的代码在服务关闭时执行。
    """
    # SessionLocal() 创建一次数据库会话。with 结束后会自动关闭连接。
    with SessionLocal() as db:
        # 若配置了初始化管理员，则确保数据库中存在该管理员。
        bootstrap_admin(db)

    # 在后台启动验证码日志清理任务，不阻塞正常的 HTTP 请求。
    cleanup_task = asyncio.create_task(run_captcha_log_cleanup())
    try:
        yield
    finally:
        # 服务关闭时取消后台任务，避免进程退出时残留任务警告。
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


def create_app() -> FastAPI:
    """创建并配置 FastAPI 实例，测试代码也可以复用这个工厂函数。"""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # CORS 允许本地 Next.js 开发服务器跨域调用 FastAPI。
    # allow_credentials=True 是浏览器携带 Cookie 的必要条件之一。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 所有 v1 接口都会拥有 /api/v1 前缀。
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "message": settings.app_name,
            "docs": "/docs",
            "health": f"{settings.api_v1_prefix}/health",
        }

    return app


app = create_app()
