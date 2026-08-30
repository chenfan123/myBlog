import { ArrowLeft, ArrowRight, Database, GitBranch, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { TriageDemo } from "@/components/agent/triage-demo";

export const metadata = {
  title: "智能导诊 Agent｜CHEN.DEV",
  description: "一个面向医院科室分诊的多轮对话 Agent 项目。",
};

export default function MedicalTriagePage() {
  return (
    <>
      <SiteHeader activePath="home" />
      <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-10 lg:pt-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Button asChild variant="ghost" className="-ml-3">
            <Link href="/#agent-demo"><ArrowLeft /> 返回 Agent 项目</Link>
          </Button>
          <span className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">本地演示</span>
        </div>

        <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
          <div className="rounded-[2rem] border bg-card/90 p-7 shadow-sm sm:p-10">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Stethoscope className="size-6" />
            </div>
            <p className="mt-8 text-sm text-primary">第一个 Agent 项目</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">智能导诊 Agent</h1>
            <p className="mt-6 text-base leading-8 text-muted-foreground">
              用户只需要说出自己的不舒服，Agent 会先判断是否存在紧急情况，再通过几轮简单追问，帮助找到更合适的挂号科室。
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {['FastAPI', 'LangGraph', 'RAG', 'Milvus'].map((item) => <span key={item} className="rounded-full border bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground">{item}</span>)}
            </div>
            <div className="mt-10 grid gap-4 border-t pt-6 sm:grid-cols-3">
              <ProjectFact icon={GitBranch} title="多轮对话" text="根据回答继续追问" />
              <ProjectFact icon={ShieldCheck} title="风险优先" text="先识别紧急情况" />
              <ProjectFact icon={Database} title="有据可查" text="推荐附知识来源" />
            </div>
          </div>

          <TriageDemo />
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-3">
          <InfoCard title="它解决什么问题" text="医院科室划分比较细，很多人知道自己不舒服，却不知道应该挂哪个科。这个 Agent 把科室公开介绍整理成可以检索的知识库。" />
          <InfoCard title="它怎么做判断" text="先做危险信号判断，再补充部位、持续时间和伴随症状等信息，最后从知识库里召回候选科室。" />
          <InfoCard title="它不会做什么" text="它只提供导诊建议，不做医学诊断，不开药，也不代替医生。出现严重症状时应立即就医或拨打 120。" />
        </section>

        <div className="mt-10 flex justify-center">
          <Button asChild variant="outline"><Link href="/#agent-demo">回到个人主页 <ArrowRight /></Link></Button>
        </div>
      </main>
    </>
  );
}

function ProjectFact({ icon: Icon, title, text }: { icon: typeof GitBranch; title: string; text: string }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>;
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return <article className="rounded-2xl border bg-card/70 p-5"><h2 className="font-semibold">{title}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p></article>;
}
