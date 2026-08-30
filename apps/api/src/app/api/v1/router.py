"""集中汇总 v1 版本的子路由。"""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.blog import router as blog_router
from app.api.v1.health import router as health_router
from app.api.v1.resume import router as resume_router

api_router = APIRouter()
# 每个子 router 自己管理路径前缀和 Swagger 标签。
api_router.include_router(auth_router)
api_router.include_router(blog_router)
api_router.include_router(health_router)
api_router.include_router(resume_router)
