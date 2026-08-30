import fakeredis
import pytest

from app.services import email_verification
from app.services.email_verification import EmailCodeRateLimitedError


def setup_fake_email_service(monkeypatch: pytest.MonkeyPatch) -> fakeredis.FakeRedis:
    redis = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(email_verification, "get_redis", lambda: redis)
    monkeypatch.setattr(email_verification, "_send_email", lambda _email, _code: None)
    return redis


def test_email_code_is_single_use(monkeypatch: pytest.MonkeyPatch) -> None:
    setup_fake_email_service(monkeypatch)
    captured_code = ""

    def capture_code(_email: str, code: str) -> None:
        nonlocal captured_code
        captured_code = code

    monkeypatch.setattr(email_verification, "_send_email", capture_code)
    email_verification.send_registration_code("new-user@example.com")

    assert email_verification.verify_registration_code(
        "new-user@example.com", captured_code
    )
    assert not email_verification.verify_registration_code(
        "new-user@example.com", captured_code
    )


def test_email_code_send_is_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    setup_fake_email_service(monkeypatch)
    email_verification.send_registration_code("limited@example.com")

    with pytest.raises(EmailCodeRateLimitedError):
        email_verification.send_registration_code("limited@example.com")


def test_wrong_email_code_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    setup_fake_email_service(monkeypatch)
    email_verification.send_registration_code("wrong-code@example.com")

    assert not email_verification.verify_registration_code(
        "wrong-code@example.com", "000000"
    )
