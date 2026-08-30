"use client";

import { useState } from "react";
import { toPng } from "html-to-image";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DownloadResumeButton({ fileName }: { fileName: string }) {
  const [generating, setGenerating] = useState(false);

  const downloadImage = async () => {
    const resume = document.querySelector<HTMLElement>(".print-resume");
    if (!resume || generating) return;

    setGenerating(true);
    try {
      await document.fonts.ready;
      await Promise.all(
        Array.from(resume.querySelectorAll("img")).map((image) =>
          image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
        ),
      );

      const dataUrl = await toPng(resume, {
        backgroundColor: "#f8f6ef",
        cacheBust: true,
        pixelRatio: 1.5,
        filter: (node) =>
          !(node instanceof HTMLElement && node.classList.contains("print-hidden")),
      });
      const link = document.createElement("a");
      link.download = `${fileName || "个人简历"}-个人简历.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("Failed to generate resume image", error);
      window.alert("简历长图生成失败，请确认头像等远程图片允许跨域访问后重试。");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button size="lg" variant="outline" onClick={downloadImage} disabled={generating}>
      <Download />
      {generating ? "正在生成长图…" : "下载简历长图"}
    </Button>
  );
}
