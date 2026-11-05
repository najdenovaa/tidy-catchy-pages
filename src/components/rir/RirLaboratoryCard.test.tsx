import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RirLaboratoryCard from "./RirLaboratoryCard";
import { createRirLab } from "@/lib/rir-laboratory";
import { designRirComposition } from "@/lib/rir-compositions";
const context = { bhctC: 48, bhstC: 60, requiredMin: 180 };
const design = designRirComposition("cement", { ...context, requiredWorkLifeMin: 180, volumeM3: 3, targetDensity: 1.85 }, 2)!.primary;
afterEach(cleanup);
it("creates a RIR laboratory probe and keeps applying unmeasured properties disabled", () => {
  const onChange = vi.fn();
  const { rerender } = render(<RirLaboratoryCard kind="cement" design={design} context={context} totalM3={3} onChange={onChange} />);
  fireEvent.click(screen.getByText("Создать пробу РИР"));
  const draft = onChange.mock.calls[0][0];
  rerender(<RirLaboratoryCard kind="cement" design={design} draft={draft} context={context} totalM3={3} onChange={onChange} />);
  expect(screen.getByText("Применить измеренные свойства в расчёте РИР")).toBeDisabled();
  expect(screen.getByLabelText("Плотность (факт), г/см³")).toHaveValue("");
  expect(screen.queryByText(/Рецептура раствора для моста/)).not.toBeInTheDocument();
});
it("records decimal comma and keeps the measurement separate from a design forecast", () => {
  const onChange = vi.fn(), draft = createRirLab("cement", design, context);
  render(<RirLaboratoryCard kind="cement" design={design} draft={draft} context={context} totalM3={3} onChange={onChange} />);
  const density = screen.getByLabelText("Плотность (факт), г/см³");
  fireEvent.change(density, { target: { value: "1,82" } }); fireEvent.blur(density);
  expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].facts.density).toBe(1.82);
  expect(draft.facts.density).toBeNull();
});
