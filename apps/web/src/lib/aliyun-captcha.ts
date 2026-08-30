type AliyunCaptchaInstance = {
  show?: () => void;
};

type AliyunCaptchaOptions = {
  SceneId: string;
  mode: "popup";
  element: string;
  button: string;
  success: (captchaVerifyParam: string) => void;
  fail: (result: unknown) => void;
  getInstance: (instance: AliyunCaptchaInstance) => void;
  onError: (error: { code?: string; msg?: string }) => void;
  onClose: (reason?: string) => void;
  slideStyle: { width: number; height: number };
  language: "cn";
};

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => void;
  }
}

const SCRIPT_URL =
  "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
let captchaScriptPromise: Promise<void> | null = null;

function loadAliyunCaptchaScript(prefix: string, region: string) {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (captchaScriptPromise) return captchaScriptPromise;

  // 全局配置必须在阿里云主脚本执行前写入。
  window.AliyunCaptchaConfig = { prefix, region };
  captchaScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      captchaScriptPromise = null;
      reject(new Error("阿里云验证码加载失败，请检查网络后重试"));
    };
    document.head.appendChild(script);
  });
  return captchaScriptPromise;
}

export async function runAliyunCaptcha({
  prefix,
  sceneId,
  region = "cn",
}: {
  prefix: string;
  sceneId: string;
  region?: string;
}) {
  if (!prefix || !sceneId) throw new Error("阿里云验证码尚未配置");
  await loadAliyunCaptchaScript(prefix, region);

  return new Promise<string>((resolve, reject) => {
    const initCaptcha = window.initAliyunCaptcha;
    if (!initCaptcha) {
      reject(new Error("阿里云验证码初始化失败，请刷新页面重试"));
      return;
    }

    const suffix = Math.random().toString(36).slice(2);
    const element = document.createElement("div");
    const trigger = document.createElement("button");
    element.id = `aliyun-captcha-element-${suffix}`;
    trigger.id = `aliyun-captcha-trigger-${suffix}`;
    trigger.type = "button";
    element.className = "fixed -left-[9999px] top-0 h-10 w-[360px]";
    trigger.className = "fixed -left-[9999px] top-0";
    document.body.append(element, trigger);

    let settled = false;
    const cleanup = () => {
      element.remove();
      trigger.remove();
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    initCaptcha({
      SceneId: sceneId,
      mode: "popup",
      element: `#${element.id}`,
      button: `#${trigger.id}`,
      success: (captchaVerifyParam) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(captchaVerifyParam);
      },
      // 普通验证失败时组件会自动刷新，无需在这里提前终止用户流程。
      fail: () => undefined,
      getInstance: () => {
        trigger.click();
      },
      onError: (error) => {
        rejectOnce(new Error(error.msg || "阿里云验证码加载异常，请稍后重试"));
      },
      onClose: () => {
        rejectOnce(new Error("你已取消验证"));
      },
      slideStyle: { width: 360, height: 40 },
      language: "cn",
    });
  });
}
