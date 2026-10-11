"""公开博客阅读接口与管理员文件树接口。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_optional_current_user, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.blog import (
    BlogCommentCreate,
    BlogCommentItem,
    BlogEngagement,
    BlogLikeResult,
    BlogNodeCreate,
    BlogNodeDetail,
    BlogNodeReorder,
    BlogNodeSummary,
    BlogNodeUpdate,
)
from app.services.blog import (
    create_blog_comment,
    create_blog_node,
    delete_blog_comment,
    delete_blog_node,
    get_blog_engagement,
    get_blog_node,
    get_published_post,
    list_blog_nodes,
    reorder_blog_nodes,
    toggle_blog_like,
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


@router.get("/blog/posts/{slug}/engagement", response_model=BlogEngagement)
def read_public_blog_engagement(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User | None, Depends(get_optional_current_user)],
) -> BlogEngagement:
    return get_blog_engagement(db, get_published_post(db, slug), user)


@router.post(
    "/blog/posts/{slug}/comments",
    response_model=BlogCommentItem,
    status_code=status.HTTP_201_CREATED,
)
def create_public_blog_comment(
    slug: str,
    data: BlogCommentCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BlogCommentItem:
    comment = create_blog_comment(
        db,
        get_published_post(db, slug),
        user,
        data.content,
        data.parent_id,
    )
    return BlogCommentItem(
        id=comment.id,
        parent_id=comment.parent_id,
        author_id=user.id,
        author_name=user.display_name,
        content=comment.content,
        created_at=comment.created_at,
        can_delete=True,
    )


@router.post("/blog/posts/{slug}/like", response_model=BlogLikeResult)
def toggle_public_blog_like(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BlogLikeResult:
    liked, count = toggle_blog_like(db, get_published_post(db, slug), user)
    return BlogLikeResult(liked=liked, like_count=count)


@router.delete("/blog/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_public_blog_comment(
    comment_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    delete_blog_comment(db, comment_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.put("/admin/blog/reorder", response_model=list[BlogNodeSummary])
def reorder_admin_blog_nodes(
    data: BlogNodeReorder,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> list[BlogNodeSummary]:
    return reorder_blog_nodes(db, data)


@router.delete("/admin/blog/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_blog_node(
    node_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> Response:
    delete_blog_node(db, get_blog_node(db, node_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
