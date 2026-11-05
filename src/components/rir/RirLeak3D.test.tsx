import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RirLeak3D from "./RirLeak3D";
import { screenCase } from "@/test/fixtures/rir-screenshot";
import { calculateRir } from "@/lib/rir-calculations";
import { simulateSqueeze } from "@/lib/rir-squeeze-sim";
afterEach(cleanup);
it("falls back to a frame-based schematic without WebGL and updates the actual BOP state", () => {
  const start = calculateRir(screenCase);
  const inp = {
    ...screenCase,
    spot: {
      ...screenCase.spot,
      liftedShoeMD: start.spotResult!.recommendedLiftedShoeMD,
    },
  };
  const res = calculateRir(inp),
    sim = simulateSqueeze(inp, res, null);
  render(<RirLeak3D inp={inp} res={res} sim={sim} design={null} />);
  expect(screen.getByText(/WebGL недоступен/)).toBeInTheDocument();
  expect(screen.getByText("ПВО закрыто на НКТ")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("rir-leak3d-range"), {
    target: { value: 0 },
  });
  expect(screen.getByText("ПВО открыто")).toBeInTheDocument();
});
