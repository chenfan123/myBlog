"""数据库连接和 FastAPI 数据库依赖。"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

# Engine 管理数据库连接池。pool_pre_ping 会在复用连接前检测连接是否有效。
engine = create_engine(get_settings().database_url, pool_pre_ping=True)
# expire_on_commit=False 让 commit 后的 ORM 对象仍可直接读取字段。
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """为每个请求提供独立 Session，请求结束后自动关闭。"""
    with SessionLocal() as session:
        yield session
