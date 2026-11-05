import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RirModule, { type RirModuleHandle } from "./RirModule";
import { screenCase } from "@/test/fixtures/rir-screenshot";
vi.mock("./RirLeak3D", () => ({
  default: () => <div data-testid="trace-3d">3D trace</div>,
}));
vi.mock("./RirChannelCard", () => ({ default: () => <div>Channel</div> }));
vi.mock("./RirCharts", () => ({
  InjectivityChart: () => null,
  PenetrationDiagram: () => null,
  PressureWindowChart: ({ toolLabel }: { toolLabel: string }) => (
    <div>{toolLabel}</div>
  ),
}));
vi.mock("recharts", () =>
  Object.fromEntries(
    [
      "ComposedChart",
      "LineChart",
      "Line",
      "XAxis",
      "YAxis",
      "CartesianGrid",
      "Tooltip",
      "Legend",
      "ReferenceLine",
      "ReferenceArea",
      "ScatterChart",
      "Scatter",
      "Cell",
      "ZAxis",
    ].map((k) => [k, () => null]),
  ),
);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  localStorage.setItem("rir_technology_v2", "spot");
  localStorage.setItem("rir_inputs_v1_spot", JSON.stringify(screenCase));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps a physical pressure ceiling, explains the invalid lift and recalculates after explicit correction", () => {
  const handle: { current: RirModuleHandle | null } = { current: null };
  render(<RirModule handleRef={handle} />);
  expect(handle.current?.validationErrors().join(" ")).toContain("2044.4");
  expect(
    screen.getAllByText("Расчёт задавливания не выполнен")[0],
  ).toBeInTheDocument();
  expect(
    screen.getByText("Принять расчётную глубину подъёма"),
  ).toBeInTheDocument();
  expect(screen.getByText("конец открытых НКТ")).toBeInTheDocument();
  expect(screen.queryByText("Не задавлено")).not.toBeInTheDocument();
  expect(screen.queryByTestId("trace-3d")).not.toBeInTheDocument();
  expect(screen.getByTestId("rir-program-docx")).toBeDisabled();
  fireEvent.click(screen.getByText("Принять расчётную глубину подъёма"));
  expect(
    screen.queryByText("Расчёт задавливания не выполнен"),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("trace-3d")).toBeInTheDocument();
  expect(screen.getByTestId("rir-program-docx")).toBeEnabled();
  expect(handle.current?.validationErrors()).toEqual([]);
  expect(screen.getByTestId("rir-kpi")).not.toHaveTextContent("операция 0 мин");
});
