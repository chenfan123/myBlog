import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

const PlaygroundApp = lazy(() => import("./App").then(({ App }) => ({ default: App })));
const ProfileEmbed = lazy(() =>
  import("./ProfileEmbed").then(({ ProfileEmbed: Component }) => ({ default: Component })),
);

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found");
}

const embeddedProfile = new URLSearchParams(window.location.search).get("embed") === "profile";

createRoot(root).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <Suspense fallback={null}>{embeddedProfile ? <ProfileEmbed /> : <PlaygroundApp />}</Suspense>
    </ConfigProvider>
  </StrictMode>,
);
