"""将 Chunk 向量化并写入 Milvus。

本模块是知识库 pipeline 的「向量化」步骤，负责把已切分好的文本 Chunk 转为向量，
写入 Milvus 独立库，供后续 RAG 语义检索使用。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、科室 embedding（dept_chunks）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
上游: python -m backend.chunk
      科室 Markdown → data/chunks/chunks.jsonl（约 250 条，按科室×小节切分）

切分粒度: 一个科室可有多条 Chunk（如「科室简介」「专科特色」「科研教学」）
          chunk_id 形如 "5_000"、"5_001"

Embedding 输入: 每条记录的 text 字段，格式示例:
          【肝胆胰外科 · 专科特色】
          学科擅长治疗肝胆胰肿瘤……

写入目标: Milvus 库 zy91_triage / collection dept_chunks
          主键 id = sha256(chunk_id) 稳定哈希
          向量字段 vector（1536 维，ada-002）+ 元数据 dept_id / section / text 等

检索场景: 「胃痛反酸挂什么科」→ 与用户问题向量近邻的科室原文

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一-b、科室分层 embedding（dept_chunks_hierarchical）【推荐】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
上游: python -m backend.chunk --hierarchical
      → data/chunks/chunks_hierarchical.jsonl（仅 child）
      → data/chunks/dept_parents.jsonl → PostgreSQL zy91_dept_parents

结构: 每个 ## 小节 → 1 个 parent（完整小节，存 PG）+ N 个 child（Milvus 向量）
      child 的 embedding_text 注入 parent 前 220 字上下文（Context Enhancement）

Embedding 输入: 仅 child 的 embedding_text

写入目标: zy91_triage.dept_chunks_hierarchical（仅 child）
          parent 全文在 PostgreSQL zy91_dept_parents，按 parent_id 回查

检索策略: Milvus 搜 child → parent_id → PG 取章节全文

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、医生 embedding（doctor_profiles）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
上游: python -m backend.chunk_doctors
      data/schedule/doctors.jsonl → data/chunks/doctors.jsonl（约 837 条，每人 1 条）

切分粒度: 一位医生 = 一条 Chunk（chunk_id 形如 "doctor_6"）
          text 由姓名、职称、擅长、简介、研究方向、出诊摘要拼成

Embedding 输入: 每条记录的 text 字段，格式示例:
          【放疗科 · 孙晓丽 · 副主任医师】
          擅长：乳腺癌、肺癌……
          出诊：庆春院区 放疗科 星期一 上午 …

写入目标: Milvus 库 zy91_triage / collection doctor_profiles
          主键 id = sha256(chunk_id)；元数据含 doctor_id / name / dept_id 等

检索场景: 「放疗科哪个医生看乳腺癌」→ 按语义召回匹配擅长的医生

注意: 精确排班（周几、院区）走 PostgreSQL zy91_schedule_entries，不在此模块。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、症状/疾病→科室 映射 embedding（dept_symptom_mappings）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
上游: python -m backend.extract_dept_mapping
      → PostgreSQL zy91_dept_mappings

Embedding 输入: 从 PG 读取，embedding_text = keywords + 科室 + 方向 + 依据

写入目标: zy91_triage.dept_symptom_mappings

检索场景: 「甲状腺结节挂什么科」→ 语义命中映射条目 → 直达推荐科室

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、共用逻辑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 模型: .env 中 EMBEDDING_MODEL（当前 text-embedding-ada-002，经 302.ai）
- 批量: embed_documents，每批 EMBED_BATCH_SIZE（默认 32）
- 写入: 每次运行先 drop 再 create collection，避免重复 embed 导致 row_count 膨胀
- 度量: COSINE 余弦相似度

用法（在项目根目录，需 Milvus 已启动）:
    python -m backend.chunk --hierarchical
    python -m backend.load_dept_parents
    python -m backend.embed --target dept --hierarchical   # → dept_chunks_hierarchical（child only）
    python -m backend.embed --target dept                    # 扁平 → dept_chunks
    python -m backend.embed --target doctors                 # → doctor_profiles
    python -m backend.extract_dept_mapping
    python -m backend.embed --target mappings               # PG → dept_symptom_mappings
    python -m backend.embed --target all --hierarchical      # 分层科室 + 医生 + 映射
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

from langchain.embeddings import init_embeddings
from pymilvus import MilvusClient

from backend.config import PROJECT_ROOT, Settings, get_settings
from backend.mapping_db import fetch_mappings_for_embed

# ── 输入 / 输出路径 ──────────────────────────────────────────────────────────
DEPT_CHUNKS_JSONL = PROJECT_ROOT / "data" / "chunks" / "chunks.jsonl"
DEPT_HIERARCHICAL_JSONL = PROJECT_ROOT / "data" / "chunks" / "chunks_hierarchical.jsonl"
DOCTOR_CHUNKS_JSONL = PROJECT_ROOT / "data" / "chunks" / "doctors.jsonl"
VECTORSTORE_DIR = PROJECT_ROOT / "data" / "vectorstore"
DEPT_MANIFEST_PATH = VECTORSTORE_DIR / "manifest.json"
DEPT_HIER_MANIFEST_PATH = VECTORSTORE_DIR / "manifest_hierarchical.json"
DOCTOR_MANIFEST_PATH = VECTORSTORE_DIR / "manifest_doctors.json"
MAPPING_MANIFEST_PATH = VECTORSTORE_DIR / "manifest_mappings.json"


@dataclass
class DeptChunkRecord:
    """科室 Chunk：来自 chunk.py，一条对应科室下的一个小节。"""

    chunk_id: str
    dept_id: str
    dept_name: str
    section: str
    chunk_index: int
    text: str  # 实际送入 Embedding API 的字符串
    char_count: int
    strategy: str
    source_md: str


@dataclass
class HierarchicalDeptChunkRecord:
    """科室分层 child Chunk：Milvus 向量检索用。"""

    chunk_id: str
    doc_id: str
    dept_id: str
    dept_name: str
    parent_id: str
    level: int
    section: str
    header_path: list[str]
    text: str
    embedding_text: str  # 实际送入 Embedding API
    char_count: int
    source_md: str
    strategy: str


@dataclass
class DeptMappingRecord:
    """LLM 抽取的症状/疾病→科室映射条目。"""

    mapping_id: str
    dept_id: str
    dept_name: str
    entity_type: str
    keywords: list[str]
    category_label: str
    source_chunk_id: str
    source_section: str
    evidence: str
    confidence: float
    recommendable: bool
    validated: bool
    embedding_text: str


@dataclass
class DoctorChunkRecord:
    """医生 Chunk：来自 chunk_doctors.py，一位医生一条。"""

    chunk_id: str
    doctor_id: str
    name: str
    dept_id: str
    dept_name: str
    title: str
    text: str  # 实际送入 Embedding API 的字符串
    char_count: int
    has_schedule: bool
    source: str


def _stable_id(value: str) -> int:
    """由 chunk_id 生成 Milvus INT64 主键（同一 chunk 多次 embed  id 不变）。"""
    digest = hashlib.sha256(value.encode("utf-8")).digest()[:8]
    return int.from_bytes(digest, "big") & ((1 << 63) - 1)


def _json_safe(value):
    """pymilvus 返回对象转 JSON 可序列化 dict（写 manifest 用）。"""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "items"):
        return _json_safe(dict(value))
    return str(value)


def build_embeddings(settings: Settings):
    """初始化 LangChain Embedding 客户端（OpenAI 兼容接口，如 302.ai）。"""
    return init_embeddings(
        model=settings.embedding_model,
        api_key=settings.embedding_api_key,
        base_url=settings.embedding_api_base,
    )


def ensure_milvus_database(client: MilvusClient, db_name: str) -> None:
    """确保业务库存在（默认 zy91_triage，与教程库 rag_tutorial 隔离）。"""
    databases = client.list_databases()
    if db_name not in databases:
        client.create_database(db_name=db_name)
        print(f"已创建 Milvus 数据库: {db_name}")
    client.use_database(db_name=db_name)


def reset_collection(
    client: MilvusClient,
    *,
    db_name: str,
    collection_name: str,
    dimension: int,
) -> None:
    """Drop 并重建 collection。

    重复运行 embed 若只做 insert/upsert，Milvus 的 row_count 可能统计膨胀；
    全量重建可保证条数与 JSONL 行数一致。
    """
    ensure_milvus_database(client, db_name)
    if client.has_collection(collection_name=collection_name):
        client.drop_collection(collection_name=collection_name)
        print(f"已删除旧 collection: {db_name}.{collection_name}")
    client.create_collection(
        collection_name=collection_name,
        dimension=dimension,
        metric_type="COSINE",
        auto_id=False,  # 使用我们提供的稳定 id，而非 Milvus 自增
        primary_field_name="id",
    )
    print(f"已创建 collection: {db_name}.{collection_name} (dim={dimension})")


def load_dept_chunks(path: Path = DEPT_CHUNKS_JSONL) -> list[DeptChunkRecord]:
    """读取科室 Chunk JSONL（backend.chunk 产物）。"""
    if not path.is_file():
        raise FileNotFoundError(f"缺少 chunks 文件: {path}，请先运行 python -m backend.chunk")
    records: list[DeptChunkRecord] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        records.append(
            DeptChunkRecord(
                chunk_id=data["chunk_id"],
                dept_id=str(data["dept_id"]),
                dept_name=data["dept_name"],
                section=data.get("section", ""),
                chunk_index=int(data["chunk_index"]),
                text=data["text"],
                char_count=int(data["char_count"]),
                strategy=data.get("strategy", ""),
                source_md=data.get("source_md", ""),
            )
        )
    if not records:
        raise RuntimeError("chunks.jsonl 为空")
    return records


def load_dept_hierarchical_chunks(
    path: Path = DEPT_HIERARCHICAL_JSONL,
) -> list[HierarchicalDeptChunkRecord]:
    """读取分层科室 child Chunk JSONL（仅 child，parent 在 PostgreSQL）。"""
    if not path.is_file():
        raise FileNotFoundError(
            f"缺少 hierarchical chunks: {path}，请先运行 python -m backend.chunk --hierarchical"
        )
    records: list[HierarchicalDeptChunkRecord] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        # 兼容旧 JSONL：跳过 parent 行
        if data.get("chunk_type") == "parent":
            continue
        records.append(
            HierarchicalDeptChunkRecord(
                chunk_id=data["chunk_id"],
                doc_id=data["doc_id"],
                dept_id=str(data["dept_id"]),
                dept_name=data["dept_name"],
                parent_id=data.get("parent_id", ""),
                level=int(data["level"]),
                section=data.get("section", ""),
                header_path=data.get("header_path") or [],
                text=data["text"],
                embedding_text=data["embedding_text"],
                char_count=int(data["char_count"]),
                source_md=data.get("source_md", ""),
                strategy=data.get("strategy", "hierarchical"),
            )
        )
    if not records:
        raise RuntimeError("chunks_hierarchical.jsonl 为空或无 child 记录")
    return records


def load_doctor_chunks(path: Path = DOCTOR_CHUNKS_JSONL) -> list[DoctorChunkRecord]:
    """读取医生 Chunk JSONL（backend.chunk_doctors 产物）。"""
    if not path.is_file():
        raise FileNotFoundError(
            f"缺少 doctors chunks 文件: {path}，请先运行 python -m backend.chunk_doctors"
        )
    records: list[DoctorChunkRecord] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        records.append(
            DoctorChunkRecord(
                chunk_id=data["chunk_id"],
                doctor_id=str(data["doctor_id"]),
                name=data["name"],
                dept_id=str(data["dept_id"]),
                dept_name=data["dept_name"],
                title=data.get("title", ""),
                text=data["text"],
                char_count=int(data["char_count"]),
                has_schedule=bool(data.get("has_schedule")),
                source=data.get("source", ""),
            )
        )
    if not records:
        raise RuntimeError("doctors.jsonl 为空")
    return records


def load_dept_mappings_from_db(*, validated_only: bool = True) -> list[DeptMappingRecord]:
    """从 PostgreSQL zy91_dept_mappings 读取映射。"""
    rows = fetch_mappings_for_embed(validated_only=validated_only)
    return [
        DeptMappingRecord(
            mapping_id=row["mapping_id"],
            dept_id=str(row["dept_id"]),
            dept_name=row["dept_name"],
            entity_type=row["entity_type"],
            keywords=row.get("keywords") or [],
            category_label=row.get("category_label", ""),
            source_chunk_id=row.get("source_chunk_id", ""),
            source_section=row.get("source_section", ""),
            evidence=row["evidence"],
            confidence=float(row.get("confidence", 0)),
            recommendable=bool(row.get("recommendable", True)),
            validated=bool(row.get("validated", True)),
            embedding_text=row["embedding_text"],
        )
        for row in rows
    ]


def embed_texts(
    embed_model,
    texts: Sequence[str],
    batch_size: int,
    settings: Settings,
) -> list[list[float]]:
    """调用 Embedding API，按 batch_size 分批将文本列表转为向量列表。

    科室与医生共用同一模型与分批逻辑；仅输入 texts 不同。
    """
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = list(texts[start : start + batch_size])
        print(f"Embedding [{start + 1}-{start + len(batch)}/{len(texts)}]")
        try:
            vectors.extend(embed_model.embed_documents(batch))
        except Exception as exc:
            err = str(exc)
            if "401" in err or "Invalid API Key" in err:
                raise RuntimeError(
                    "Embedding API 认证失败：请检查 .env 中 EMBEDDING_API_KEY 是否有效"
                ) from exc
            if "404" in err and "text-embedding-3-large" in settings.embedding_model:
                raise RuntimeError(
                    "302.AI 当前无法调用 text-embedding-3-large（404）。"
                    "请改用 EMBEDDING_MODEL=text-embedding-ada-002"
                ) from exc
            raise
    return vectors


def _write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def embed_dept_chunks(*, settings: Settings | None = None) -> dict:
    """科室向量化全流程：chunks.jsonl → API → Milvus dept_chunks。

    流程:
        1. 读取 data/chunks/chunks.jsonl
        2. 提取每条 text，批量 embed_documents
        3. reset_collection(dept_chunks)
        4. insert 向量 + 元数据（dept_id, section, text…）
        5. 写 data/vectorstore/manifest.json
    """
    settings = settings or get_settings()
    chunks = load_dept_chunks()
    embed_model = build_embeddings(settings)
    client = MilvusClient(uri=settings.milvus_uri)

    # 仅 text 字段参与向量化；元数据原样存入 Milvus 供检索后展示/过滤
    texts = [chunk.text for chunk in chunks]
    vectors = embed_texts(embed_model, texts, settings.embed_batch_size, settings)
    if len(vectors) != len(chunks):
        raise RuntimeError("Embedding 返回数量与 chunk 数量不一致")

    dimension = len(vectors[0])
    reset_collection(
        client,
        db_name=settings.milvus_db,
        collection_name=settings.milvus_collection,
        dimension=dimension,
    )

    rows = [
        {
            "id": _stable_id(chunk.chunk_id),
            "vector": vector,
            "chunk_id": chunk.chunk_id,
            "dept_id": chunk.dept_id,
            "dept_name": chunk.dept_name,
            "section": chunk.section,
            "chunk_index": chunk.chunk_index,
            "text": chunk.text,
            "char_count": chunk.char_count,
            "strategy": chunk.strategy,
            "source_md": chunk.source_md,
        }
        for chunk, vector in zip(chunks, vectors)
    ]

    print(f"写入 Milvus {settings.milvus_db}.{settings.milvus_collection} …")
    result = client.insert(collection_name=settings.milvus_collection, data=rows)
    client.flush(collection_name=settings.milvus_collection)
    stats = client.get_collection_stats(collection_name=settings.milvus_collection)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_chunks": str(DEPT_CHUNKS_JSONL.relative_to(PROJECT_ROOT)),
        "embedding_model": settings.embedding_model,
        "embedding_api_base": settings.embedding_api_base,
        "milvus_uri": settings.milvus_uri,
        "milvus_db": settings.milvus_db,
        "milvus_collection": settings.milvus_collection,
        "dimension": dimension,
        "total_chunks": len(chunks),
        "insert_result": _json_safe(result),
        "collection_stats": _json_safe(stats),
    }
    _write_manifest(DEPT_MANIFEST_PATH, manifest)
    return manifest


def embed_dept_hierarchical_chunks(*, settings: Settings | None = None) -> dict:
    """科室分层 child 向量化：chunks_hierarchical.jsonl → Milvus dept_chunks_hierarchical。

    parent 全文在 PostgreSQL zy91_dept_parents，不参与 embed。
    """
    settings = settings or get_settings()
    chunks = load_dept_hierarchical_chunks()
    embed_model = build_embeddings(settings)
    client = MilvusClient(uri=settings.milvus_uri)

    texts = [chunk.embedding_text for chunk in chunks]
    vectors = embed_texts(embed_model, texts, settings.embed_batch_size, settings)
    if len(vectors) != len(chunks):
        raise RuntimeError("Embedding 返回数量与 hierarchical child 数量不一致")

    dimension = len(vectors[0])
    collection = settings.milvus_dept_hier_collection
    reset_collection(
        client,
        db_name=settings.milvus_db,
        collection_name=collection,
        dimension=dimension,
    )

    rows = [
        {
            "id": _stable_id(chunk.chunk_id),
            "vector": vector,
            "chunk_id": chunk.chunk_id,
            "doc_id": chunk.doc_id,
            "dept_id": chunk.dept_id,
            "dept_name": chunk.dept_name,
            "parent_id": chunk.parent_id,
            "level": chunk.level,
            "section": chunk.section,
            "header_path": json.dumps(chunk.header_path, ensure_ascii=False),
            "text": chunk.text,
            "char_count": chunk.char_count,
            "strategy": chunk.strategy,
            "source_md": chunk.source_md,
        }
        for chunk, vector in zip(chunks, vectors)
    ]

    print(f"写入 Milvus {settings.milvus_db}.{collection} …")
    result = client.insert(collection_name=collection, data=rows)
    client.flush(collection_name=collection)
    stats = client.get_collection_stats(collection_name=collection)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_chunks": str(DEPT_HIERARCHICAL_JSONL.relative_to(PROJECT_ROOT)),
        "parent_storage": "postgresql:zy91_dept_parents",
        "embedding_model": settings.embedding_model,
        "embedding_api_base": settings.embedding_api_base,
        "milvus_uri": settings.milvus_uri,
        "milvus_db": settings.milvus_db,
        "milvus_collection": collection,
        "dimension": dimension,
        "total_chunks": len(chunks),
        "child_chunks": len(chunks),
        "insert_result": _json_safe(result),
        "collection_stats": _json_safe(stats),
    }
    _write_manifest(DEPT_HIER_MANIFEST_PATH, manifest)
    return manifest


def embed_doctor_chunks(*, settings: Settings | None = None) -> dict:
    """医生向量化全流程：doctors.jsonl → API → Milvus doctor_profiles。

    流程与科室相同，区别:
        - 输入: data/chunks/doctors.jsonl（每人 1 条，含擅长/简介/出诊摘要）
        - 输出 collection: doctor_profiles（非 dept_chunks）
        - 元数据字段: doctor_id, name, title, has_schedule 等
    """
    settings = settings or get_settings()
    chunks = load_doctor_chunks()
    embed_model = build_embeddings(settings)
    client = MilvusClient(uri=settings.milvus_uri)

    texts = [chunk.text for chunk in chunks]
    vectors = embed_texts(embed_model, texts, settings.embed_batch_size, settings)
    if len(vectors) != len(chunks):
        raise RuntimeError("Embedding 返回数量与 doctor chunk 数量不一致")

    dimension = len(vectors[0])
    reset_collection(
        client,
        db_name=settings.milvus_db,
        collection_name=settings.milvus_doctor_collection,
        dimension=dimension,
    )

    rows = [
        {
            "id": _stable_id(chunk.chunk_id),
            "vector": vector,
            "chunk_id": chunk.chunk_id,
            "doctor_id": chunk.doctor_id,
            "name": chunk.name,
            "dept_id": chunk.dept_id,
            "dept_name": chunk.dept_name,
            "title": chunk.title,
            "text": chunk.text,
            "char_count": chunk.char_count,
            "has_schedule": chunk.has_schedule,
            "source": chunk.source,
        }
        for chunk, vector in zip(chunks, vectors)
    ]

    print(f"写入 Milvus {settings.milvus_db}.{settings.milvus_doctor_collection} …")
    result = client.insert(collection_name=settings.milvus_doctor_collection, data=rows)
    client.flush(collection_name=settings.milvus_doctor_collection)
    stats = client.get_collection_stats(collection_name=settings.milvus_doctor_collection)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_chunks": str(DOCTOR_CHUNKS_JSONL.relative_to(PROJECT_ROOT)),
        "embedding_model": settings.embedding_model,
        "embedding_api_base": settings.embedding_api_base,
        "milvus_uri": settings.milvus_uri,
        "milvus_db": settings.milvus_db,
        "milvus_collection": settings.milvus_doctor_collection,
        "dimension": dimension,
        "total_chunks": len(chunks),
        "insert_result": _json_safe(result),
        "collection_stats": _json_safe(stats),
    }
    _write_manifest(DOCTOR_MANIFEST_PATH, manifest)
    return manifest


def embed_dept_mappings(*, settings: Settings | None = None) -> dict:
    """症状/疾病→科室映射向量化：PostgreSQL → Milvus dept_symptom_mappings。"""
    settings = settings or get_settings()
    mappings = load_dept_mappings_from_db()
    embed_model = build_embeddings(settings)
    client = MilvusClient(uri=settings.milvus_uri)

    texts = [m.embedding_text for m in mappings]
    vectors = embed_texts(embed_model, texts, settings.embed_batch_size, settings)
    if len(vectors) != len(mappings):
        raise RuntimeError("Embedding 返回数量与映射条目数量不一致")

    dimension = len(vectors[0])
    collection = settings.milvus_mapping_collection
    reset_collection(
        client,
        db_name=settings.milvus_db,
        collection_name=collection,
        dimension=dimension,
    )

    rows = [
        {
            "id": _stable_id(m.mapping_id),
            "vector": vector,
            "mapping_id": m.mapping_id,
            "dept_id": m.dept_id,
            "dept_name": m.dept_name,
            "entity_type": m.entity_type,
            "keywords": json.dumps(m.keywords, ensure_ascii=False),
            "category_label": m.category_label,
            "source_chunk_id": m.source_chunk_id,
            "source_section": m.source_section,
            "evidence": m.evidence,
            "confidence": m.confidence,
            "recommendable": m.recommendable,
            "text": m.embedding_text,
        }
        for m, vector in zip(mappings, vectors)
    ]

    print(f"写入 Milvus {settings.milvus_db}.{collection} …")
    result = client.insert(collection_name=collection, data=rows)
    client.flush(collection_name=collection)
    stats = client.get_collection_stats(collection_name=collection)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "postgresql:zy91_dept_mappings",
        "embedding_model": settings.embedding_model,
        "embedding_api_base": settings.embedding_api_base,
        "milvus_uri": settings.milvus_uri,
        "milvus_db": settings.milvus_db,
        "milvus_collection": collection,
        "dimension": dimension,
        "total_chunks": len(mappings),
        "recommendable_chunks": sum(1 for m in mappings if m.recommendable),
        "insert_result": _json_safe(result),
        "collection_stats": _json_safe(stats),
    }
    _write_manifest(MAPPING_MANIFEST_PATH, manifest)
    return manifest


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="向量化 Chunk 并写入 Milvus")
    parser.add_argument(
        "--target",
        choices=("dept", "doctors", "mappings", "all"),
        default="all",
        help="dept=科室, doctors=医生, mappings=症状映射, all=全部",
    )
    parser.add_argument(
        "--hierarchical",
        action="store_true",
        help="科室使用分层 chunks（需先 chunk --hierarchical）→ dept_chunks_hierarchical",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    manifests: list[tuple[str, dict]] = []

    if args.target in ("dept", "all"):
        if args.hierarchical:
            print("=== 科室分层 Chunk 向量化 ===")
            manifests.append(("dept_hier", embed_dept_hierarchical_chunks()))
        else:
            print("=== 科室 Chunk 向量化（扁平） ===")
            manifests.append(("dept", embed_dept_chunks()))
    if args.target in ("doctors", "all"):
        print("=== 医生 Chunk 向量化 ===")
        manifests.append(("doctors", embed_doctor_chunks()))
    if args.target in ("mappings", "all"):
        print("=== 症状/疾病→科室 映射向量化 ===")
        manifests.append(("mappings", embed_dept_mappings()))

    print("---")
    for label, manifest in manifests:
        print(
            f"[{label}] {manifest['total_chunks']} 条 → "
            f"{manifest['milvus_db']}.{manifest['milvus_collection']} "
            f"(dim={manifest['dimension']}, stats={manifest['collection_stats']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
