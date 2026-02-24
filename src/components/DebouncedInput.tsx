import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Input } from "@/components/ui/input";

interface DebouncedInputProps {
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  delay?: number;
  type?: string;
  step?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  readOnly?: boolean;
  min?: string | number;
  max?: string | number;
  disabled?: boolean;
}

/**
 * Input that updates local state immediately for responsive typing,
 * but only fires onChange to parent after a debounce delay.
 */
function DebouncedInputInner({
  value: externalValue,
  onChange,
  delay = 300,
  ...rest
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(String(externalValue ?? ""));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync from parent when external value changes (e.g. reset)
  const lastEmitted = useRef(String(externalValue ?? ""));
  useEffect(() => {
    const ext = String(externalValue ?? "");
    if (ext !== lastEmitted.current) {
      setLocalValue(ext);
      lastEmitted.current = ext;
    }
  }, [externalValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastEmitted.current = val;
      // Create a minimal synthetic event
      const synth = { target: { value: val } } as React.ChangeEvent<HTMLInputElement>;
      onChangeRef.current(synth);
    }, delay);
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return <Input {...rest} value={localValue} onChange={handleChange} />;
}

export const DebouncedInput = memo(DebouncedInputInner);
