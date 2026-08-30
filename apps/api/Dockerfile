FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# 腾讯云服务器访问 PyPI 官方文件站偶尔较慢；默认使用腾讯云镜像，
# 同时允许在 Compose 构建参数中切换回其他可信源。
ARG PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
ENV PIP_INDEX_URL=$PIP_INDEX_URL
ENV PIP_DEFAULT_TIMEOUT=120
WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN pip install --no-cache-dir --retries 10 .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
