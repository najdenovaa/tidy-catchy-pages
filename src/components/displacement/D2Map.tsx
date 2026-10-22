import { useEffect, useRef } from "react";
import type { D2Result } from "@/lib/displacement-2d";
import { paintUnwrapped } from "./d2-shared";

/** Развёртка затрубья: по горизонтали окружность (центр — низ ствола, узкий зазор), по вертикали глубина. */
export default function D2Map({ res, colors, snap, designTopMD, height = 520, solidMask, axisLabels, axisTitle, marks }: {
  res: D2Result; colors: string[]; snap: number; designTopMD?: number; height?: number; solidMask?: Uint8Array;
  axisLabels?: [number, string][]; axisTitle?: string; marks?: { mdTop: number; mdBot: number; label: string; xFrom?: number; xTo?: number }[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cnv = ref.current; if (!cnv) return;
    const dpr = window.devicePixelRatio || 1;
    const Wc = cnv.clientWidth || 300, Hc = height;
    cnv.width = Wc * dpr; cnv.height = Hc * dpr;
    const ctx = cnv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wc, Hc);
    const css = getComputedStyle(cnv);
    const fg = css.getPropertyValue("--d2-fg") || "#64748b";
    const left = 52, right = 8, top = 8, bottom = 34;
    const pw = Wc - left - right, ph = Hc - top - bottom;
    const img = paintUnwrapped(res, colors, Math.min(snap, res.snapshots.length - 1), 96, solidMask);
    const tmp = document.createElement("canvas"); tmp.width = img.width; tmp.height = img.height;
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, left, top, pw, ph);
    // оси
    ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.font = "10px system-ui, sans-serif"; ctx.lineWidth = 1;
    const z0 = res.zCenters[0], dz = (res.zCenters[1] ?? z0 + 1) - z0, zA = z0 - dz / 2, zB = res.zCenters[res.nZ - 1] + dz / 2;
    const y = (md: number) => top + ((md - zA) / (zB - zA)) * ph;
    const L = zB - zA, step = L > 1500 ? 250 : L > 600 ? 100 : L > 150 ? 50 : 10;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let md = Math.ceil(zA / step) * step; md <= zB; md += step) {
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(left, y(md)); ctx.lineTo(left + pw, y(md)); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(`${md}`, left - 4, y(md));
    }
    ctx.save(); ctx.translate(10, top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("Глубина по стволу, м", 0, 0); ctx.restore();
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const labels: [number, string][] = axisLabels ?? [[0, "верх"], [0.25, "бок"], [0.5, "низ"], [0.75, "бок"], [1, "верх"]];
    for (const [f, t] of labels) ctx.fillText(t, left + f * pw, top + ph + 4);
    ctx.fillText(axisTitle ?? "окружность затрубья (низ — узкий зазор)", left + pw / 2, top + ph + 18);
    for (const m of marks ?? []) {
      const x0 = left + (m.xFrom ?? 0) * pw, x1 = left + (m.xTo ?? 1) * pw;
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.strokeRect(x0, y(m.mdTop), Math.max(2, x1 - x0), Math.max(2, y(m.mdBot) - y(m.mdTop)));
      ctx.fillStyle = "#ef4444"; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(m.label, Math.min(x0 + 2, left + pw - 60), y(m.mdTop) - 2);
      ctx.lineWidth = 1; ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "top";
    }
    if (designTopMD !== undefined && designTopMD > zA && designTopMD < zB) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ef4444"; ctx.beginPath(); ctx.moveTo(left, y(designTopMD)); ctx.lineTo(left + pw, y(designTopMD)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ef4444"; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText("проектный верх цемента", left + 4, y(designTopMD) - 2);
    }
    ctx.strokeStyle = fg; ctx.strokeRect(left, top, pw, ph);
  }, [res, colors, snap, height, designTopMD, solidMask, axisLabels, axisTitle, marks]);
  return <canvas ref={ref} style={{ width: "100%", height }} className="[--d2-fg:#64748b] dark:[--d2-fg:#94a3b8]" aria-label="Развёртка затрубья" />;
}
