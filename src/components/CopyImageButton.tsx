import { useState, useCallback, type RefObject } from "react";
import { Copy, Check } from "lucide-react";
import { copyElementAsImage } from "@/lib/capture-image";

interface Props {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
}

export default function CopyImageButton({ targetRef, label = "Копировать" }: Props) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!targetRef.current || loading) return;
    setLoading(true);
    const ok = await copyElementAsImage(targetRef.current);
    setLoading(false);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [targetRef, loading]);

  return (
    <button
      data-copy-btn="true"
      onClick={handleCopy}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Скопировано!" : label}
    </button>
  );
}
