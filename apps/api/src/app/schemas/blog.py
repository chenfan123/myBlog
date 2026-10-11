"""博客树与 Markdown 文档接口模型。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BlogNodeKind = Literal["folder", "document"]
MarkdownTheme = Literal["editorial", "github", "smartblue", "cyanosis", "fancy", "night-purple"]


class BlogNodeCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    kind: BlogNodeKind
    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class BlogNodeUpdate(BaseModel):
    parent_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=180)
    content: str | None = Field(default=None, max_length=2_000_000)
    markdown_theme: MarkdownTheme | None = None
    is_published: bool | None = None
    sort_order: int | None = None

    @field_validator("name", "slug")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class BlogNodePosition(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    sort_order: int = Field(ge=0)


class BlogNodeReorder(BaseModel):
    items: list[BlogNodePosition] = Field(min_length=1, max_length=500)


class BlogNodeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    kind: BlogNodeKind
    name: str
    slug: str | None
    is_published: bool
    markdown_theme: MarkdownTheme
    sort_order: int
    updated_at: datetime


class BlogNodeDetail(BlogNodeSummary):
    content: str
    created_at: datetime
    published_at: datetime | None


class BlogCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    parent_id: uuid.UUID | None = None

    @field_validator("content")
    @classmethod
    def trim_comment(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("评论内容不能为空")
        return value


class BlogCommentItem(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    author_id: uuid.UUID
    author_name: str
    content: str
    created_at: datetime
    can_delete: bool = False


class BlogEngagement(BaseModel):
    like_count: int
    comment_count: int
    liked_by_me: bool
    comments: list[BlogCommentItem]


class BlogLikeResult(BaseModel):
    liked: bool
    like_count: int
