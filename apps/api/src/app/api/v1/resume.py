from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.session import get_db
from app.schemas.resume import ResumeData, ResumeResponse
from app.services.resume import get_resume, save_resume

router = APIRouter(tags=["resume"])


@router.get(
    "/admin/verify",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def verify_admin() -> None:
    """供 Next.js 服务端代理确认当前 Cookie 是否属于管理员。"""
    return None


@router.get("/resume", response_model=ResumeResponse)
def read_resume(db: Annotated[Session, Depends(get_db)]) -> ResumeResponse:
    resume = get_resume(db)
    if resume is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found"
        )
    return resume


@router.put(
    "/admin/resume",
    response_model=ResumeResponse,
    dependencies=[Depends(require_admin)],
)
def update_resume(
    resume: ResumeData,
    db: Annotated[Session, Depends(get_db)],
) -> ResumeResponse:
    return save_resume(db, resume)
