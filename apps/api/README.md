# MyBlog API

FastAPI backend for the personal website.

## Tech Stack

- FastAPI for the HTTP API
- Uvicorn for local development and ASGI serving
- Pydantic Settings for environment-based configuration
- PostgreSQL, SQLAlchemy and Alembic for resume content storage
- pytest and httpx for API tests
- Ruff for linting and formatting

## Setup

使用 conda 做 Python 环境隔离（要求 Python >= 3.12）：

```bash
cd apps/api
conda env create -f environment.yml
conda activate myblog-api
python -m pip install -e ".[dev]"
cp .env.example .env
```

若环境已存在，只需激活后安装依赖：

```bash
conda activate myblog-api
python -m pip install -e ".[dev]"
```

删除环境：

```bash
conda deactivate
conda env remove -n myblog-api
```

## Development

先从仓库根目录启动 PostgreSQL：

```bash
docker compose up -d postgres
```

执行数据库迁移和初始数据写入：

```bash
cd apps/api
conda activate myblog-api
alembic upgrade head
python -m app.seed
```

启动 API：

```bash
uvicorn app.main:app --reload --app-dir src --port 8000
```

Useful URLs:

- API root: http://localhost:8000
- Health check: http://localhost:8000/api/v1/health
- Resume API: http://localhost:8000/api/v1/resume
- Swagger docs: http://localhost:8000/docs

后台页面位于 `http://localhost:3000/admin`。用户登录后，后端会根据
HttpOnly Cookie 中的 JWT 查询数据库角色，只有 `is_admin=true` 的用户可以访问和保存。

停止数据库：

```bash
docker compose stop postgres
```

## Quality Checks

```bash
ruff check .
ruff format --check .
pytest
```
