import { TriageDemo } from "@/components/agent/triage-demo";

export const metadata = {
  title: "智能导诊｜CHEN.DEV",
  description: "通过多轮对话梳理症状并推荐合适的就诊科室。",
};

export default function MedicalTriagePage() {
  return (
    <main className="h-svh min-h-[640px] overflow-hidden bg-[#f6f8f5]">
      <TriageDemo />
    </main>
  );
}
