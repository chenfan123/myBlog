"""基于登录 Cookie 的身份认证与管理员权限依赖。"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.user import User
from app.services.auth import decode_access_token, get_user_by_id


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """校验 HttpOnly Cookie 中的 JWT，并返回仍处于启用状态的用户。"""
    token = request.cookies.get(get_settings().auth_cookie_name)
    user_id = decode_access_token(token) if token else None
    user = get_user_by_id(db, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效",
        )
    return user


def require_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """只允许管理员继续执行接口；普通登录用户返回 403。"""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账户没有管理员权限",
        )
    return user
