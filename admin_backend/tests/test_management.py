import httpx
import pytest
from fastapi.testclient import TestClient

from app import create_app, services, storage
from app.adapters.spider_xhs import SpiderXHSAdapter


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA", tmp_path)
    # Prevent scheduled real network requests during isolated API tests.
    monkeypatch.setattr("app.scheduler", lambda stop: None)
    with TestClient(create_app()) as client:
        yield client


def create(client, kind, body):
    r = client.post("/api/" + kind, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_persistence_and_secret_redaction(client):
    item = create(
        client,
        "providers",
        {
            "name": "test",
            "base_url": "http://localhost/v1",
            "api_key": "private-secret",
            "model": "test-model",
        },
    )
    assert "api_key" not in item
    assert item["has_api_key"]
    assert b"private-secret" not in (storage.DATA / "admin.sqlite3").read_bytes()
    with TestClient(create_app()) as restarted:
        assert restarted.get("/api/providers").json()[0]["id"] == item["id"]
    assert storage.get("providers", item["id"])["api_key"] == "private-secret"
    updated = client.put(
        "/api/providers/" + item["id"],
        json={
            "name": "changed",
            "base_url": "http://localhost/v1",
            "api_key": "",
            "model": "model-2",
        },
    )
    assert updated.status_code == 200
    assert storage.get("providers", item["id"])["api_key"] == "private-secret"


def test_proxy_off_clears_choice_and_never_falls_back(client):
    proxy = create(client, "proxies", {"name": "local", "url": "127.0.0.1:7890"})
    account = create(client, "accounts", {"name": "ca", "cookie": "fake-cookie"})
    task = create(
        client,
        "tasks",
        {
            "name": "test",
            "keyword": "coffee",
            "account_id": account["id"],
            "use_proxy": False,
            "proxy_id": proxy["id"],
        },
    )
    assert task["proxy_id"] is None
    assert services.proxy_url(task) is None
    body = {
        "name": "test",
        "keyword": "coffee",
        "account_id": account["id"],
        "use_proxy": True,
    }
    assert client.post("/api/tasks", json=body).status_code == 422
    body["proxy_id"] = proxy["id"]
    task2 = create(client, "tasks", body)
    assert services.proxy_url(task2) == "http://127.0.0.1:7890"
    assert client.delete("/api/proxies/" + proxy["id"]).status_code == 409


@pytest.mark.parametrize("fetch_content", [False, True])
def test_sample_keeps_raw_data_and_search_options(client, monkeypatch, fetch_content):
    account = create(client, "accounts", {"name": "ca", "cookie": "fake-cookie"})
    task = create(
        client,
        "tasks",
        {
            "name": "search",
            "keyword": "coffee",
            "account_id": account["id"],
            "sort_type_choice": 2,
            "fetch_content": fetch_content,
            "note_type": 1,
            "pos_distance": 1,
            "geo": {"latitude": 43.65, "longitude": -79.38},
        },
    )

    class FakeAdapter:
        def search_notes(self, keyword, max_items, options, single_page, **kwargs):
            assert kwargs["fetch_content"] is fetch_content
            assert keyword == "coffee"
            assert max_items == 20
            assert single_page is True
            assert options["sort_type_choice"] == 2
            assert options["note_type"] == 1
            assert options["geo"] == {"latitude": 43.65, "longitude": -79.38}
            return [
                {
                    "note_card": {
                        "display_title": "coffee",
                        "secret": "hidden",
                        "likes": 0,
                    }
                }
            ]

    monkeypatch.setattr(services, "adapter", lambda *args: FakeAdapter())
    response = client.post("/api/tasks/" + task["id"] + "/sample")
    assert response.status_code == 200
    run = response.json()
    assert run["notes"][0]["note_card"]["secret"] == "hidden"
    assert run["search"]["sort_type_choice"] == 2
    assert run["search"]["fetch_content"] is fetch_content
    assert "paragraphs" not in run
    assert client.get("/api/runs").json()[0]["id"] == run["id"]


def test_validation_does_not_echo_key(client):
    response = client.post(
        "/api/providers",
        json={"name": "test", "base_url": "bad-url", "api_key": "secret", "model": "x"},
    )
    assert response.status_code == 422
    assert "secret" not in response.text


def test_delete_and_disabled_proxy_fail_closed(client):
    item = create(
        client,
        "proxies",
        {"name": "disabled", "url": "http://127.0.0.1:7890", "enabled": False},
    )
    response = client.post(
        "/api/accounts",
        json={"name": "account", "use_proxy": True, "proxy_id": item["id"]},
    )
    assert response.status_code == 400
    assert client.delete("/api/proxies/" + item["id"]).status_code == 204
    assert client.get("/api/proxies").json() == []


def test_task_search_defaults_and_geo_validation(client):
    account = create(client, "accounts", {"name": "ca"})
    base = {"name": "search", "keyword": "coffee", "account_id": account["id"]}
    task = create(client, "tasks", base)
    assert [task[key] for key in ("sort_type_choice", "note_type", "note_time", "note_range", "pos_distance")] == [0, 0, 0, 0, 0]
    assert client.post("/api/tasks", json={**base, "pos_distance": 1}).status_code == 422
    assert client.post("/api/tasks", json={**base, "pos_distance": 1, "geo": {"latitude": 120, "longitude": 0}}).status_code == 422


def test_ai_provider_uses_saved_key_and_model(client, monkeypatch):
    item = create(
        client,
        "providers",
        {
            "name": "ai",
            "base_url": "https://ai.example/v1",
            "api_key": "test-key",
            "model": "model-a",
        },
    )
    real_client = httpx.Client
    seen = []

    def transport(request):
        seen.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "model-a"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "回答"}}]})

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(
            transport=httpx.MockTransport(transport), trust_env=False
        ),
    )
    result = client.post("/api/providers/" + item["id"] + "/test")
    assert result.status_code == 200
    assert result.json()["model_available"] is True
    response = client.post(
        "/api/providers/" + item["id"] + "/generate", json={"prompt": "测试"}
    )
    assert response.json()["text"] == "回答"
    assert seen[1].headers["authorization"] == "Bearer test-key"
    import json

    assert json.loads(seen[1].content)["model"] == "model-a"


def test_dify_workflow_payload_and_proxy(monkeypatch):
    real_client = httpx.Client
    settings = {}

    def transport(request):
        import json

        assert json.loads(request.content)["inputs"]["content"] == '{"notes": [1]}'
        assert request.url.path == "/v1/workflows/run"
        return httpx.Response(200, json={"data": {"status": "succeeded"}})

    def factory(**kwargs):
        settings.update(kwargs)
        return real_client(transport=httpx.MockTransport(transport), trust_env=False)

    monkeypatch.setattr(httpx, "Client", factory)
    result = services.dify_send(
        {
            "mode": "workflow",
            "base_url": "https://dify.example/v1",
            "api_key": "key",
            "input_variable": "content",
        },
        {"notes": [1]},
        "http://127.0.0.1:7890",
    )
    assert result["data"]["status"] == "succeeded"
    assert settings["proxy"] == "http://127.0.0.1:7890"
    assert settings["trust_env"] is False


def test_account_token_is_kept_encrypted_and_reveal_is_explicit(client):
    token = "a1=private-a1; web_session=private-session"
    account = create(
        client, "accounts", {"name": "manual", "phone": "4165550123", "cookie": token}
    )
    assert account["has_cookie"] is True
    assert "cookie" not in account
    assert token.encode() not in (storage.DATA / "admin.sqlite3").read_bytes()
    assert client.get(f"/api/accounts/{account['id']}/secret").json() == {
        "cookie": token
    }
    updated = client.put(
        f"/api/accounts/{account['id']}",
        json={
            "name": "manual edited",
            "phone": "4165550123",
            "cookie": "",
            "use_proxy": False,
        },
    )
    assert updated.status_code == 200
    assert storage.secret("accounts", account["id"], "cookie") == token
    assert not any(
        "sms-login" in path for path in client.get("/openapi.json").json()["paths"]
    )


def test_token_shape_is_checked_before_upstream_network():
    with pytest.raises(ValueError, match="请编辑账号"):
        SpiderXHSAdapter(cookie="")._auth()
    with pytest.raises(ValueError, match="缺少 web_session"):
        SpiderXHSAdapter(cookie="a1=present")._auth()


def test_account_check_reports_actionable_error(client, monkeypatch):
    account = create(
        client, "accounts", {"name": "bad", "cookie": "a1=old; web_session=old"}
    )

    class BrokenAdapter:
        def check(self):
            raise RuntimeError(
                "HTTP 406 invalid cookie Authorization: Bearer secret-value"
            )

    monkeypatch.setattr("app.api.management.adapter", lambda account: BrokenAdapter())
    result = client.post(f"/api/accounts/{account['id']}/check")
    assert result.status_code == 200
    assert result.json()["status"] == "check_failed"
    assert "HTTP 406" in result.json()["last_error"]
    assert "secret-value" not in result.text


def test_expired_account_token_gives_replacement_instructions(client, monkeypatch):
    account = create(
        client,
        "accounts",
        {"name": "expired", "cookie": "a1=old; web_session=old"},
    )

    class ExpiredAdapter:
        def check(self):
            raise RuntimeError("bootstrap user/me failed: 登录已过期")

    monkeypatch.setattr("app.api.management.adapter", lambda account: ExpiredAdapter())
    result = client.post(f"/api/accounts/{account['id']}/check").json()
    assert "Cookie Token 已过期" in result["last_error"]
    assert "替换 Token" in result["last_error"]


def test_startup_preserves_sms_credentials_for_code_retrieval(client):
    legacy = storage.save(
        "accounts",
        {
            "name": "legacy",
            "phone": "4165550123",
            "cookie": "cookie",
            "sms_key": "retired-secret",
        },
    )
    assert storage.secret("accounts", legacy["id"], "sms_key") == "retired-secret"
    storage.initialize()
    account = storage.get("accounts", legacy["id"])
    assert account["sms_key"] == "retired-secret"
    assert storage.secret("accounts", legacy["id"], "sms_key") == "retired-secret"
    assert b"retired-secret" not in (storage.DATA / "admin.sqlite3").read_bytes()
