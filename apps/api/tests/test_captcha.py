from types import SimpleNamespace

from starlette.requests import Request

from app.services import captcha
from app.services.captcha import CaptchaVerificationResult


def test_client_ip_prefers_forwarded_header() -> None:
    request = Request(
        {
            "type": "http",
            "client": ("127.0.0.1", 1234),
            "headers": [(b"x-forwarded-for", b"203.0.113.10, 10.0.0.2")],
        }
    )

    assert captcha.get_client_ip(request) == "203.0.113.10"


def test_captcha_scene_error_has_specific_message() -> None:
    result = CaptchaVerificationResult(False, "F005", "scene id invalid")

    assert "场景配置" in captcha.get_captcha_error_message(result)


def test_verify_captcha_submits_param_and_scene_id(monkeypatch) -> None:
    captured = {}

    class FakeClient:
        def verify_intelligent_captcha(self, request):
            captured["param"] = request.captcha_verify_param
            captured["scene_id"] = request.scene_id
            return SimpleNamespace(
                body=SimpleNamespace(
                    success=True,
                    message="success",
                    result=SimpleNamespace(verify_result=True, verify_code="T001"),
                )
            )

    settings = SimpleNamespace(
        captcha_required=True,
        aliyun_captcha_scene_id="scene-test",
        aliyun_access_key_id=object(),
        aliyun_access_key_secret=object(),
    )
    monkeypatch.setattr(captcha, "get_settings", lambda: settings)
    monkeypatch.setattr(captcha, "_create_aliyun_captcha_client", FakeClient)

    result = captcha.verify_captcha('{"key":"value"}')

    assert result.success is True
    assert result.code == "T001"
    assert captured == {"param": '{"key":"value"}', "scene_id": "scene-test"}
