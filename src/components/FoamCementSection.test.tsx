import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import FoamCementSection from "./FoamCementSection";
import { simulateFoamJob, defaultFoamSettings } from "@/lib/foam-cement-engine";
import type { WellData } from "@/lib/cementing-calculations";
vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));
const well: WellData = {
  wellDepthMD: 500,
  wellDepthTVD: 500,
  casingDepthMD: 500,
  holeDiameter: 215.9,
  casingOD: 168.3,
  casingWall: 8.9,
  prevCasingDepth: 100,
  prevCasingID: 250,
  prevCasingOD: 273,
  ckodDepth: 480,
  cementRiseHeight: 500,
  cavernCoeff: 1,
  bottomTempStatic: 50,
  bottomTempCirc: 40,
  pumpZoneTop: 0,
  pumpZoneBottom: 0,
  trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 500, tvd: 500, zenith: 0, azimuth: 0 },
  ],
};
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: unknown;
  terminated = false;
  message: any;
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(m: unknown) {
    this.message = m;
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    const { id, input } = this.message;
    this.onmessage?.({ data: { id, result: simulateFoamJob(input) } });
  }
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Foam engineering workflow", () => {
  it("runs asynchronously, synchronizes views and invalidates reports after editing", () => {
    const report = vi.fn();
    render(
      <FoamCementSection
        wellData={well}
        slurries={[]}
        mudDensity={1200}
        onReportChange={report}
      />,
    );
    fireEvent.click(screen.getByText("Рассчитать программу"));
    expect(screen.getByText("Остановить")).toBeInTheDocument();
    act(() => FakeWorker.latest.finish());
    expect(screen.getByLabelText("Время операции")).toBeInTheDocument();
    expect(report.mock.calls.at(-1)?.[0]?.simulation.modelVersion).toContain(
      "foam-2",
    );
    fireEvent.change(screen.getByLabelText("Целевое FQ, % объёма газа"), {
      target: { value: "40" },
    });
    expect(screen.getByText(/Исходные данные изменились/)).toBeInTheDocument();
    expect(report.mock.calls.at(-1)?.[0]).toBeNull();
  });
  it("cancels worker without displaying an unfinished result", () => {
    render(
      <FoamCementSection wellData={well} slurries={[]} mudDensity={1200} />,
    );
    fireEvent.click(screen.getByText("Рассчитать программу"));
    fireEvent.click(screen.getByText("Остановить"));
    expect(FakeWorker.latest.terminated).toBe(true);
    expect(screen.queryByLabelText("Время операции")).not.toBeInTheDocument();
  });
  it("restores settings per calculation scope", () => {
    localStorage.setItem(
      "deall-foam-v2:abc",
      JSON.stringify({
        ...defaultFoamSettings({ wellData: well }),
        targetFoamQuality: 37,
      }),
    );
    render(
      <FoamCementSection
        scope="abc"
        wellData={well}
        slurries={[]}
        mudDensity={1200}
      />,
    );
    expect(screen.getByLabelText("Целевое FQ, % объёма газа")).toHaveValue(37);
  });
  it("allows computation without unavailable laboratory properties", () => {
    render(
      <FoamCementSection wellData={well} slurries={[]} mudDensity={1200} />,
    );
    expect(screen.getByText("Рассчитать программу")).toBeEnabled();
    expect(screen.getByText(/Лабораторных данных нет/)).toBeInTheDocument();
  });
});
