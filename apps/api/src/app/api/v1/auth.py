"""注册、登录、退出及邮箱验证码接口。

APIRouter 类似其他后端框架中的 Controller：把一组相关接口组织在一起。
真正的密码、验证码和邮件逻辑位于 services 中，本文件只负责串联流程和返回 HTTP 状态。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    SendEmailCodeRequest,
    SendEmailCodeResponse,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_user_by_email,
)
from app.services.captcha import (
    get_captcha_error_message,
    get_client_ip,
    record_captcha_verification,
    verify_captcha,
)
from app.services.email_verification import (
    EmailCodeRateLimitedError,
    EmailServiceUnavailableError,
    get_email_code_retry_after,
    send_registration_code,
    verify_registration_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def set_auth_cookie(response: Response, token: str) -> None:
    """把 JWT 写入 HttpOnly Cookie，而不是把 token 返回给 JavaScript。"""
    settings = get_settings()
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_token_expire_days * 24 * 60 * 60,
        # HttpOnly 可阻止页面 JavaScript 读取 token，降低 XSS 窃取风险。
        httponly=True,
        # 生产环境为 True，只允许浏览器通过 HTTPS 发送 Cookie。
        secure=settings.auth_cookie_secure,
        # lax 可以拦截大部分跨站请求，同时不影响正常站内导航。
        samesite="lax",
        path="/",
    )


@router.post(
    "/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED
)
def register(
    data: RegisterRequest,
    response: Response,
    # Depends(get_db) 是 FastAPI 依赖注入：框架会自动传入数据库 Session。
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """校验邮箱验证码，创建用户，并在响应中写入登录 Cookie。"""
    # 先判断邮箱是否存在，避免不必要的 Redis 查询和数据库唯一键异常。
    if get_user_by_email(db, data.email) is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    try:
        # 邮箱验证码存储在 Redis，校验成功后会立即删除，因此只能使用一次。
        email_verified = verify_registration_code(data.email, data.email_code)
    except EmailServiceUnavailableError as error:
        raise HTTPException(status_code=503, detail="验证码服务暂时不可用") from error
    if not email_verified:
        raise HTTPException(status_code=400, detail="邮箱验证码错误或已过期")
    try:
        # create_user 内部会使用 Argon2 保存密码哈希，不保存明文密码。
        user = create_user(
            db,
            display_name=data.display_name,
            email=data.email,
            password=data.password,
        )
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="该邮箱已注册") from error
    # 注册成功后直接签发 JWT，实现“注册后自动登录”。
    set_auth_cookie(response, create_access_token(user.id))
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/email-code", response_model=SendEmailCodeResponse)
def send_email_code(
    data: SendEmailCodeRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> SendEmailCodeResponse:
    """通过阿里云验证码后，向未注册邮箱发送一次性验证码。"""
    if get_user_by_email(db, data.email) is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册")

    try:
        # 先查 Redis 冷却时间，避免用户刷新页面后重复验证和发送邮件。
        retry_after = get_email_code_retry_after(data.email)
    except EmailServiceUnavailableError as error:
        raise HTTPException(status_code=503, detail="验证码服务暂时不可用") from error
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail=f"发送过于频繁，请在 {retry_after} 秒后重试",
            headers={"Retry-After": str(retry_after)},
        )

    user_ip = get_client_ip(request)
    # 前端成功回调不能替代服务端验签，CaptchaVerifyParam 必须原样提交阿里云。
    captcha_result = verify_captcha(data.captcha_verify_param)
    # 审计日志只保存邮箱摘要、IP 和结果，不保存验签参数或 AccessKey。
    record_captcha_verification(
        db,
        action="send_email_code",
        email=data.email,
        user_ip=user_ip,
        result=captcha_result,
    )
    if not captcha_result.success:
        raise HTTPException(
            status_code=400,
            detail=get_captcha_error_message(captcha_result),
        )

    try:
        # Redis 使用 SET NX EX 保证同一邮箱在 50 秒内只有一个请求能成功。
        cooldown, expires_in = send_registration_code(data.email)
    except EmailCodeRateLimitedError as error:
        raise HTTPException(
            status_code=429,
            detail=f"发送过于频繁，请在 {error.retry_after} 秒后重试",
            headers={"Retry-After": str(error.retry_after)},
        ) from error
    except EmailServiceUnavailableError as error:
        raise HTTPException(
            status_code=503, detail="邮件发送失败，请稍后重试"
        ) from error

    return SendEmailCodeResponse(
        message="验证码已发送，请检查邮箱",
        retry_after_seconds=max(cooldown, 60),
        expires_in_seconds=expires_in,
    )


@router.post("/login", response_model=AuthResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """先完成阿里云验证码验签，再校验账号密码并建立登录状态。"""
    captcha_result = verify_captcha(data.captcha_verify_param)
    record_captcha_verification(
        db,
        action="login",
        email=data.email,
        user_ip=get_client_ip(request),
        result=captcha_result,
    )
    if not captcha_result.success:
        raise HTTPException(
            status_code=400,
            detail=get_captcha_error_message(captcha_result),
        )

    user = authenticate_user(db, email=data.email, password=data.password)
    if user is None:
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    set_auth_cookie(response, create_access_token(user.id))
    return AuthResponse(user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse)
def me(
    user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    """返回 Cookie 对应用户；身份解析由统一认证依赖完成。"""
    return UserResponse.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    """删除认证 Cookie。JWT 本身无状态，所以退出不需要修改数据库。"""
    settings = get_settings()
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
