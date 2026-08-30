"""腾讯验证码二次校验审计日志模型。"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CaptchaVerificationLog(Base):
    """日志保留 7 天；不保存 ticket、AppSecretKey 或原始邮箱。"""

    __tablename__ = "captcha_verification_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    # 邮箱经过 SHA-256 后再入库，便于统计同一邮箱但不暴露原始地址。
    email_digest: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_ip: Mapped[str] = mapped_column(String(45), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    response_code: Mapped[str | None] = mapped_column(String(32))
    response_message: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
