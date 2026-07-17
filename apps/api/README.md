# MyBlog API

FastAPI backend for the personal website.

## Tech Stack

- FastAPI for the HTTP API
- Uvicorn for local development and ASGI serving
- Pydantic Settings for environment-based configuration
- pytest and httpx for API tests
- Ruff for linting and formatting

## Setup

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
cp .env.example .env
```

## Development

```bash
uvicorn app.main:app --reload --app-dir src --port 8000
```

Useful URLs:

- API root: http://localhost:8000
- Health check: http://localhost:8000/api/v1/health
- Swagger docs: http://localhost:8000/docs

## Quality Checks

```bash
ruff check .
ruff format --check .
pytest
```
