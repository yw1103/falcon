from xhs_utils.xhs_core.auth import PC_PLATFORM_CONFIG, REDNOTE_PC_PLATFORM_CONFIG
from xhs_utils.xhs_pc.auth import XHSPcAuth
from xhs_utils.xhs_pc.dsl import DsFetcher
from xhs_utils.xhs_pc.params import get_request_headers_template


def test_bootstrap_retains_public_profile_without_an_extra_request():
    from apis.xhs_pc_apis import XHS_Apis

    auth = object.__new__(XHSPcAuth)
    api = object.__new__(XHS_Apis)
    api.auth = auth
    calls = []

    def get_user_me(proxies):
        calls.append(proxies)
        return True, "成功", {"data": {
            "user_id": "user", "nickname": "nickname", "red_id": "123",
            "gender": 0, "guest": False, "xsec_token": "private",
        }}

    api.get_user_me = get_user_me
    api.bootstrap()
    assert len(calls) == 1
    assert auth.user_profile["nickname"] == "nickname"
    assert auth.user_profile["gender"] == 0
    assert "xsec_token" not in auth.user_profile


def test_rednote_platform_uses_overseas_production_hosts():
    assert REDNOTE_PC_PLATFORM_CONFIG.cookie_domain == ".rednote.com"
    assert REDNOTE_PC_PLATFORM_CONFIG.origin("web") == "https://www.rednote.com"
    assert REDNOTE_PC_PLATFORM_CONFIG.origin("api") == "https://webapi.rednote.com"
    assert REDNOTE_PC_PLATFORM_CONFIG.origin("search") == "https://webapi.rednote.com"
    assert REDNOTE_PC_PLATFORM_CONFIG.origin("security") == "https://as.rednote.com"


def test_pc_auth_site_selects_config_without_changing_china_default():
    rednote = object.__new__(XHSPcAuth)
    rednote.site = "rednote"
    china = object.__new__(XHSPcAuth)
    china.site = "xiaohongshu"
    assert rednote.config is REDNOTE_PC_PLATFORM_CONFIG
    assert china.config is PC_PLATFORM_CONFIG


def test_pc_headers_use_selected_site_origin():
    headers = get_request_headers_template(site_origin="https://www.rednote.com")
    assert headers["origin"] == "https://www.rednote.com"
    assert headers["referer"] == "https://www.rednote.com/"


def test_regional_security_script_uses_selected_host_and_referer():
    class Response:
        text = "function getdss() { return '1234567890123' }"

        def raise_for_status(self):
            pass

    class Client:
        def get(self, url, **kwargs):
            self.url = url
            self.headers = kwargs["headers"]
            return Response()

    client = Client()
    fetcher = DsFetcher(url="https://as.rednote.com/api/sec/v1/ds?appId=xhs-pc-web")
    assert fetcher.get(http_client=client) == "1234567890123"
    assert client.url.startswith("https://as.rednote.com/")
    assert client.headers["Referer"] == "https://as.rednote.com/"


def test_rednote_security_fetch_uses_http1_session(monkeypatch):
    import requests

    class Response:
        text = "function getdss() { return '1234567890123' }"

        def raise_for_status(self):
            pass

    class Session:
        trust_env = True

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, **kwargs):
            assert self.trust_env is False
            assert url.startswith("https://as.rednote.com/")
            assert kwargs["timeout"] == 60
            assert kwargs["proxies"] == {"https": "http://proxy.test:8080"}
            return Response()

    monkeypatch.setattr(requests, "Session", Session)
    fetcher = DsFetcher(url="https://as.rednote.com/api/sec/v1/ds?appId=xhs-pc-web")
    assert fetcher.get(
        transport="requests", proxies={"https": "http://proxy.test:8080"}
    ) == "1234567890123"
