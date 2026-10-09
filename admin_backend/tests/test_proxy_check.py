import httpx
from test_management import client, create  # noqa: F401


def test_proxy_check_follows_redirects_and_clears_previous_error(client, monkeypatch):  # noqa: F811
    proxy = create(client, "proxies", {"name": "local", "url": " 127.0.0.1：7890 "})
    assert proxy["url"] == "http://127.0.0.1:7890"
    from app import storage

    storage.save("proxies", {**proxy, "last_error": "previous error"})
    real_client = httpx.Client
    settings = {}
    paths = []

    def transport(request):
        paths.append(request.url.path)
        if request.url.path == "/":
            return httpx.Response(302, headers={"Location": "/explore"})
        return httpx.Response(200, text="ok")

    def factory(**kwargs):
        settings.update(kwargs)
        return real_client(transport=httpx.MockTransport(transport), follow_redirects=kwargs["follow_redirects"])

    monkeypatch.setattr("app.api.management.httpx.Client", factory)
    response = client.post(f"/api/proxies/{proxy['id']}/check")
    assert response.json()["status"] == "healthy"
    assert "last_error" not in response.json()
    assert settings["proxy"] == "http://127.0.0.1:7890"
    assert settings["trust_env"] is False
    assert paths == ["/", "/explore"]
