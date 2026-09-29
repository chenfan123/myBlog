import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

const PlaygroundApp = lazy(() => import("./App").then(({ App }) => ({ default: App })));
const ProfileEmbed = lazy(() =>
  import("./ProfileEmbed").then(({ ProfileEmbed: Component }) => ({ default: Component })),
);
const SectionEmbed = lazy(() =>
  import("./SectionEmbed").then(({ SectionEmbed: Component }) => ({ default: Component })),
);

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found");
}

const embed = new URLSearchParams(window.location.search).get("embed");

createRoot(root).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <Suspense fallback={null}>
        {embed === "profile" ? <ProfileEmbed /> : embed === "section" ? <SectionEmbed /> : <PlaygroundApp />}
      </Suspense>
    </ConfigProvider>
  </StrictMode>,
);
