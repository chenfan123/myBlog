"""邮箱验证码的 Redis、限流和 SMTP 发送逻辑。"""

import hmac
import logging
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from functools import lru_cache

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailCodeRateLimitedError(Exception):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(retry_after, 1)
        super().__init__("email verification code rate limited")


class EmailServiceUnavailableError(Exception):
    pass


@lru_cache
def get_redis() -> Redis:
    """复用线程安全的 Redis 客户端，避免每次请求重复创建连接池。"""
    return Redis.from_url(get_settings().redis_url, decode_responses=True)


def _email_key(email: str) -> str:
    """用摘要生成 Redis key，避免在 Redis key 中直接出现邮箱。"""
    digest = hmac.digest(b"myblog-email-key", email.strip().lower().encode(), "sha256")
    return digest.hex()


def _code_digest(email: str, code: str) -> str:
    """使用服务端密钥计算验证码摘要，Redis 不保存 6 位验证码明文。"""
    secret = get_settings().auth_secret.encode()
    return hmac.new(
        secret, f"{email.strip().lower()}:{code}".encode(), "sha256"
    ).hexdigest()


def get_email_code_retry_after(email: str) -> int:
    """返回邮箱冷却键剩余秒数；0 表示当前允许发送。"""
    key = _email_key(email)
    try:
        ttl = get_redis().ttl(f"auth:email-code:cooldown:{key}")
    except RedisError as error:
        logger.exception("Redis unavailable while checking email cooldown")
        raise EmailServiceUnavailableError from error
    return max(ttl, 0)


def send_registration_code(email: str) -> tuple[int, int]:
    """原子获取发送资格、保存验证码摘要，然后通过 SMTP 发送邮件。"""
    settings = get_settings()
    redis = get_redis()
    key = _email_key(email)
    cooldown_key = f"auth:email-code:cooldown:{key}"
    code_key = f"auth:email-code:value:{key}"
    attempts_key = f"auth:email-code:attempts:{key}"

    try:
        # nx=True 表示 key 不存在时才写入；两个并发请求只能有一个成功。
        # ex 设置自动过期秒数，因此无需额外清理这些临时数据。
        acquired = redis.set(
            cooldown_key,
            "1",
            ex=settings.email_code_cooldown_seconds,
            nx=True,
        )
        if not acquired:
            raise EmailCodeRateLimitedError(redis.ttl(cooldown_key))

        # secrets 适合生成安全随机数，zfill 效果由 :06d 格式完成。
        code = f"{secrets.randbelow(1_000_000):06d}"
        redis.set(
            code_key,
            _code_digest(email, code),
            ex=settings.email_code_expire_seconds,
        )
        redis.delete(attempts_key)
    except EmailCodeRateLimitedError:
        raise
    except RedisError as error:
        logger.exception("Redis unavailable while creating email verification code")
        raise EmailServiceUnavailableError from error

    try:
        _send_email(email, code)
    except Exception as error:
        # 邮件没有发出时撤销冷却，允许用户立即重试。
        try:
            redis.delete(cooldown_key, code_key, attempts_key)
        except RedisError:
            logger.exception("Failed to roll back email verification keys")
        logger.exception("Failed to send registration verification email")
        raise EmailServiceUnavailableError from error

    logger.info("Registration verification email sent")
    return settings.email_code_cooldown_seconds, settings.email_code_expire_seconds


def verify_registration_code(email: str, code: str) -> bool:
    """校验一次性验证码；成功即删除，连续输错达到上限也会删除。"""
    settings = get_settings()
    redis = get_redis()
    key = _email_key(email)
    code_key = f"auth:email-code:value:{key}"
    attempts_key = f"auth:email-code:attempts:{key}"

    try:
        stored_digest = redis.get(code_key)
        if not stored_digest:
            return False
        # compare_digest 使用恒定时间比较，减少通过耗时猜测摘要的风险。
        if not hmac.compare_digest(stored_digest, _code_digest(email, code)):
            attempts = redis.incr(attempts_key)
            redis.expire(attempts_key, settings.email_code_expire_seconds)
            if attempts >= settings.email_code_max_attempts:
                redis.delete(code_key, attempts_key)
            return False
        redis.delete(code_key, attempts_key)
        return True
    except RedisError as error:
        logger.exception("Redis unavailable while verifying email code")
        raise EmailServiceUnavailableError from error


def _send_email(recipient: str, code: str) -> None:
    """构造纯文本/HTML 双格式邮件，并根据配置连接 SMTP。"""
    settings = get_settings()
    if not settings.mail_host or not settings.mail_from:
        raise RuntimeError("mail service is not configured")

    message = EmailMessage()
    message["Subject"] = "CHEN.DEV 注册验证码"
    message["From"] = settings.mail_from
    message["To"] = recipient
    message.set_content(
        f"你的 CHEN.DEV 注册验证码是：{code}\n\n验证码 10 分钟内有效，请勿转发给他人。"
    )
    email_html = (
        '<div style="font-family:Arial,sans-serif;background:#f7f7f1;'
        'padding:32px;color:#17202a">'
        '<div style="max-width:520px;margin:auto;background:#fff;'
        'border:1px solid #e1e4d6;border-radius:20px;padding:36px">'
        '<p style="color:#629b00;letter-spacing:2px;font-size:12px">'
        "CHEN.DEV · VERIFY EMAIL</p>"
        '<h1 style="font-size:24px;margin:18px 0">确认你的注册邮箱</h1>'
        '<p style="color:#68727d;line-height:1.7">'
        "请输入下面的验证码完成注册：</p>"
        '<div style="margin:28px 0;padding:18px;text-align:center;'
        "background:#eef5d9;border-radius:14px;font-size:34px;"
        f'font-weight:700;letter-spacing:8px">{code}</div>'
        '<p style="color:#68727d;font-size:13px">'
        "验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>"
        "</div></div>"
    )
    message.add_alternative(email_html, subtype="html")

    password = (
        settings.mail_password.get_secret_value() if settings.mail_password else ""
    )
    if settings.mail_secure:
        # MAIL_SECURE=true 通常用于 465 端口，从连接开始就是 TLS。
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
        # 587 端口通常先建立普通连接，再通过 STARTTLS 升级为加密连接。
        smtp.ehlo()
        if smtp.has_extn("starttls"):
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        if settings.mail_user:
            smtp.login(settings.mail_user, password)
        smtp.send_message(message)
