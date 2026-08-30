import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.security import require_admin
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.auth import create_access_token, decode_access_token, password_hash


def test_password_is_hashed_and_verified() -> None:
    encoded = password_hash.hash("Password123")

    assert encoded != "Password123"
    assert password_hash.verify("Password123", encoded)
    assert not password_hash.verify("WrongPassword123", encoded)


def test_access_token_round_trip() -> None:
    user_id = uuid.uuid4()

    token = create_access_token(user_id)

    assert decode_access_token(token) == user_id


def test_registration_normalizes_email() -> None:
    request = RegisterRequest(
        display_name=" 测试用户 ",
        email=" USER@Example.com ",
        password="Password123",
        email_code="123456",
    )

    assert request.display_name == "测试用户"
    assert request.email == "user@example.com"


def test_login_requires_and_preserves_captcha_param() -> None:
    request = LoginRequest(
        email=" USER@Example.com ",
        password="Password123",
        captcha_verify_param="captcha-token",
    )

    assert request.email == "user@example.com"
    assert request.captcha_verify_param == "captcha-token"


def test_admin_dependency_accepts_admin_user() -> None:
    user = SimpleNamespace(is_admin=True)

    assert require_admin(user) is user


def test_admin_dependency_rejects_regular_user() -> None:
    with pytest.raises(HTTPException) as error:
        require_admin(SimpleNamespace(is_admin=False))

    assert error.value.status_code == 403
