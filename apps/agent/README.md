# 智能导诊 Agent

这是个人网站中的第一个 Agent 项目，独立于 `apps/web`（网站前端）和 `apps/api`（简历、用户、博客接口）。

## 本地启动

先复制环境变量模板，并把原项目的模型配置填入：

```bash
cp apps/agent/.env.example apps/agent/.env.local
```

启动 PostgreSQL、Redis 和 Agent：

```bash
docker compose up -d postgres redis agent
```

Agent 接口地址为 `http://localhost:8002`，健康检查：

```bash
curl http://localhost:8002/health
```

网站里的项目页会通过 `/api/agent/chat` 转发到这个服务，不需要浏览器直接跨域访问 Agent。

## 数据处理

`data/` 中已迁移原项目的科室原始数据、清洗结果、切块结果、映射表和评测集。向量数据仍需要根据本地或线上 Milvus 重新导入：

```bash
docker compose run --rm agent python -m backend.clean
docker compose run --rm agent python -m backend.hierarchical_chunk
docker compose run --rm agent python -m backend.embed --target all
```

这些命令会读取 `data/`，并根据 `.env.local` 中的 PostgreSQL、Embedding 和 Milvus 配置写入对应存储。

## 目录

```text
backend/api.py       FastAPI SSE 接口
backend/agent/       LangGraph 状态图和问诊节点
backend/retriever.py 混合检索、Rerank 和依据回查
backend/embed.py     Embedding 与 Milvus 导入
data/                科室资料、切块、映射和评测数据
```
