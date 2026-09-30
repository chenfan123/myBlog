import {
  ArrowRight,
  BrainCircuit,
  Check,
  Code2,
  Database,
  Mail,
  Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DownloadResumeButton } from '@/components/resume/download-resume-button';
import { A2UIProfileEnhancement } from '@/components/profile/a2ui-profile-enhancement';
import { A2UISectionEnhancement } from '@/components/profile/a2ui-section-enhancement';
import { SiteHeader } from '@/components/site/site-header';
import { PortfolioRouteScroll } from '@/components/site/portfolio-route-scroll';
import { fetchResume, type ResumeData } from '@/lib/resume';
import Link from 'next/link';

function splitStack(items: string[]): string[] {
  return items.flatMap((item) => item.split(/[、,，；;|/]+/).map((value) => value.trim()).filter(Boolean));
}

const fallbackResume: ResumeData = {
  profile: {
    name: '陈建华',
    role: '前端开发工程师 / Agent 开发工程师',
    age: '年龄待补充',
    experience: '工作年限待补充',
    education: '学历待补充',
    phone: '电话号码待补充',
    email: '邮箱待补充',
    introduction:
      '专注现代 Web 应用与智能应用研发，重视工程质量、产品体验和实际业务价值。这里将替换为你的个人简介与职业定位。',
    avatar_url: '',
    location: '',
    availability: '开放机会',
  },

  strengths: [
    '具备从需求分析、技术选型到上线交付的完整前端工程能力。',
    '能够将复杂业务拆分为稳定、可维护且具有良好体验的产品模块。',
    '熟悉大模型应用开发，能够完成 Agent 工作流、工具调用与可观测性建设。',
  ],

  skill_groups: [
    {
      title: '前端开发',
      skills: [
        'JavaScript',
        'TypeScript',
        'React',
        'Next.js',
        'Tailwind CSS',
        'shadcn/ui',
      ],
    },
    {
      title: '服务端',
      skills: ['Python', 'FastAPI', 'REST API', 'PostgreSQL', 'SQLAlchemy'],
    },
    {
      title: 'Agent 工程',
      skills: ['LangChain', 'LangGraph', 'RAG', 'Tool Calling', 'Milvus'],
    },
    {
      title: '工程能力',
      skills: ['Git', 'Docker', 'CI/CD', '性能优化', '系统设计'],
    },
  ],

  expectation: {
    roles: ['前端开发工程师', 'Agent 开发工程师'],
    location: '城市待补充',
    salary: '薪资范围待补充',
    availability: '到岗时间待补充',
  },

  experiences: [
    {
      company: '公司名称待补充',
      role: '岗位名称待补充',
      time: '20XX.XX — 至今',
      content: [
        '负责的产品、业务范围和团队职责待补充。',
        '承担的核心技术工作及跨团队协作内容待补充。',
      ],
      achievements: [
        '使用量化数据描述工作成果，例如性能提升、效率提升或业务增长。',
        '补充一项最能体现个人贡献的代表性业绩。',
      ],
    },
    {
      company: '上一家公司待补充',
      role: '岗位名称待补充',
      time: '20XX.XX — 20XX.XX',
      content: ['负责的业务模块与日常工作内容待补充。'],
      achievements: ['代表性项目成果和量化指标待补充。'],
    },
  ],

  projects: [
    {
      index: '01',
      name: '项目名称待补充',
      role: '项目角色待补充',
      time: '项目时间待补充',
      summary:
        '用一到两句话说明项目背景、服务对象，以及这个项目解决了什么问题。',
      contribution: [
        '负责的核心模块、技术方案与具体工作待补充。',
        '项目中的难点、解决过程及最终成果待补充。',
      ],
      stack: ['Next.js', 'TypeScript', 'FastAPI'],
    },
    {
      index: '02',
      name: '项目名称待补充',
      role: '项目角色待补充',
      time: '项目时间待补充',
      summary: '重点描述这个项目的业务价值，而不是只罗列使用过的技术。',
      contribution: [
        '个人贡献与职责边界待补充。',
        '可以被验证或量化的项目结果待补充。',
      ],
      stack: ['React', 'PostgreSQL', 'Docker'],
    },
  ],

  agent_demos: [
    {
      title: '个人知识库 Agent',
      description:
        '支持文档检索、多轮追问、引用溯源和记忆管理的知识问答 Agent。',
      tags: ['LangGraph', 'RAG', 'Milvus'],
      status: '规划中',
      demo_url: '',
    },
    {
      title: '研发协作 Agent',
      description: '能够理解代码上下文，辅助需求拆解、代码检索和评审建议生成。',
      tags: ['Tools', 'FastAPI', 'Next.js'],
      status: '规划中',
      demo_url: '',
    },
  ],
};

export const dynamic = 'force-dynamic';

export default async function Home() {
  const resume = (await fetchResume()) ?? fallbackResume;
  const {
    profile,
    strengths,
    skill_groups: skillGroups,
    experiences,
    projects,
    agent_demos: agentDemos,
    expectation,
  } = resume;
  const hasManyStrengths = strengths.length > 4;
  const hasTriageDemo = agentDemos.some((demo) => /导诊|智能客服/.test(demo.title));
  const hasA2UIDemo = agentDemos.some((demo) => /A2UI/i.test(demo.title));
  const visibleAgentDemos = [
    ...(hasTriageDemo
      ? []
      : [
        {
          title: '智能导诊 Agent',
          description: '用户描述症状后，通过多轮追问和知识库检索，给出适合挂号的科室建议。',
          tags: ['LangGraph', 'RAG', 'FastAPI', 'Milvus'],
          status: '可体验',
          demo_url: '/agent-demo/medical-triage',
        },
      ]),
    ...agentDemos,
    ...(hasA2UIDemo
      ? []
      : [
          {
            title: 'A2UI 生成式界面 Agent',
            description: '通过自然语言动态生成 A2UI 协议，并在 Playground 中实时渲染、调试和继续对话。',
            tags: ['A2UI', 'AG-UI', 'React', 'DashScope'],
            status: '可体验',
            demo_url: '/agent-demo/a2ui',
          },
        ]),
  ];
  return (
    <main className="print-resume min-h-screen overflow-hidden">
      <PortfolioRouteScroll />
      <SiteHeader />

      <section
        id="profile"
        className="mx-auto max-w-7xl px-6 pb-16 pt-10 lg:px-10 lg:pb-24 lg:pt-16"
      >
        <div className="resume-hero grid overflow-hidden rounded-[2rem] border bg-white/90 lg:grid-cols-[0.68fr_1.32fr]">
          <aside className="border-b bg-[#eef5d9] p-7 sm:p-10 lg:border-b-0 lg:border-r">
            <div className="avatar-placeholder relative mx-auto flex aspect-[2/3] w-full max-w-[280px] items-end overflow-hidden rounded-[1.5rem] border border-lime-950/10 bg-[#dcebac] p-6">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={`${profile.name}的头像`}
                  className="absolute inset-0 size-full object-contain object-top"
                />
              ) : (
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-lime-950/60">
                    个人照片
                  </p>
                  <p className="mt-1 text-sm font-medium text-lime-950">
                    头像位置
                  </p>
                </div>
              )}
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="年龄" value={profile.age} />
              <InfoItem label="经验" value={profile.experience} />
              <InfoItem label="学历" value={profile.education} />
              <InfoItem label="状态" value="开放机会" />
            </div>
          </aside>

          <A2UIProfileEnhancement profile={profile} skillGroups={skillGroups}>
          <div className="flex h-full flex-col justify-center p-7 sm:p-10 lg:p-14 xl:p-16">
            <div className="mb-7 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" /> 正在寻找新的工作机会
            </div>
            <p className="text-lg text-muted-foreground">你好，我是</p>
            <h1 className="mt-2 text-5xl font-semibold tracking-[-0.05em] sm:text-7xl">
              {profile.name}
            </h1>
            <p className="mt-5 text-xl font-medium text-primary sm:text-2xl">
              {profile.role}
            </p>
            <p className="mt-7 max-w-2xl text-base leading-8 text-muted-foreground">
              {profile.introduction}
            </p>
            <div className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm">
              <a
                className="flex items-center gap-2 hover:text-primary"
                href={`tel:${profile.phone}`}
              >
                <span className="text-muted-foreground">电话</span>
                {profile.phone}
              </a>
              <a
                className="flex items-center gap-2 hover:text-primary"
                href={`mailto:${profile.email}`}
              >
                <span className="text-muted-foreground">邮箱</span>
                {profile.email}
              </a>
            </div>
            <div className="print-hidden mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/experience" scroll={false}>
                  查看工作经历 <ArrowRight />
                </Link>
              </Button>
              <DownloadResumeButton fileName={profile.name} />
            </div>
            <div id="skills" className="mt-8 border-t pt-7">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
                  常用技术
                </p>
                <span className="text-xs text-muted-foreground">技术栈</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {skillGroups.map((group, index) => {
                  const SkillIcon = getSkillGroupIcon(group.title, index);
                  return (
                    <div
                      key={group.title}
                      className="rounded-xl border bg-background/55 p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lime-100 text-lime-800">
                          <SkillIcon className="size-4" />
                        </span>
                        <h3 className="text-sm font-semibold">{group.title}</h3>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {group.skills.map((skill) => (
                          <Badge
                            key={skill}
                            variant="secondary"
                            className="h-5 px-2 font-mono text-[10px] font-normal"
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </A2UIProfileEnhancement>
        </div>
      </section>

      <section id="expectation" className="border-y bg-[#eef5d9]">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-14 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime-800">
              目前的求职方向
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              求职期望
            </h2>
          </div>
          <div className="grid gap-2 text-sm sm:text-right">
            <strong className="text-lg">{expectation.roles.join(' / ')}</strong>
            <span className="text-muted-foreground">
              {[
                expectation.location,
                expectation.salary,
                expectation.availability,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>
      </section>

      <section id="about" className="border-y bg-white/70">
        <A2UISectionEnhancement kind="strengths" title="个人优势" items={strengths}>
        <div
          className={
            hasManyStrengths
              ? 'mx-auto max-w-7xl px-6 py-16 lg:px-10'
              : 'mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[0.75fr_1.25fr] lg:px-10'
          }
        >
          <SectionHeading
            eyebrow="关于我"
            title="个人优势"
            description=""
            horizontal={hasManyStrengths}
          />
          <div
            className={
              hasManyStrengths ? 'mt-9 grid gap-4 md:grid-cols-2' : 'space-y-4'
            }
          >
            {strengths.map((strength, index) => (
              <div
                key={`${index}-${strength}`}
                className={`flex rounded-2xl border bg-background/60 ${
                  hasManyStrengths ? 'min-h-28 gap-4 p-5' : 'gap-5 p-5 sm:p-6'
                }`}
              >
                <span className="shrink-0 font-mono text-sm text-primary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="leading-7">{removeLeadingNumber(strength)}</p>
              </div>
            ))}
          </div>
        </div>
        </A2UISectionEnhancement>
      </section>

      <section
        id="experience"
        className="mx-auto max-w-7xl px-6 py-20 lg:px-10"
      >
        <div className="grid gap-14 lg:grid-cols-[0.35fr_1fr]">
        <SectionHeading
          eyebrow="经历"
          title="工作经历"
          description=""
        />
        <div className="space-y-6">
          {experiences.map((experience, index) => (
            <article
              key={`${experience.company}-${index}`}
              className="timeline-card relative rounded-2xl border bg-white/85 p-6 sm:p-8"
            >
              <div className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold">
                    {experience.company}
                  </h3>
                  <p className="mt-1 text-sm text-primary">{experience.role}</p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {experience.time}
                </span>
              </div>
              <ResumeList title="工作内容" items={experience.content} />
              <ResumeList
                title="工作业绩"
                items={experience.achievements}
                accent
              />
            </article>
          ))}
        </div>
        </div>
      </section>

      <section id="projects" className="border-y bg-white/70">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <SectionHeading
            eyebrow="做过的项目"
            title="项目经历"
            description=""
            horizontal
          />
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {projects.map((project) => (
              <article
                key={project.index}
                className="project-card rounded-2xl border bg-background/60 p-6 sm:p-8"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="font-mono text-xs text-primary">
                    项目 {project.index}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {project.time}
                  </span>
                </div>
                <h3 className="mt-8 text-2xl font-semibold">{project.name}</h3>
                <p className="mt-1 text-sm text-primary">{project.role}</p>
                <p className="mt-5 leading-7 text-muted-foreground">
                  {project.summary}
                </p>
                <ResumeList title="个人贡献" items={project.contribution} />
                <div className="mt-6 flex flex-wrap gap-2">
                  {splitStack(project.stack).map((item) => (
                    <Badge
                      key={item}
                      variant="outline"
                      className="font-mono font-normal"
                    >
                      {item}
                    </Badge>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="agent-demo"
        className="border-y bg-white/70"
      >
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Selected Agent Work
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Agent 实现
          </h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {visibleAgentDemos.map((demo) => (
              <article
                key={demo.title}
                className="flex min-h-72 flex-col rounded-[1.35rem] border border-lime-900/15 bg-gradient-to-br from-white via-white to-lime-50/70 p-5 shadow-[0_14px_38px_rgba(73,94,37,0.06)] sm:p-6"
              >
                <div className="flex items-start justify-between gap-4 border-b border-lime-900/10 pb-4">
                  <h3 className="text-lg font-semibold text-primary sm:text-xl">
                    {demo.title}
                  </h3>
                  <span className="shrink-0 rounded-full border border-lime-800/15 bg-lime-50 px-3 py-1 text-xs text-lime-800">
                    {demo.status}
                  </span>
                </div>
                <p className="mt-4 min-h-12 text-sm leading-7 text-foreground/80 sm:text-base">
                  {demo.description}
                </p>
                <div className="mt-6">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                    Tech Stack
                  </p>
                  <p className="mt-3 rounded-xl bg-lime-950/[0.045] px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
                    {demo.tags.join(' · ')}
                  </p>
                </div>
                {demo.demo_url ? (
                  <Button asChild className="mt-5 w-fit bg-[#17212b] text-white hover:bg-[#273443]">
                    <Link href={demo.demo_url}>
                      查看 Agent <ArrowRight />
                    </Link>
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer id="contact" className="border-t bg-white/75">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <div>
            <p className="text-xl font-semibold">联系我</p>
            <p className="mt-2 text-sm text-muted-foreground">
              如果你对我的经历或项目感兴趣，可以通过邮件联系我。
            </p>
          </div>
          <Button asChild>
            <a href={`mailto:${profile.email}`}>
              <Mail /> {profile.email}
            </a>
          </Button>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
            <span>© 2026 CHEN.DEV · ainew.gz.cn</span>
            <a
              className="transition-colors hover:text-foreground hover:underline"
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
            >
              浙ICP备2025148566号-2
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-lime-950/10 bg-white/50 p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1 block text-xs font-medium">{value}</strong>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  horizontal = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  horizontal?: boolean;
}) {
  return (
    <div
      className={
        horizontal
          ? 'flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'
          : ''
      }
    >
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
      </div>
      {description ? (
        <p
          className={`mt-4 leading-7 text-muted-foreground ${
            horizontal ? 'max-w-lg sm:mt-0' : 'max-w-md'
          }`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function ResumeList({
  title,
  items,
  accent = false,
}: {
  title: string;
  items: string[];
  accent?: boolean;
}) {
  return (
    <div className="mt-6">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-3 text-sm leading-6 text-muted-foreground"
          >
            <Check
              className={`mt-1 size-4 shrink-0 ${
                accent ? 'text-primary' : 'text-muted-foreground'
              }`}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function removeLeadingNumber(value: string) {
  return value.replace(/^\s*\d+[.、]\s*/, '');
}

const fallbackSkillIcons = [Code2, BrainCircuit, Database, Wrench];

function getSkillGroupIcon(title: string, index: number) {
  if (/前端|web|react/i.test(title)) return Code2;
  if (/agent|ai|智能|大模型/i.test(title)) return BrainCircuit;
  if (/后端|服务端|数据库|server|data/i.test(title)) return Database;
  if (/工程|工具|运维|devops/i.test(title)) return Wrench;
  return fallbackSkillIcons[index % fallbackSkillIcons.length];
}
