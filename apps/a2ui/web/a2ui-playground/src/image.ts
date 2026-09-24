export interface ComposerImage {
  url: string;
  name: string;
  width?: number;
  height?: number;
}

/** 宽屏截图视为 PC 参考图；竖屏 App 截图不算。 */
export function isDesktopReferenceImage(image: ComposerImage): boolean {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  if (width < 2 || height < 2) {
    return false;
  }
  return width / height >= 1.25 && width >= 720;
}

export function desktopFormHint(images: ComposerImage[]): string {
  if (!images.some(isDesktopReferenceImage)) {
    return "";
  }
  return "【形态】参考图是宽屏 PC 界面，beginRendering.styles.formFactor 必须是 desktop，按桌面端排版。";
}

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const KEEP_ORIGINAL_BYTES = 400 * 1024;

export async function fileToComposerImage(file: File): Promise<ComposerImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只支持图片文件");
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new Error("图片太大，请选 8MB 以内的文件");
  }
  const bitmap = await loadImage(file);
  if (file.size <= KEEP_ORIGINAL_BYTES && /image\/(png|jpeg|jpg|webp|gif)/i.test(file.type)) {
    return {
      url: await readAsDataUrl(file),
      name: file.name || "image",
      width: bitmap.width,
      height: bitmap.height,
    };
  }
  return { ...(await compressImage(file, bitmap)), name: file.name || "image" };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function compressImage(
  file: File,
  image: HTMLImageElement,
): Promise<Pick<ComposerImage, "url" | "width" | "height">> {
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return { url: await readAsDataUrl(file), width: image.width, height: image.height };
  }
  context.drawImage(image, 0, 0, width, height);
  return { url: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width, height };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片无法读取"));
    };
    image.src = url;
  });
}
