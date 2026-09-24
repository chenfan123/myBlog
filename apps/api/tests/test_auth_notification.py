from datetime import UTC, datetime
from types import SimpleNamespace

from app.core.config import get_settings
from app.services import auth_notification


def configure_settings(monkeypatch) -> None:
    settings = SimpleNamespace(
        auth_notify_email="owner@example.com",
        bootstrap_admin_email=None,
        mail_from="CHEN.DEV <notice@example.com>",
        mail_host="smtp.example.com",
        mail_port=587,
        mail_secure=False,
        mail_user=None,
        mail_password=None,
    )
    monkeypatch.setattr(auth_notification, "get_settings", lambda: settings)
    get_settings.cache_clear()


def test_build_auth_notification_separates_account_details(monkeypatch) -> None:
    configure_settings(monkeypatch)

    message = auth_notification.build_auth_notification(
        event="register",
        user_id="user-123",
        email="new-user@example.com",
        display_name="测试用户",
        is_admin=False,
        client_ip="203.0.113.8",
        user_agent="Test Browser",
        occurred_at=datetime(2026, 9, 24, 1, 2, 3, tzinfo=UTC),
    )

    assert message is not None
    assert message["To"] == "owner@example.com"
    assert "新用户注册" in message["Subject"]
    text = message.get_body(preferencelist=("plain",)).get_content()
    assert "new-user@example.com" in text
    assert "203.0.113.8" in text
    assert "密码" not in text
    assert "验证码" not in text


def test_notification_failure_does_not_escape(monkeypatch) -> None:
    configure_settings(monkeypatch)
    monkeypatch.setattr(
        auth_notification,
        "_deliver_message",
        lambda _message: (_ for _ in ()).throw(RuntimeError("SMTP down")),
    )

    auth_notification.send_auth_notification(
        event="login",
        user_id="user-123",
        email="user@example.com",
        display_name="测试用户",
        is_admin=False,
        client_ip="203.0.113.8",
        user_agent=None,
    )
