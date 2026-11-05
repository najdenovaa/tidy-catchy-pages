import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { useRirCursor } from "./use-rir-cursor";
import type { SqueezeSimResult } from "@/lib/rir-squeeze-sim";
const trace = {
  points: [0, 1, 2, 3, 4].map((t) => ({ t })),
  blocked: false,
} as SqueezeSimResult;
function View({
  name,
  index,
  change,
}: {
  name: string;
  index: number;
  change: (i: number) => void;
}) {
  const c = useRirCursor(trace, index, change);
  return (
    <div>
      <output aria-label={name}>{c.index}</output>
      <button onClick={() => c.setIndex(0)}>{name} начало</button>
      <button onClick={() => c.setPlaying(true)}>{name} пуск</button>
    </div>
  );
}
function Harness() {
  const [index, setIndex] = useState(4);
  return (
    <>
      <View name="График" index={index} change={setIndex} />
      <View name="3D" index={index} change={setIndex} />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("keeps chart and 3D at the same frame when either view changes time", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("3D начало"));
  expect(screen.getByLabelText("График")).toHaveTextContent("0");
  expect(screen.getByLabelText("3D")).toHaveTextContent("0");
});
it("advances the shared frame during playback", () => {
  vi.useFakeTimers();
  render(<Harness />);
  fireEvent.click(screen.getByText("График начало"));
  fireEvent.click(screen.getByText("График пуск"));
  act(() => vi.advanceTimersByTime(50));
  expect(screen.getByLabelText("График")).toHaveTextContent("1");
  expect(screen.getByLabelText("3D")).toHaveTextContent("1");
});
