import { toPng, toBlob } from "html-to-image";

/**
 * Capture a DOM element as a PNG data URL.
 */
export async function captureElementAsDataUrl(el: HTMLElement): Promise<string> {
  return toPng(el, {
    backgroundColor: "#1a1a2e",
    pixelRatio: 2,
    filter: (node) => {
      // Skip copy buttons from the capture
      if (node instanceof HTMLElement && node.dataset.copyBtn === "true") return false;
      return true;
    },
  });
}

/**
 * Capture a DOM element as a Blob (PNG).
 */
export async function captureElementAsBlob(el: HTMLElement): Promise<Blob | null> {
  return toBlob(el, {
    backgroundColor: "#1a1a2e",
    pixelRatio: 2,
    filter: (node) => {
      if (node instanceof HTMLElement && node.dataset.copyBtn === "true") return false;
      return true;
    },
  });
}

/**
 * Copy an element as an image to clipboard.
 */
export async function copyElementAsImage(el: HTMLElement): Promise<boolean> {
  try {
    const blob = await captureElementAsBlob(el);
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (e) {
    console.error("Copy image failed:", e);
    return false;
  }
}

/**
 * Convert data URL to ArrayBuffer for docx ImageRun.
 */
export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
