/// <reference lib="webworker" />
import { simulateRirChannel } from "@/lib/rir-channel-2d";

self.onmessage = (e: MessageEvent<{ id: number; args: Parameters<typeof simulateRirChannel> }>) => {
  const { id, args } = e.data;
  try {
    let last = 0;
    const out = simulateRirChannel(args[0], args[1], args[2], args[3], (f) => {
      const now = Date.now(); if (now - last > 150) { last = now; (self as unknown as Worker).postMessage({ id, progress: f }); }
    });
    (self as unknown as Worker).postMessage({ id, ...out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
