import { useRef, useEffect, memo } from "react";
import { Input } from "@/components/ui/input";

interface BlurInputProps {
  value: string | number;
  onValueCommit: (value: string) => void;
  type?: string;
  step?: string;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

/**
 * Fully uncontrolled input that only pushes value to parent on blur or Enter.
 * Parent re-renders will NOT steal focus or reset cursor position.
 */
function BlurInputInner({ value, onValueCommit, type = "text", ...rest }: BlurInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const committedRef = useRef(String(value ?? ""));

  // Sync from parent ONLY when the input is NOT focused
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const newVal = String(value ?? "");
    if (document.activeElement !== el && newVal !== committedRef.current) {
      el.value = newVal;
      committedRef.current = newVal;
    }
  }, [value]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const val = el.value;
    if (val !== committedRef.current) {
      committedRef.current = val;
      onValueCommit(val);
    }
  };

  return (
    <Input
      ref={ref}
      type={type}
      defaultValue={String(value ?? "")}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      {...rest}
    />
  );
}

export const BlurInput = memo(BlurInputInner);
