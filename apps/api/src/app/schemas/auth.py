"""认证接口的 Pydantic 数据模型。

Schema 用来校验 HTTP 请求数据和限定响应字段，不等同于数据库 ORM 模型。
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RegisterRequest(BaseModel):
    """注册接口允许接收的字段。字段长度和格式会在进入路由前自动校验。"""

    display_name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    email_code: str = Field(pattern=r"^\d{6}$")

    @field_validator("display_name", "email")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.lower()
        if (
            "@" not in normalized
            or normalized.startswith("@")
            or normalized.endswith("@")
        ):
            raise ValueError("请输入有效的邮箱地址")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(character.isalpha() for character in value):
            raise ValueError("密码必须包含字母")
        if not any(character.isdigit() for character in value):
            raise ValueError("密码必须包含数字")
        return value


class LoginRequest(BaseModel):
    """登录请求包含账号密码，以及阿里云验证码的一次性验签参数。"""

    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    captcha_verify_param: str = Field(min_length=1, max_length=8192)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class SendEmailCodeRequest(BaseModel):
    """发送邮件前，需要提交阿里云验证码返回的完整验签参数。"""

    email: str = Field(min_length=5, max_length=320)
    # V3 CaptchaVerifyParam 是 Base64 字符串，必须原样传给阿里云服务端。
    captcha_verify_param: str = Field(min_length=1, max_length=8192)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if (
            "@" not in normalized
            or normalized.startswith("@")
            or normalized.endswith("@")
        ):
            raise ValueError("请输入有效的邮箱地址")
        return normalized


class SendEmailCodeResponse(BaseModel):
    """告诉前端倒计时和验证码有效期，不返回真实验证码。"""

    message: str
    retry_after_seconds: int
    expires_in_seconds: int


class ForgotPasswordCodeRequest(BaseModel):
    """忘记密码时发送验证码；服务端只允许已注册邮箱使用。"""

    email: str = Field(min_length=5, max_length=320)
    captcha_verify_param: str = Field(min_length=1, max_length=8192)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("请输入有效的邮箱地址")
        return normalized


class ResetPasswordRequest(BaseModel):
    """使用邮箱验证码设置新密码。"""

    email: str = Field(min_length=5, max_length=320)
    email_code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(character.isalpha() for character in value) or not any(character.isdigit() for character in value):
            raise ValueError("密码必须包含字母和数字")
        return value


class UserResponse(BaseModel):
    """可以安全返回给前端的用户字段，刻意排除了 password_hash。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    is_admin: bool
    created_at: datetime


class AuthResponse(BaseModel):
    """登录/注册响应；JWT 在 Cookie 中，因此这里只返回用户信息。"""

    user: UserResponse
