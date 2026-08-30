"""Agent 会话持久化；使用项目同一个 PostgreSQL 数据库。"""
import os
from contextlib import contextmanager
from typing import Iterator
import psycopg

DDL = """
CREATE TABLE IF NOT EXISTS agent_sessions (id VARCHAR(64) PRIMARY KEY, title VARCHAR(200) NOT NULL DEFAULT '新会话', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_messages (id BIGSERIAL PRIMARY KEY, session_id VARCHAR(64) NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, role VARCHAR(20) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_agent_messages_session ON agent_messages(session_id, created_at);
"""

def _url() -> str:
    return os.getenv("DATABASE_URL", "postgresql://myblog:myblog_local@localhost:5432/myblog").replace("postgresql+psycopg", "postgresql")

@contextmanager
def db() -> Iterator[psycopg.Connection]:
    with psycopg.connect(_url()) as conn:
        yield conn

def init_db() -> None:
    with db() as conn: conn.execute(DDL)

def save_turn(session_id: str, user_text: str, reply: str) -> None:
    with db() as conn:
        conn.execute("INSERT INTO agent_sessions(id,title) VALUES (%s,%s) ON CONFLICT (id) DO UPDATE SET title=CASE WHEN agent_sessions.title='新会话' THEN LEFT(EXCLUDED.title,18) ELSE agent_sessions.title END, updated_at=now()", (session_id, user_text[:18] or "新会话"))
        conn.execute("INSERT INTO agent_messages(session_id,role,content) VALUES (%s,'user',%s),(%s,'agent',%s)", (session_id,user_text,session_id,reply))

def create_session(session_id: str, title: str = "新会话") -> None:
    with db() as conn: conn.execute("INSERT INTO agent_sessions(id,title) VALUES (%s,%s) ON CONFLICT (id) DO NOTHING", (session_id, title))

def list_sessions() -> list[dict]:
    with db() as conn:
        return [dict(zip(("id","title","created_at","updated_at"), row)) for row in conn.execute("SELECT id,title,created_at,updated_at FROM agent_sessions ORDER BY updated_at DESC").fetchall()]

def get_messages(session_id: str) -> list[dict]:
    with db() as conn:
        return [{"role": r, "content": c, "created_at": t.isoformat()} for r,c,t in conn.execute("SELECT role,content,created_at FROM agent_messages WHERE session_id=%s ORDER BY created_at", (session_id,)).fetchall()]

def delete_session(session_id: str) -> None:
    with db() as conn: conn.execute("DELETE FROM agent_sessions WHERE id=%s", (session_id,))
