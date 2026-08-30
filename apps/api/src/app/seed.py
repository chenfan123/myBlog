from app.db.session import SessionLocal
from app.schemas.resume import ResumeData
from app.services.resume import save_resume

INITIAL_RESUME = {
    "profile": {
        "name": "陈建华",
        "role": "前端开发工程师 / Agent 开发工程师",
        "age": "年龄待补充",
        "experience": "工作年限待补充",
        "education": "学历待补充",
        "phone": "电话号码待补充",
        "email": "邮箱待补充",
        "introduction": (
            "专注现代 Web 应用与智能应用研发，重视工程质量、产品体验和实际业务价值。"
            "这里将替换为你的个人简介与职业定位。"
        ),
        "avatar_url": "",
        "location": "",
        "availability": "开放机会",
    },
    "strengths": [
        "具备从需求分析、技术选型到上线交付的完整前端工程能力。",
        "能够将复杂业务拆分为稳定、可维护且具有良好体验的产品模块。",
        "熟悉大模型应用开发，能够完成 Agent 工作流、工具调用与可观测性建设。",
    ],
    "skill_groups": [
        {
            "title": "前端开发",
            "skills": [
                "JavaScript",
                "TypeScript",
                "React",
                "Next.js",
                "Tailwind CSS",
                "shadcn/ui",
            ],
        },
        {
            "title": "服务端",
            "skills": ["Python", "FastAPI", "REST API", "PostgreSQL", "SQLAlchemy"],
        },
        {
            "title": "Agent 工程",
            "skills": ["LangChain", "LangGraph", "RAG", "Tool Calling", "Milvus"],
        },
        {
            "title": "工程能力",
            "skills": ["Git", "Docker", "CI/CD", "性能优化", "系统设计"],
        },
    ],
    "expectation": {
        "roles": ["前端开发工程师", "Agent 开发工程师"],
        "location": "城市待补充",
        "salary": "薪资范围待补充",
        "availability": "到岗时间待补充",
    },
    "experiences": [
        {
            "company": "公司名称待补充",
            "role": "岗位名称待补充",
            "time": "20XX.XX — 至今",
            "content": [
                "负责的产品、业务范围和团队职责待补充。",
                "承担的核心技术工作及跨团队协作内容待补充。",
            ],
            "achievements": [
                "使用量化数据描述工作成果，例如性能提升、效率提升或业务增长。",
                "补充一项最能体现个人贡献的代表性业绩。",
            ],
        },
        {
            "company": "上一家公司待补充",
            "role": "岗位名称待补充",
            "time": "20XX.XX — 20XX.XX",
            "content": ["负责的业务模块与日常工作内容待补充。"],
            "achievements": ["代表性项目成果和量化指标待补充。"],
        },
    ],
    "projects": [
        {
            "index": "01",
            "name": "项目名称待补充",
            "role": "项目角色待补充",
            "time": "项目时间待补充",
            "summary": (
                "用一到两句话说明项目背景、服务对象，以及这个项目解决了什么问题。"
            ),
            "contribution": [
                "负责的核心模块、技术方案与具体工作待补充。",
                "项目中的难点、解决过程及最终成果待补充。",
            ],
            "stack": ["Next.js", "TypeScript", "FastAPI"],
        },
        {
            "index": "02",
            "name": "项目名称待补充",
            "role": "项目角色待补充",
            "time": "项目时间待补充",
            "summary": "重点描述这个项目的业务价值，而不是只罗列使用过的技术。",
            "contribution": [
                "个人贡献与职责边界待补充。",
                "可以被验证或量化的项目结果待补充。",
            ],
            "stack": ["React", "PostgreSQL", "Docker"],
        },
    ],
    "agent_demos": [
        {
            "title": "个人知识库 Agent",
            "description": (
                "支持文档检索、多轮追问、引用溯源和记忆管理的知识问答 Demo。"
            ),
            "tags": ["LangGraph", "RAG", "Milvus"],
            "status": "规划中",
            "demo_url": "",
        },
        {
            "title": "研发协作 Agent",
            "description": "能够理解代码上下文，辅助需求拆解、代码检索和评审建议生成。",
            "tags": ["Tools", "FastAPI", "Next.js"],
            "status": "规划中",
            "demo_url": "",
        },
    ],
}


def main() -> None:
    with SessionLocal() as db:
        save_resume(db, ResumeData.model_validate(INITIAL_RESUME))
    print("Initial resume data saved.")


if __name__ == "__main__":
    main()
