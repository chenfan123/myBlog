"""集中读取环境变量，并提供带类型的应用配置。"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

api_root = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Pydantic Settings 会自动把环境变量字符串转换成声明的 Python 类型。"""

    app_name: str = "MyBlog API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+psycopg://myblog:myblog_local@localhost:5432/myblog"
    auth_secret: str = "development-only-auth-secret-change-before-deploy"
    auth_cookie_name: str = "myblog_access_token"
    auth_token_expire_days: int = 7
    auth_cookie_secure: bool = False
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None
    bootstrap_admin_name: str = "管理员"
    # 阿里云验证码 2.0：客户端使用 prefix/SceneId，服务端使用 RAM AccessKey。
    aliyun_captcha_prefix: str | None = None
    # ekey 仅供服务端生成 EncryptedSceneId，禁止传给浏览器。
    aliyun_captcha_ekey: SecretStr | None = None
    aliyun_captcha_scene_id: str | None = None
    aliyun_captcha_region: str = "cn"
    aliyun_captcha_endpoint: str = "captcha.cn-shanghai.aliyuncs.com"
    aliyun_access_key_id: SecretStr | None = None
    aliyun_access_key_secret: SecretStr | None = None
    captcha_required: bool = True
    captcha_log_retention_days: int = 7
    captcha_log_cleanup_interval_seconds: int = 86400
    redis_url: str = "redis://localhost:6379/0"
    mail_host: str | None = Field(default=None, validation_alias="MAIL_HOST")
    mail_port: int = Field(default=587, validation_alias="MAIL_PORT")
    mail_secure: bool = Field(default=False, validation_alias="MAIL_SECURE")
    mail_user: str | None = Field(default=None, validation_alias="MAIL_USER")
    mail_password: SecretStr | None = Field(default=None, validation_alias="MAIL_PASS")
    mail_from: str | None = Field(default=None, validation_alias="MAIL_FROM")
    email_code_expire_seconds: int = 600
    email_code_cooldown_seconds: int = 50
    email_code_max_attempts: int = 5
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
        ],
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: list[str] | str) -> list[str] | str:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]

        return value

    model_config = SettingsConfigDict(
        # 本地同时读取 API .env 和 Web .env.local；系统环境变量优先级更高。
        env_file=(api_root / ".env", api_root.parent / "web" / ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """全进程只构造一次 Settings，避免每次请求重复读取环境文件。"""
    return Settings()
