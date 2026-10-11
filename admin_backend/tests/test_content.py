from urllib.parse import parse_qs, urlsplit

from app.adapters.spider_xhs import SpiderXHSAdapter


def test_homefeed_pagination_dedup_and_detail_source(monkeypatch):
    from app.adapters.spider_xhs import load_upstream

    load_upstream()
    calls, waits, details = [], [], []

    class Auth:
        closed = False

        def close(self):
            self.closed = True

    auth = Auth()

    class Api:
        def __init__(self, value):
            assert value is auth

        def get_homefeed_recommend(self, category, cursor, refresh, index, proxies):
            calls.append((category, cursor, refresh, index))
            items = [{"id": "a", "raw": 1}, {"id": "b"}] if not cursor else [{"id": "b"}, {"id": "c"}]
            return True, "ok", {"data": {"items": items, "cursor_score": "cursor"}}

    monkeypatch.setattr("apis.xhs_pc_apis.XHS_Apis", Api)
    adapter = SpiderXHSAdapter(cookie="unused")
    monkeypatch.setattr(adapter, "_auth", lambda: auth)
    monkeypatch.setattr(adapter, "_wait_request", lambda: waits.append(True))
    monkeypatch.setattr(adapter, "_fetch_contents", lambda api, auth, notes, source: details.append(source))
    notes = adapter.homefeed_notes("channel", 10, fetch_content=True)
    assert [n["id"] for n in notes] == ["a", "b", "c"]
    assert notes[0]["raw"] == 1
    assert calls == [("channel", "", 1, 0), ("channel", "cursor", 3, 20)]
    assert waits == [True]
    assert details == ["pc_feed"]
    assert auth.closed


def test_details_preserve_search_data_and_continue_after_failure(monkeypatch):
    waits = []
    monkeypatch.setattr("app.adapters.spider_xhs.time.sleep", waits.append)
    notes = [
        {"id": "first", "xsec_token": "a+b=", "note_card": {"display_title": "title"}},
        {"id": "second", "xsec_token": "expired"},
        {"id": "third", "xsec_token": "valid"},
        {"model_type": "user", "id": "user"},
        {"id": "missing-token"},
    ]
    raw_detail = {"success": True, "data": {"items": [{"note_card": {"desc": "body"}}]}}

    class Auth:
        def origin(self, kind):
            assert kind == "web"
            return "https://www.rednote.com"

    class Api:
        def get_note_info(self, url, proxies):
            parsed = urlsplit(url)
            assert parsed.hostname == "www.rednote.com"
            assert proxies == {"https": "http://proxy.test:8080"}
            assert parse_qs(parsed.query)["xsec_source"] == ["pc_search"]
            if parsed.path.endswith("first"):
                assert parse_qs(parsed.query)["xsec_token"] == ["a+b="]
            if parsed.path.endswith("second"):
                return False, "not found", None
            return True, "ok", raw_detail

    adapter = SpiderXHSAdapter(cookie="", proxy={"https": "http://proxy.test:8080"}, request_interval=5, randomize_request_interval=False)
    adapter._fetch_contents(Api(), Auth(), notes)
    assert notes[0]["note_card"] == {"display_title": "title"}
    assert notes[0]["note_detail"] == raw_detail
    assert notes[1]["content_status"] == "failed"
    assert notes[2]["content_status"] == "success"
    assert "content_status" not in notes[3]
    assert notes[4]["content_status"] == "failed"
    assert waits == [5, 5, 5]
