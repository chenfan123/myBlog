"""博客树的查询、层级校验和文档保存逻辑。"""

import re
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.blog import BlogNode
from app.models.user import User
from app.schemas.blog import BlogNodeCreate, BlogNodeUpdate

slug_pattern = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def list_blog_nodes(db: Session, *, published_only: bool) -> list[BlogNode]:
    nodes = list(
        db.scalars(
            select(BlogNode).order_by(BlogNode.sort_order, BlogNode.kind, BlogNode.name)
        )
    )
    if not published_only:
        return nodes

    by_id = {node.id: node for node in nodes}
    visible_ids = {
        node.id for node in nodes if node.kind == "document" and node.is_published
    }
    for node_id in tuple(visible_ids):
        parent_id = by_id[node_id].parent_id
        while parent_id and parent_id in by_id:
            visible_ids.add(parent_id)
            parent_id = by_id[parent_id].parent_id
    return [node for node in nodes if node.id in visible_ids]


def get_blog_node(db: Session, node_id: uuid.UUID) -> BlogNode:
    node = db.get(BlogNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="博客节点不存在")
    return node


def get_published_post(db: Session, slug: str) -> BlogNode:
    node = db.scalar(
        select(BlogNode).where(
            BlogNode.slug == slug,
            BlogNode.kind == "document",
            BlogNode.is_published.is_(True),
        )
    )
    if node is None:
        raise HTTPException(status_code=404, detail="文章不存在或尚未发布")
    return node


def create_blog_node(db: Session, data: BlogNodeCreate, *, creator: User) -> BlogNode:
    _validate_parent(db, data.parent_id)
    node_id = uuid.uuid4()
    node = BlogNode(
        id=node_id,
        parent_id=data.parent_id,
        kind=data.kind,
        name=data.name,
        slug=f"post-{node_id.hex[:10]}" if data.kind == "document" else None,
        created_by=creator.id,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def update_blog_node(db: Session, node: BlogNode, data: BlogNodeUpdate) -> BlogNode:
    fields = data.model_fields_set
    if "parent_id" in fields:
        _validate_parent(db, data.parent_id, moving_node=node)
        node.parent_id = data.parent_id
    if data.name is not None:
        node.name = data.name
    if "slug" in fields:
        if node.kind != "document":
            raise HTTPException(status_code=400, detail="文件夹不能设置文章地址")
        if not data.slug or not slug_pattern.fullmatch(data.slug):
            raise HTTPException(
                status_code=400,
                detail="文章地址只能包含小写字母、数字和中划线",
            )
        node.slug = data.slug
    if data.content is not None:
        if node.kind != "document":
            raise HTTPException(status_code=400, detail="文件夹不能保存正文")
        node.content = data.content
    if data.sort_order is not None:
        node.sort_order = data.sort_order
    if data.is_published is not None:
        if node.kind != "document":
            raise HTTPException(status_code=400, detail="文件夹不能发布")
        node.is_published = data.is_published
        node.published_at = datetime.now(UTC) if data.is_published else None
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="文章地址已经存在") from error
    db.refresh(node)
    return node


def delete_blog_node(db: Session, node: BlogNode) -> None:
    db.delete(node)
    db.commit()


def _validate_parent(
    db: Session,
    parent_id: uuid.UUID | None,
    *,
    moving_node: BlogNode | None = None,
) -> None:
    if parent_id is None:
        return
    parent = get_blog_node(db, parent_id)
    if parent.kind != "folder":
        raise HTTPException(status_code=400, detail="只能放入文件夹节点")
    if moving_node is None:
        return
    if parent.id == moving_node.id:
        raise HTTPException(status_code=400, detail="节点不能成为自己的父级")
    ancestor = parent
    while ancestor.parent_id:
        if ancestor.parent_id == moving_node.id:
            raise HTTPException(status_code=400, detail="不能移动到自己的子文件夹")
        ancestor = get_blog_node(db, ancestor.parent_id)
