from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Named(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True


class Proxy(Named):
    url: str

    @field_validator("url")
    @classmethod
    def validate_proxy(cls, value):
        value = value.strip().replace("：", ":")
        if "://" not in value:
            value = "http://" + value
        p = urlsplit(value)
        if (
            p.scheme not in {"http", "https", "socks5", "socks5h"}
            or not p.hostname
            or not p.port
        ):
            raise ValueError("请输入合法代理地址，如 http://127.0.0.1:7890")
        if p.path not in {"", "/"} or p.query or p.fragment:
            raise ValueError("代理地址不能包含路径或查询参数")
        return value


class Account(Named):
    site: Literal["rednote", "xiaohongshu"] = "rednote"
    phone: str = ""
    zone: str = "1"
    cookie: str = ""
    sms_key: str = ""
    use_proxy: bool = False
    proxy_id: str | None = None


class Endpoint(Named):
    base_url: str
    api_key: str = ""

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value):
        p = urlsplit(value)
        if (
            p.scheme not in {"http", "https"}
            or not p.hostname
            or p.username
            or p.password
            or p.query
            or p.fragment
        ):
            raise ValueError("请输入 HTTP 或 HTTPS 服务地址，不要在地址中填写密钥")
        return value.rstrip("/")


class Provider(Endpoint):
    protocol: Literal["openai-compatible"] = "openai-compatible"
    model: str = Field(min_length=1)


class Dify(Endpoint):
    mode: Literal["workflow", "chat"] = "workflow"
    input_variable: str = Field(default="content", min_length=1)


class Geo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Task(Named):
    keyword: str = Field(min_length=1, max_length=200)
    interval_seconds: int = Field(default=300, ge=10)
    request_interval_seconds: int = Field(default=5, ge=1)
    randomize_task_interval: bool = True
    task_interval_jitter_seconds: int = Field(default=60, ge=1, le=86400)
    randomize_request_interval: bool = True
    request_interval_jitter_seconds: int = Field(default=3, ge=1, le=3600)
    max_items: int = Field(default=20, ge=1, le=1000)
    fetch_content: bool = False
    account_id: str
    use_proxy: bool = False
    proxy_id: str | None = None
    sort_type_choice: int = Field(default=0, ge=0, le=4)
    note_type: int = Field(default=0, ge=0, le=2)
    note_time: int = Field(default=0, ge=0, le=3)
    note_range: int = Field(default=0, ge=0, le=3)
    pos_distance: int = Field(default=0, ge=0, le=2)
    geo: Geo | None = None
    dify_preset_id: str | None = None
    ai_provider_id: str | None = None
    status: Literal["draft", "running", "paused"] = "draft"

    @model_validator(mode="after")
    def validate_proxy_choice(self):
        if self.use_proxy and not self.proxy_id:
            raise ValueError("开启代理后必须选择代理")
        if not self.use_proxy:
            self.proxy_id = None
        if self.pos_distance and self.geo is None:
            raise ValueError("选择同城或附近筛选时必须填写经纬度")
        return self


MODELS = {
    "proxies": Proxy,
    "accounts": Account,
    "providers": Provider,
    "dify": Dify,
    "tasks": Task,
}
