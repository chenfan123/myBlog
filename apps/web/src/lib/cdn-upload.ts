type UploadOptions = {
  biz?: string;
  scene?: string;
};

type UploadResult = {
  url: string;
  width: number;
  height: number;
};

const maxImageSize = 10 * 1024 * 1024;
const suffixByMimeType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export async function uploadImageToCdn(file: File, options: UploadOptions): Promise<UploadResult> {
  const suffix = suffixByMimeType[file.type];
  if (!suffix) throw new Error("仅支持 PNG、JPEG、WebP、GIF、BMP 或 TIFF 图片。 ");
  if (file.size > maxImageSize) throw new Error("图片不能超过 10MB。 ");

  const { width, height } = await readImageSize(file);
  const formData = new FormData();
  formData.set("file", file);
  formData.set("width", String(width));
  formData.set("height", String(height));
  formData.set("biz", options.biz ?? "appraiser");
  formData.set("scene", options.scene ?? "coin");

  const uploadResponse = await fetch("/api/cdn/upload", {
    method: "POST",
    body: formData,
  });
  const result = (await uploadResponse.json().catch(() => null)) as {
    url?: string;
    width?: number;
    height?: number;
    message?: string;
  } | null;
  if (!uploadResponse.ok || !result?.url) {
    throw new Error(result?.message ?? "图片上传到 CDN 失败。 ");
  }
  return { url: result.url, width, height };
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片尺寸。 "));
    };
    image.src = objectUrl;
  });
}
