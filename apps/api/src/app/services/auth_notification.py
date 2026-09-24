"""注册和登录成功后的管理员邮件通知。"""

import logging
import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from html import escape
from typing import Literal
from zoneinfo import ZoneInfo

from app.core.config import get_settings

logger = logging.getLogger(__name__)

AuthEvent = Literal["register", "login"]


def send_auth_notification(
    *,
    event: AuthEvent,
    user_id: str,
    email: str,
    display_name: str,
    is_admin: bool,
    client_ip: str,
    user_agent: str | None,
    occurred_at: datetime | None = None,
) -> None:
    """发送管理员通知；任何异常只写日志，不能影响用户认证流程。"""
    try:
        message = build_auth_notification(
            event=event,
            user_id=user_id,
            email=email,
            display_name=display_name,
            is_admin=is_admin,
            client_ip=client_ip,
            user_agent=user_agent,
            occurred_at=occurred_at,
        )
        if message is None:
            return
        _deliver_message(message)
    except Exception:
        logger.exception("Failed to send auth notification", extra={"event": event})


def build_auth_notification(
    *,
    event: AuthEvent,
    user_id: str,
    email: str,
    display_name: str,
    is_admin: bool,
    client_ip: str,
    user_agent: str | None,
    occurred_at: datetime | None = None,
) -> EmailMessage | None:
    """构造不包含密码、验证码或令牌的通知邮件。"""
    settings = get_settings()
    recipient = settings.auth_notify_email or settings.bootstrap_admin_email
    if not recipient or not settings.mail_from:
        logger.info("Auth notification skipped because recipient is not configured")
        return None

    event_label = "新用户注册" if event == "register" else "用户登录"
    timestamp = occurred_at or datetime.now(UTC)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    local_time = timestamp.astimezone(ZoneInfo("Asia/Shanghai"))
    formatted_time = local_time.strftime("%Y-%m-%d %H:%M:%S %Z")
    safe_agent = user_agent or "未知"

    details = [
        ("事件", event_label),
        ("账号邮箱", email),
        ("显示名称", display_name),
        ("用户 ID", user_id),
        ("账号类型", "管理员" if is_admin else "普通用户"),
        ("发生时间", formatted_time),
        ("来源 IP", client_ip),
        ("客户端", safe_agent),
    ]

    message = EmailMessage()
    message["Subject"] = f"CHEN.DEV · {event_label}通知"
    message["From"] = settings.mail_from
    message["To"] = recipient
    message.set_content("\n".join(f"{label}：{value}" for label, value in details))
    rows = "".join(
        '<tr><td style="padding:9px 12px;color:#667085;white-space:nowrap">'
        f"{escape(label)}</td>"
        '<td style="padding:9px 12px;color:#17212b;word-break:break-all">'
        f"{escape(str(value))}</td></tr>"
        for label, value in details
    )
    message.add_alternative(
        '<div style="font-family:Arial,sans-serif;background:#f7f7f1;padding:32px">'
        '<div style="max-width:620px;margin:auto;background:#fff;border:1px solid '
        '#e1e4d6;border-radius:20px;padding:32px">'
        '<p style="color:#629b00;letter-spacing:2px;font-size:12px">'
        "CHEN.DEV · AUTH NOTICE</p>"
        f'<h1 style="font-size:24px;color:#17212b">{escape(event_label)}</h1>'
        '<table style="width:100%;border-collapse:collapse;font-size:14px">'
        f"{rows}</table>"
        '<p style="margin-top:24px;color:#98a2b3;font-size:12px">'
        "安全说明：邮件不包含密码、验证码或登录令牌。</p>"
        "</div></div>",
        subtype="html",
    )
    return message


def _deliver_message(message: EmailMessage) -> None:
    settings = get_settings()
    if not settings.mail_host:
        raise RuntimeError("mail service is not configured")
    password = (
        settings.mail_password.get_secret_value() if settings.mail_password else ""
    )
    if settings.mail_secure:
        with smtplib.SMTP_SSL(
            settings.mail_host,
            settings.mail_port,
            timeout=10,
            context=ssl.create_default_context(),
        ) as smtp:
            if settings.mail_user:
                smtp.login(settings.mail_user, password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=10) as smtp:
        smtp.ehlo()
        if smtp.has_extn("starttls"):
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        if settings.mail_user:
            smtp.login(settings.mail_user, password)
        smtp.send_message(message)
