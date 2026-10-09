import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import ValidationError

from .. import storage
from ..models import MODELS
from ..services import adapter, explain_error, lock_for, proxy_url, required, safe_run

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "database": "sqlite"}


def model_for(kind):
    if kind not in MODELS:
        raise HTTPException(404, "资源不存在")
    return MODELS[kind]


def validate(kind, payload, old=None):
    try:
        data = model_for(kind).model_validate(payload).model_dump()
    except ValidationError as error:
        # Do not return Pydantic input snapshots; they can contain credentials.
        raise HTTPException(
            422,
            "; ".join(
                f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors()
            ),
        )
    if old:
        for key in storage.SECRET_FIELDS | ({"url"} if kind == "proxies" else set()):
            if key in data and (not data[key] or "***:***@" in str(data[key])):
                data[key] = old.get(key, "")
    if kind in {"tasks", "accounts"}:
        if data["use_proxy"]:
            if not data.get("proxy_id"):
                raise HTTPException(400, "开启代理后请选择代理")
            proxy_url(data)
        else:
            data["proxy_id"] = None
    if kind == "tasks":
        for key, target in (
            ("account_id", "accounts"),
            ("dify_preset_id", "dify"),
            ("ai_provider_id", "providers"),
        ):
            if data.get(key):
                required(target, data[key])
    return data


@router.get("/runs")
def runs():
    return storage.all_records("runs")[:100]


@router.post("/tasks/{record_id}/sample")
def sample(record_id):
    return safe_run(record_id, sample=True)


@router.post("/tasks/{record_id}/run")
def run(record_id):
    return safe_run(record_id)


@router.post("/accounts/{record_id}/check")
def check_account(record_id):
    account = required("accounts", record_id)
    account.setdefault("site", "rednote")
    with lock_for("account:" + record_id):
        try:
            result = adapter(account).check()
            account.update(status="healthy", user_id=result["user_id"])
            account.pop("last_error", None)
        except Exception as error:
            from ..services import account_error

            account.update(
                status="check_failed",
                last_error=account_error(error, account["site"]),
            )
        account["checked_at"] = datetime.now(timezone.utc).isoformat()
        return storage.public("accounts", storage.save("accounts", account))


@router.get("/accounts/{record_id}/secret")
def reveal_account_secret(record_id):
    required("accounts", record_id)
    cookie = storage.secret("accounts", record_id, "cookie")
    return {"cookie": cookie or ""}


@router.post("/accounts/{record_id}/sms")
def receive_sms(record_id):
    account = required("accounts", record_id)
    key = account.get("sms_key", "").strip()
    if not key:
        raise HTTPException(400, "请先编辑账号并保存接码 Key")
    lock = lock_for("sms:" + record_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "该号码正在查询短信，请稍后重试")
    try:
        with httpx.Client(trust_env=False, timeout=10, follow_redirects=False) as client:
            response = client.get(
                "http://www.9527sms.cc/api/sms/record", params={"key": key}
            )
        text = response.text.strip()
        if response.status_code == 403 or text == "Forbidden":
            return {"status": "forbidden", "message": "接码域名不属于该 Key 的账号，请向号码提供商核实"}
        response.raise_for_status()
        if text.startswith("yes|"):
            return {"status": "received", "message": text.partition("|")[2]}
        if text.startswith("NO|暂无短信验证码"):
            return {"status": "waiting", "message": text}
        if text.startswith("NO|号码已过期"):
            return {"status": "expired", "message": "号码已过期，无法继续接收短信"}
        if text == "请携带正确Key访问":
            return {"status": "invalid_key", "message": "接码 Key 不正确或已更换，请更新 Key"}
        return {"status": "error", "message": "接码服务返回了无法识别的响应，请向号码提供商核实"}
    except httpx.HTTPError:
        raise HTTPException(502, "接码服务请求失败或超时，请稍后重试")
    finally:
        lock.release()


@router.post("/proxies/{record_id}/check")
def check_proxy(record_id):
    item = required("proxies", record_id)
    try:
        started = time.monotonic()
        with httpx.Client(
            proxy=item["url"], trust_env=False, timeout=15, follow_redirects=True
        ) as client:
            response = client.get("https://www.rednote.com/")
            response.raise_for_status()
        item.update(
            status="healthy", latency_ms=round((time.monotonic() - started) * 1000)
        )
        item.pop("last_error", None)
    except Exception as error:
        diagnostic = explain_error(error)
        diagnostic = diagnostic.replace(item["url"], "[代理地址]")
        item.update(status="check_failed", latency_ms=None, last_error=diagnostic)
    item["checked_at"] = datetime.now(timezone.utc).isoformat()
    return storage.public("proxies", storage.save("proxies", item))


@router.post("/providers/{record_id}/test")
def test_provider(record_id):
    item = required("providers", record_id)
    try:
        with httpx.Client(trust_env=False, timeout=30) as client:
            result = client.get(
                item["base_url"] + "/models",
                headers={"Authorization": "Bearer " + item["api_key"]},
            )
            result.raise_for_status()
            models = [m["id"] for m in result.json().get("data", [])]
        return {
            "status": "ok",
            "models": models,
            "model_available": item["model"] in models,
        }
    except Exception:
        raise HTTPException(
            502, "连接失败，请检查 API 地址和密钥；服务需支持 /models 接口"
        )


@router.post("/providers/{record_id}/generate")
def generate(record_id: str, body: dict):
    item = required("providers", record_id)
    if not item["enabled"]:
        raise HTTPException(400, "提供商已停用")
    prompt = body.get("prompt", "")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20000:
        raise HTTPException(400, "请填写不超过 20000 字符的提示词")
    try:
        with httpx.Client(trust_env=False, timeout=120) as client:
            result = client.post(
                item["base_url"] + "/chat/completions",
                headers={"Authorization": "Bearer " + item["api_key"]},
                json={
                    "model": item["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 512,
                },
            )
            result.raise_for_status()
            return {"text": result.json()["choices"][0]["message"]["content"]}
    except Exception:
        raise HTTPException(502, "模型调用失败，请检查模型、余额和接口配置")


@router.get("/{kind}")
def list_records(kind):
    model_for(kind)
    return [storage.public(kind, item) for item in storage.all_records(kind)]


@router.post("/{kind}", status_code=201)
def create_record(kind: str, payload: dict):
    data = validate(kind, payload)
    return storage.public(kind, storage.save(kind, data))


@router.put("/{kind}/{record_id}")
def update_record(kind: str, record_id: str, payload: dict):
    old = required(kind, record_id)
    data = validate(kind, payload, old)
    return storage.public(kind, storage.save(kind, {**old, **data}))


@router.delete("/{kind}/{record_id}", status_code=204)
def delete_record(kind, record_id):
    model_for(kind)
    required(kind, record_id)
    references = {
        "proxies": "proxy_id",
        "accounts": "account_id",
        "dify": "dify_preset_id",
        "providers": "ai_provider_id",
    }
    if kind in references:
        for resource in ("tasks", "accounts"):
            if any(
                item.get(references[kind]) == record_id
                for item in storage.all_records(resource)
            ):
                raise HTTPException(409, "该配置仍被账号或任务引用，请先解除关联")
    if kind == "tasks" and lock_for("task:" + record_id).locked():
        raise HTTPException(409, "执行中的任务不能删除")
    storage.delete(kind, record_id)
    return Response(status_code=204)
