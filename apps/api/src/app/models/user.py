"""用户数据库 ORM 模型。"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """映射 PostgreSQL 的 users 表。Mapped 类型同时供 SQLAlchemy 和类型检查使用。"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    # 只保存 Argon2 哈希，任何时候都不保存或回传原始密码。
    password_hash: Mapped[str] = mapped_column(String(255))
    # 可以禁用账号，而不必物理删除数据库记录。
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # False 为普通用户，True 为可访问后台写接口的管理员。
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
