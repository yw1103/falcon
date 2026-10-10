"""Only this module imports upstream code. No edits to Spider_XHS required."""

import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

from ..timing import randomized_interval


def load_upstream():
    root = Path(
        os.environ.get(
            "SPIDER_XHS_PATH", Path(__file__).resolve().parents[3] / "Spider_XHS"
        )
    )
    if not root.is_dir():
        raise RuntimeError("找不到 Spider_XHS，请配置 SPIDER_XHS_PATH")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


class SpiderXHSAdapter:
    def __init__(
        self, *, cookie, site="rednote", proxy=None, request_interval=1,
        randomize_request_interval=True, request_interval_jitter=3,
    ):
        self.cookie = cookie
        self.site = site
        self.proxy = proxy or {}
        self.request_interval = request_interval
        self.randomize_request_interval = randomize_request_interval
        self.request_interval_jitter = request_interval_jitter

    def _wait_request(self):
        time.sleep(randomized_interval(
            self.request_interval, self.randomize_request_interval,
            self.request_interval_jitter,
        ))

    def _auth(self):
        if not self.cookie.strip():
            raise ValueError(
                "账号没有已保存的 Token。请编辑账号并粘贴完整小红书 Cookie。"
            )
        names = {
            part.partition("=")[0].strip()
            for part in self.cookie.split(";")
            if "=" in part
        }
        missing = {"a1", "web_session"} - names
        if missing:
            raise ValueError(
                "Token 格式不完整：缺少 "
                + ", ".join(sorted(missing))
                + "。请粘贴完整请求 Cookie，至少包含 a1 和 web_session。"
            )
        load_upstream()
        from xhs_utils.xhs_pc.auth import XHSPcAuth
        from xhs_utils.xhs_pc.http import PcHttpClient

        client = PcHttpClient(proxies=self.proxy)
        client.session.trust_env = False
        try:
            return XHSPcAuth.from_cookie(
                self.cookie, site=self.site, proxies=self.proxy, http_client=client
            )
        except Exception:
            client.close()
            raise

    def check(self):
        auth = self._auth()
        try:
            return {"user_id": auth.user_id, "profile": dict(auth.user_profile)}
        finally:
            auth.close()

    def search_notes(
        self, keyword, max_items=20, options=None, single_page=False,
        fetch_content=False,
    ):
        auth = self._auth()
        from apis.xhs_pc_apis import XHS_Apis
        from xhs_utils.xhs_pc.params import generate_search_id

        try:
            api = XHS_Apis(auth)
            notes = []
            page = 1
            root_id = generate_search_id()
            while len(notes) < max_items:
                if page > 1:
                    self._wait_request()
                for attempt in range(2):
                    ok, message, result = api.search_note(
                        keyword,
                        page=page,
                        **(options or {}),
                        search_id=generate_search_id(root_id),
                        proxies=self.proxy,
                    )
                    if ok or "curl: (28)" not in str(message) or attempt:
                        break
                    self._wait_request()
                if not ok:
                    raise RuntimeError(f"Spider_XHS 搜索接口返回失败：{message}")
                if not isinstance(result, dict) or not isinstance(
                    result.get("data"), dict
                ):
                    raise RuntimeError(
                        "Spider_XHS 搜索接口返回了非预期数据结构；请确认上游版本与接口兼容。"
                    )
                data = result.get("data", {})
                batch = data.get("items", [])
                notes.extend(batch)
                if single_page or not batch or not data.get("has_more"):
                    break
                page += 1
            notes = notes[:max_items]
            if fetch_content:
                self._fetch_contents(api, auth, notes)
            return notes
        finally:
            auth.close()

    def _fetch_contents(self, api, auth, notes):
        from ..services import explain_error

        for note in notes:
            if note.get("model_type", "note") != "note":
                continue
            note_id = note.get("id") or note.get("note_id")
            token = note.get("xsec_token")
            if not note_id or not token:
                note["content_status"] = "failed"
                note["content_error"] = "搜索结果缺少笔记 ID 或详情访问凭据"
                continue
            self._wait_request()
            url = auth.origin("web") + "/explore/" + str(note_id) + "?" + urlencode(
                {"xsec_token": token, "xsec_source": "pc_search"}
            )
            try:
                ok, message, result = api.get_note_info(url, proxies=self.proxy)
                if not ok:
                    raise RuntimeError(message)
                if not isinstance(result, dict) or not result.get("data", {}).get("items"):
                    raise RuntimeError("详情接口未返回笔记内容")
                note["note_detail"] = result
                note["content_status"] = "success"
            except Exception as error:
                note["content_status"] = "failed"
                note["content_error"] = explain_error(error)
