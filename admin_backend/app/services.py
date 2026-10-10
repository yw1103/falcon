import json
import logging
import re
import threading
import time
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

from . import storage
from .adapters.spider_xhs import SpiderXHSAdapter
from .timing import randomized_interval

locks = {}
locks_guard = threading.Lock()
logger = logging.getLogger("xhs_admin")


def lock_for(key):
    with locks_guard:
        return locks.setdefault(key, threading.Lock())


def required(kind, record_id):
    item = storage.get(kind, record_id)
    if not item:
        raise HTTPException(404, "记录不存在")
    return item


def proxy_url(config):
    if not config.get("use_proxy"):
        return None
    item = required("proxies", config.get("proxy_id"))
    if not item.get("enabled"):
        raise HTTPException(400, "所选代理已停用")
    return item["url"]


def adapter(account, config=None):
    url = proxy_url(config if config is not None else account)
    return SpiderXHSAdapter(
        cookie=account["cookie"],
        site=account.get("site", "rednote"),
        proxy={"http": url, "https": url} if url else {},
        request_interval=(config or {}).get("request_interval_seconds", 1),
        randomize_request_interval=(config or {}).get("randomize_request_interval", True),
        request_interval_jitter=(config or {}).get("request_interval_jitter_seconds", 3),
    )


def dify_send(preset, payload, proxy=None):
    content = json.dumps(payload, ensure_ascii=False)
    endpoint = "workflows/run" if preset["mode"] == "workflow" else "chat-messages"
    body = {
        "inputs": {preset["input_variable"]: content},
        "response_mode": "blocking",
        "user": "xhs-admin",
    }
    if preset["mode"] == "chat":
        body["query"] = content
    with httpx.Client(trust_env=False, proxy=proxy, timeout=120) as client:
        response = client.post(
            preset["base_url"] + "/" + endpoint,
            headers={"Authorization": "Bearer " + preset["api_key"]},
            json=body,
        )
        response.raise_for_status()
        result = response.json()
        if (
            preset["mode"] == "workflow"
            and result.get("data", {}).get("status") == "failed"
        ):
            raise RuntimeError("Dify 工作流执行失败")
        return result


def execute_task(task_id, sample=False):
    task = required("tasks", task_id)
    account = required("accounts", task["account_id"])
    if not account["enabled"]:
        raise HTTPException(400, "所选账号已停用")
    with lock_for("account:" + account["id"]):
        notes = adapter(account, task).search_notes(
            task["keyword"],
            min(task["max_items"], 20) if sample else task["max_items"],
            options={
                "sort_type_choice": task.get("sort_type_choice", 0),
                "note_type": task.get("note_type", 0),
                "note_time": task.get("note_time", 0),
                "note_range": task.get("note_range", 0),
                "pos_distance": task.get("pos_distance", 0),
                "geo": task.get("geo"),
            },
            single_page=sample,
            fetch_content=task.get("fetch_content", False),
        )
    search = {
        "keyword": task["keyword"],
        "query_num": task["max_items"],
        "fetch_content": task.get("fetch_content", False),
        "interval_seconds": task["interval_seconds"],
        "request_interval_seconds": task["request_interval_seconds"],
        "randomize_task_interval": task.get("randomize_task_interval", True),
        "task_interval_jitter_seconds": task.get("task_interval_jitter_seconds", 60),
        "randomize_request_interval": task.get("randomize_request_interval", True),
        "request_interval_jitter_seconds": task.get("request_interval_jitter_seconds", 3),
        "sort_type_choice": task.get("sort_type_choice", 0),
        "note_type": task.get("note_type", 0),
        "note_time": task.get("note_time", 0),
        "note_range": task.get("note_range", 0),
        "pos_distance": task.get("pos_distance", 0),
        "geo": task.get("geo"),
    }
    run = {
        "task_id": task_id,
        "task_name": task["name"],
        "status": "success",
        "sample": sample,
        "count": len(notes),
        "search": search,
        "notes": notes,
    }
    try:
        if not sample and task.get("dify_preset_id") and notes:
            preset = required("dify", task["dify_preset_id"])
            if not preset["enabled"]:
                raise HTTPException(400, "Dify 预设已停用")
            run["dify_result"] = dify_send(
                preset,
                {"search": search, "count": len(notes), "notes": notes},
                proxy_url(task),
            )
    except Exception:
        run["status"] = "delivery_failed"
        run["error"] = "采集完成，Dify 投递失败，请检查预设"
    saved = storage.save("runs", run)
    current = required("tasks", task_id)
    current["last_run_at"] = datetime.now(timezone.utc).isoformat()
    storage.save("tasks", current)
    return saved


def safe_run(task_id, sample=False):
    lock = lock_for("task:" + task_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "该任务正在执行")
    try:
        return execute_task(task_id, sample)
    except HTTPException:
        raise
    except Exception as error:
        diagnostic = explain_error(error)
        logger.exception("Task %s failed: %s", task_id, diagnostic)
        task = required("tasks", task_id)
        storage.save(
            "runs",
            {
                "task_id": task_id,
                "task_name": task["name"],
                "status": "failed",
                "sample": sample,
                "count": 0,
                "error": diagnostic,
            },
        )
        raise HTTPException(502, diagnostic)
    finally:
        lock.release()


def explain_error(error):
    """Expose useful upstream diagnostics while scrubbing credentials."""
    message = " ".join(str(error).split())[:600] or "底层请求失败，未提供错误详情。"
    message = re.sub(
        r"(?i)(authorization\s*[:=]\s*bearer\s+)\S+", r"\1[已隐藏]", message
    )
    message = re.sub(r"(?i)(cookie\s*[:=]\s*)[^,;]+(?:;[^,]*)*", r"\1[已隐藏]", message)
    message = re.sub(
        r"(?i)([?&](?:key|token|xsec_token|secret|code)=)[^&\s]+", r"\1[已隐藏]", message
    )
    return f"{type(error).__name__}: {message}"


def account_error(error, site="xiaohongshu"):
    """Translate common auth failures into a direct credential action."""
    message = str(error)
    if "登录已过期" in message or "登录过期" in message:
        brand = "RedNote" if site == "rednote" else "小红书"
        return f"{brand} Cookie Token 已过期。请在对应站点重新登录，复制当前完整 Cookie，在账号编辑中替换 Token 后重新检查。"
    if "Token 格式不完整" in message or "没有已保存的 Token" in message:
        return message
    return explain_error(error)


def scheduler(stop):
    """One embedded worker, one task at a time. Run uvicorn with one worker."""
    due = {}
    while not stop.wait(1):
        for task in storage.all_records("tasks"):
            if task["status"] != "running" or not task["enabled"]:
                due.pop(task["id"], None)
                continue
            if time.monotonic() < due.get(task["id"], 0):
                continue
            try:
                safe_run(task["id"])
            except Exception:
                pass
            due[task["id"]] = time.monotonic() + randomized_interval(
                task["interval_seconds"],
                task.get("randomize_task_interval", True),
                task.get("task_interval_jitter_seconds", 60),
            )
