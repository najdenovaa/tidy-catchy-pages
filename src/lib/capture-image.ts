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
    if (!blob) {
      console.error("Copy image: blob is null");
      return false;
    }

    // Try Clipboard API first
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return true;
      } catch (clipErr) {
        console.warn("Clipboard API failed, falling back to download:", clipErr);
      }
    }

    // Fallback: download the image
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "image.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

/**
 * SVG → PNG с переносом вычисленных стилей (fill/stroke и т. п. из CSS-классов) в атрибуты.
 * Надёжнее html-to-image для схем с паттернами и маркерами (url(#id)).
 */
export async function svgToPngDataUrl(svg: SVGSVGElement, scale = 2, background = "#ffffff"): Promise<{ dataUrl: string; width: number; height: number }> {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline"];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el as Element);
    const d = dst[i] as Element;
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      // не затираем ссылки на паттерны/градиенты из атрибутов
      const attr = d.getAttribute(p);
      if (attr && attr.startsWith("url(")) continue;
      d.setAttribute(p, v.includes("url(") ? (attr ?? v) : v);
    }
    d.removeAttribute("class");
  });
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("svg load")); img.src = url; });
  const c = document.createElement("canvas");
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: c.toDataURL("image/png"), width: w, height: h };
}
