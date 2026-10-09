"""SQLite document storage. Secrets are encrypted with a local Fernet key."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet

DATA = Path(
    os.environ.get("XHS_ADMIN_DATA", Path(__file__).resolve().parents[1] / "data")
)
SECRET_FIELDS = {"api_key", "cookie", "sms_key"}


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    key_file = DATA / "secret.key"
    if not key_file.exists():
        with key_file.open("xb") as f:
            f.write(Fernet.generate_key())
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, payload TEXT NOT NULL, PRIMARY KEY(kind,id))"
        )
        # Backfill the site for accounts created before regional support.
        for record_id, payload in db.execute(
            "SELECT id, payload FROM records WHERE kind='accounts'"
        ).fetchall():
            item = decode(payload)
            changed = False
            if "site" not in item:
                item["site"] = "rednote"
                changed = True
            if not changed:
                continue
            stored = dict(item)
            for field in SECRET_FIELDS | {"url"}:
                if stored.get(field):
                    stored[field] = {
                        "encrypted": cipher()
                        .encrypt(str(stored[field]).encode())
                        .decode()
                    }
            db.execute(
                "UPDATE records SET payload=? WHERE kind='accounts' AND id=?",
                (json.dumps(stored, ensure_ascii=False), record_id),
            )
        db.execute("PRAGMA user_version=1")


def connect():
    return sqlite3.connect(DATA / "admin.sqlite3", timeout=20)


def cipher():
    return Fernet((DATA / "secret.key").read_bytes())


def decode(payload):
    item = json.loads(payload)
    for key in SECRET_FIELDS | {"url"}:
        if isinstance(item.get(key), dict) and "encrypted" in item[key]:
            item[key] = cipher().decrypt(item[key]["encrypted"].encode()).decode()
    return item


def all_records(kind):
    with connect() as db:
        return [
            decode(row[0])
            for row in db.execute(
                "SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC", (kind,)
            )
        ]


def get(kind, record_id):
    with connect() as db:
        row = db.execute(
            "SELECT payload FROM records WHERE kind=? AND id=?", (kind, record_id)
        ).fetchone()
    return decode(row[0]) if row else None


def secret(kind, record_id, field):
    item = get(kind, record_id)
    if item is None or field not in SECRET_FIELDS:
        return None
    return item.get(field)


def save(kind, item):
    item = dict(item)
    item.setdefault("id", str(uuid4()))
    now = datetime.now(timezone.utc).isoformat()
    item.setdefault("created_at", now)
    item["updated_at"] = now
    stored = dict(item)
    fields = SECRET_FIELDS | ({"url"} if kind == "proxies" else set())
    for key in fields:
        if stored.get(key):
            stored[key] = {
                "encrypted": cipher().encrypt(str(stored[key]).encode()).decode()
            }
    with connect() as db:
        db.execute(
            "INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
            (kind, item["id"], json.dumps(stored, ensure_ascii=False)),
        )
    return item


def delete(kind, record_id):
    with connect() as db:
        db.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, record_id))


def public(kind, item):
    result = dict(item)
    for key in SECRET_FIELDS:
        if key in result:
            result[f"has_{key}"] = bool(result.pop(key))
    if kind == "proxies" and result.get("url"):
        from urllib.parse import urlsplit, urlunsplit

        parsed = urlsplit(result["url"])
        if parsed.username is not None:
            result["url"] = urlunsplit(
                (parsed.scheme, f"***:***@{parsed.hostname}:{parsed.port}", "", "", "")
            )
            result["has_credentials"] = True
    return result
