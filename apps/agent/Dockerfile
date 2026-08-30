FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=120
ARG PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
ENV PIP_INDEX_URL=$PIP_INDEX_URL

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --retries 10 -r requirements.txt
COPY backend ./backend
COPY data ./data

EXPOSE 8002
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8002", "--proxy-headers"]
