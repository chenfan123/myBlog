"""用户、密码和 JWT 相关的业务逻辑。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User

# recommended() 当前选择安全的 Argon2 参数，验证时会自动读取哈希中的参数。
password_hash = PasswordHash.recommended()
algorithm = "HS256"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(db: Session, email: str) -> User | None:
    """按规范化后的邮箱查询用户；scalar 会返回一条 ORM 对象或 None。"""
    return db.scalar(select(User).where(User.email == normalize_email(email)))


def get_user_by_id(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


def create_user(db: Session, *, display_name: str, email: str, password: str) -> User:
    """创建普通用户；只有管理员迁移或初始化流程可以授予管理权限。"""
    user = User(
        display_name=display_name.strip(),
        email=normalize_email(email),
        password_hash=password_hash.hash(password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def bootstrap_admin(db: Session) -> User | None:
    """根据环境变量创建初始管理员；已是管理员时不会反复重置密码。"""
    settings = get_settings()
    email = settings.bootstrap_admin_email
    initial_password = settings.bootstrap_admin_password
    if not email or not initial_password:
        return None

    user = get_user_by_email(db, email)
    if user is None:
        user = User(
            display_name=settings.bootstrap_admin_name.strip() or "管理员",
            email=normalize_email(email),
            password_hash=password_hash.hash(initial_password),
            is_admin=True,
        )
        db.add(user)
    elif not user.is_admin:
        user.is_admin = True
        user.password_hash = password_hash.hash(initial_password)

    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, *, email: str, password: str) -> User | None:
    """验证账号状态与密码，并更新最后登录时间。"""
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    if not password_hash.verify(password, user.password_hash):
        return None
    user.last_login_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return user


def reset_user_password(db: Session, *, email: str, password: str) -> User | None:
    """更新已注册用户的密码哈希；调用方应先完成邮箱验证码校验。"""
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    user.password_hash = password_hash.hash(password)
    db.commit()
    db.refresh(user)
    return user


def create_access_token(user_id: UUID) -> str:
    """创建带签发时间和过期时间的 HS256 JWT。"""
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.auth_token_expire_days)
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": expires_at, "type": "access"},
        settings.auth_secret,
        algorithm=algorithm,
    )


def decode_access_token(token: str) -> UUID | None:
    """校验 JWT 签名、有效期和类型，失败统一返回 None。"""
    try:
        payload = jwt.decode(token, get_settings().auth_secret, algorithms=[algorithm])
        if payload.get("type") != "access":
            return None
        return UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return None
