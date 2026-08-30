"""公开博客阅读接口与管理员文件树接口。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.blog import (
    BlogNodeCreate,
    BlogNodeDetail,
    BlogNodeSummary,
    BlogNodeUpdate,
)
from app.services.blog import (
    create_blog_node,
    delete_blog_node,
    get_blog_node,
    get_published_post,
    list_blog_nodes,
    update_blog_node,
)

router = APIRouter(tags=["blog"])


@router.get("/blog/tree", response_model=list[BlogNodeSummary])
def read_public_blog_tree(
    db: Annotated[Session, Depends(get_db)],
) -> list[BlogNodeSummary]:
    return list_blog_nodes(db, published_only=True)


@router.get("/blog/posts/{slug}", response_model=BlogNodeDetail)
def read_public_blog_post(
    slug: str, db: Annotated[Session, Depends(get_db)]
) -> BlogNodeDetail:
    return get_published_post(db, slug)


@router.get("/admin/blog/tree", response_model=list[BlogNodeSummary])
def read_admin_blog_tree(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> list[BlogNodeSummary]:
    return list_blog_nodes(db, published_only=False)


@router.get("/admin/blog/nodes/{node_id}", response_model=BlogNodeDetail)
def read_admin_blog_node(
    node_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> BlogNodeDetail:
    return get_blog_node(db, node_id)


@router.post(
    "/admin/blog/nodes",
    response_model=BlogNodeDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_blog_node(
    data: BlogNodeCreate,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> BlogNodeDetail:
    return create_blog_node(db, data, creator=admin)


@router.patch("/admin/blog/nodes/{node_id}", response_model=BlogNodeDetail)
def update_admin_blog_node(
    node_id: uuid.UUID,
    data: BlogNodeUpdate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> BlogNodeDetail:
    return update_blog_node(db, get_blog_node(db, node_id), data)


@router.delete("/admin/blog/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_blog_node(
    node_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> Response:
    delete_blog_node(db, get_blog_node(db, node_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
