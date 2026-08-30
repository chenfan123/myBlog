"""阿里云验证码 2.0 验签、审计记录和定时清理。"""

import asyncio
import hashlib
import ipaddress
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from alibabacloud_captcha20230305.client import Client as CaptchaClient
from alibabacloud_captcha20230305.models import VerifyIntelligentCaptchaRequest
from alibabacloud_tea_openapi.models import Config as AliyunConfig
from fastapi import Request
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.captcha_log import CaptchaVerificationLog

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CaptchaVerificationResult:
    """把阿里云返回结果转换为应用内部统一结构。"""

    success: bool
    code: str
    message: str


def get_client_ip(request: Request) -> str:
    """按代理头、真实 IP 头、连接地址的优先级解析客户端 IP。"""
    candidates = [
        request.headers.get("x-forwarded-for", "").split(",", maxsplit=1)[0].strip(),
        request.headers.get("x-real-ip", "").strip(),
        request.client.host if request.client else "",
    ]
    for candidate in candidates:
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return "127.0.0.1"


def get_captcha_error_message(result: CaptchaVerificationResult) -> str:
    """将阿里云错误码转换为适合直接展示给用户的中文提示。"""
    if result.code in {"F014", "F019"}:
        return "验证码已失效，请重新验证"
    if result.code in {"F005", "F006", "F012", "F020"}:
        return "验证码场景配置不匹配，请刷新后重试"
    if result.code in {"F002", "F003", "F013", "F018"}:
        return "验证码参数无效或已使用，请重新验证"
    if result.code == "not_configured":
        return "验证码服务尚未配置"
    if result.code == "cloud_credentials_missing":
        return "后端缺少阿里云 AccessKey，请配置后重启服务"
    if result.code == "request_error":
        return "验证码服务暂时不可用，请稍后重试"
    return "验证码校验失败，请重新验证"


def verify_captcha(captcha_verify_param: str) -> CaptchaVerificationResult:
    """把前端 CaptchaVerifyParam 原样提交给阿里云进行二次验签。"""
    settings = get_settings()
    if not settings.captcha_required:
        return CaptchaVerificationResult(True, "disabled", "captcha disabled")
    if not settings.aliyun_captcha_scene_id:
        return CaptchaVerificationResult(False, "not_configured", "验证码服务未配置")
    if not settings.aliyun_access_key_id or not settings.aliyun_access_key_secret:
        return CaptchaVerificationResult(
            False,
            "cloud_credentials_missing",
            "Alibaba Cloud AccessKey is missing",
        )

    try:
        client = _create_aliyun_captcha_client()
        response = client.verify_intelligent_captcha(
            VerifyIntelligentCaptchaRequest(
                captcha_verify_param=captcha_verify_param,
                scene_id=settings.aliyun_captcha_scene_id,
            )
        )
    except Exception as error:
        logger.warning(
            "Alibaba captcha verification request failed: %s", type(error).__name__
        )
        return CaptchaVerificationResult(False, "request_error", "验证码服务暂时不可用")

    body = response.body
    result = body.result if body else None
    code = str(result.verify_code if result and result.verify_code else "unknown")
    message = str(body.message if body and body.message else code)[:255]
    success = bool(body and body.success and result and result.verify_result)
    return CaptchaVerificationResult(success, code, message)


def _create_aliyun_captcha_client() -> CaptchaClient:
    """使用服务端 RAM AccessKey 创建阿里云验证码客户端。"""
    settings = get_settings()
    access_key_id = settings.aliyun_access_key_id
    access_key_secret = settings.aliyun_access_key_secret
    if not access_key_id or not access_key_secret:
        raise ValueError("Alibaba Cloud AccessKey is missing")
    return CaptchaClient(
        AliyunConfig(
            access_key_id=access_key_id.get_secret_value(),
            access_key_secret=access_key_secret.get_secret_value(),
            endpoint=settings.aliyun_captcha_endpoint,
            region_id="cn-shanghai"
            if settings.aliyun_captcha_region == "cn"
            else "ap-southeast-1",
        )
    )


def record_captcha_verification(
    db: Session,
    *,
    action: str = "register",
    email: str,
    user_ip: str,
    result: CaptchaVerificationResult,
) -> None:
    """保存脱敏审计日志；日志中不包含 CaptchaVerifyParam 和 AccessKey。"""
    email_digest = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    db.add(
        CaptchaVerificationLog(
            action=action,
            email_digest=email_digest,
            user_ip=user_ip,
            success=result.success,
            response_code=result.code,
            response_message=result.message,
        )
    )
    db.commit()


def cleanup_expired_captcha_logs() -> int:
    """删除超过配置保留天数的验证码日志，并返回删除条数。"""
    cutoff = datetime.now(UTC) - timedelta(
        days=get_settings().captcha_log_retention_days
    )
    with SessionLocal() as db:
        result = db.execute(
            delete(CaptchaVerificationLog).where(
                CaptchaVerificationLog.created_at < cutoff
            )
        )
        db.commit()
        deleted_count = result.rowcount or 0
    if deleted_count:
        logger.info("Deleted %s expired captcha verification logs", deleted_count)
    return deleted_count


async def run_captcha_log_cleanup() -> None:
    """常驻后台循环：启动即清理一次，之后按配置时间间隔重复执行。"""
    interval = max(get_settings().captcha_log_cleanup_interval_seconds, 60)
    while True:
        try:
            await asyncio.to_thread(cleanup_expired_captcha_logs)
        except Exception:
            logger.exception("Failed to clean expired captcha verification logs")
        await asyncio.sleep(interval)
