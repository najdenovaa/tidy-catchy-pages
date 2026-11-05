/** Shared Bradenhead trace: volume transport, mixed-column hydrostatics and elastic storage.
 * Injectivity/relative viscosity is a planning scenario, not a fracture-growth or isolation test.
 */
import { MU_REL, type RirInputs, type RirResult } from "./rir-calculations";
import { pipeFrictionMPa } from "./cementing-calculations";
import { spotGeometry, spotHydrostatic, spotTVD } from "./rir-spot-squeeze";
import type { CompositionDesign } from "./rir-compositions";
import type { SqueezeSimResult, SqueezePoint } from "./rir-squeeze-sim";
export function simulateBradenhead(
  inp: RirInputs,
  res: RirResult,
  design: CompositionDesign | null,
): SqueezeSimResult {
  const g = res.spotInput,
    spot = res.spotResult;
  if (!g || !spot) throw new Error("Не рассчитана геометрия размещения.");
  const warnings = [
    "Проникновение состава рассчитано по приёмистости и оценке относительной вязкости. Фильтрация, образование корки, смешение и развитие трещин не моделируются. Герметичность этим расчётом не подтверждается.",
  ];
  const points: SqueezePoint[] = [],
    stages: SqueezeSimResult["stages"] = [],
    holds: SqueezeSimResult["holds"] = [];
  const planned = spot.plannedSqueezeM3,
    placed = spot.placedM3,
    capacity = spot.tubingCapacityBeforeM3;
  const qSet = Math.max(0.00001, inp.pumpRateLs) * 0.06,
    dtMax = 0.25;
  const compliance = Math.max(
    0.0001,
    spot.casingAreaM2 * inp.wellDepthMD * 6.1e-4,
  ); // m³/MPa, assumed water + tubular compressibility
  const j = res.fit?.J ?? 0,
    pOpen = res.fit?.openingBhpMPa ?? g.zonePressureMPa;
  const relativeMu = design
    ? Math.max(
        1,
        design.kind === "resin"
          ? (design.thickeningCurve[0]?.y ?? MU_REL[res.composition])
          : parseFloat(
              design.props.find((p) => p.label.startsWith("ПВ"))?.value ??
                String(MU_REL[res.composition]),
            ),
      )
    : MU_REL[res.composition];
  let t = 0,
    vPumped = 0,
    closedPumped = 0,
    vChannel = 0,
    vCement = 0,
    pressure = 0,
    cementFed = 0,
    displaced = 0;
  let shoe = g.initialShoeMD,
    lifting = false,
    lifted = false,
    bopClosed = false,
    elastic = 0,
    maxBalance = 0,
    iterationLimit = false,
    ageLimit = false;
  const tubingCement = () =>
    Math.min(cementFed, Math.max(0, capacity - displaced));
  const cementOutside = () => Math.max(0, cementFed - tubingCement());
  const geometry = () => {
    if (lifting || lifted)
      return spotGeometry(g, shoe, Math.max(0, placed - vCement));
    return spotGeometry(g, shoe, cementOutside(), "displaced");
  };
  const hydro = () =>
    spotHydrostatic(g, (g.leakTopMD + g.leakBottomMD) / 2, geometry().topMD);
  const friction = (rateM3min: number) =>
    pipeFrictionMPa(
      rateM3min / 0.06,
      Math.max(0, shoe),
      res.tubingID,
      1,
      0,
      inp.wellFluidDensity * 1000,
    ).pressureMPa;
  const mobility = () => {
    const share = Math.min(1, vCement / Math.max(0.05, planned));
    let age = 1;
    if (design) {
      const x = t / Math.max(1, design.workLifeAtBhctMin);
      age = Math.max(0.02, 1 - 0.85 * x * x);
    }
    return age / (1 + (relativeMu - 1) * share);
  };
  const addPoint = (stage: string, qLs = 0) => {
    const geo = geometry(),
      v = Math.max(0, cementFed - vCement),
      inTub = lifting || lifted ? geo.slurryInTubingM3 : tubingCement();
    let top = -1,
      bottom = -1;
    if (inTub > 1e-10) {
      if (lifting || lifted) {
        top = Math.max(0, geo.topMD / Math.max(1, shoe));
        bottom = 1;
      } else {
        top = Math.min(1, displaced / Math.max(1e-12, capacity));
        bottom = Math.min(
          1,
          (displaced + cementFed) / Math.max(1e-12, capacity),
        );
      }
    }
    const pipeTop = top >= 0 ? top * shoe : shoe,
      pipeBottom = bottom >= 0 ? bottom * shoe : shoe;
    const pipeHyd =
      (inp.wellFluidDensity * 9.81 * spotTVD(g, shoe)) / 1000 +
      (((res.compositionDensity - inp.wellFluidDensity) * 9.81) / 1000) *
        Math.max(0, spotTVD(g, pipeBottom) - spotTVD(g, pipeTop));
    const circulationPressure = Math.max(
      0,
      spotHydrostatic(g, shoe, geo.topMD) - pipeHyd + friction(qLs * 0.06),
    );
    points.push({
      t,
      stage,
      qLs,
      surfaceMPa: bopClosed ? pressure : circulationPressure,
      bhpMPa: bopClosed ? pressure + hydro() - friction(qLs * 0.06) : hydro(),
      vPumped,
      vChannel,
      vCompChannel: vCement,
      compTop: top,
      compBottom: bottom,
      belowComp: placed > 0 ? Math.max(0, (v - inTub) / placed) : 0,
      channelFill: planned > 0 ? vCement / planned : 0,
      mobility: mobility(),
      allowSurfaceMPa: res.maxSurfaceMPa,
      elasticVolumeM3: elastic,
      closedPumpedM3: closedPumped,
      balanceErrorM3: Math.abs(closedPumped - vChannel - elastic),
      openTubing: {
        shoeMD: shoe,
        initialShoeMD: g.initialShoeMD,
        liftedShoeMD: g.liftedShoeMD,
        leakTopMD: inp.leak.topMD,
        leakBottomMD: inp.leak.bottomMD,
        slurryTopMD: geo.topMD,
        slurryBottomMD: g.slurryBottomMD,
        slurryM3: Math.max(0, v - inTub),
        totalSlurryM3: v,
        bopClosed,
        slurryInTubingM3: inTub,
        placementMode: g.placementMode ?? "displaced",
      },
    });
  };
  const reasons = [
    ...((placed + spot.placementDisplacementM3) / qSet > 1440
      ? ["Размещение при заданном расходе превышает предел сценария 24 ч."]
      : []),
    ...(!Number.isFinite(inp.hesitationStages) ||
    inp.hesitationStages < 1 ||
    inp.hesitationStages > 30 ||
    !Number.isInteger(inp.hesitationStages)
      ? ["Число ступеней должно быть целым от 1 до 30."]
      : []),
    ...(!Number.isFinite(inp.hesitationHoldMin) ||
    inp.hesitationHoldMin < 0 ||
    inp.hesitationHoldMin > 360
      ? ["Выдержка на ступени: от 0 до 360 мин."]
      : []),
    ...spot.errors,
    ...(!res.fit ? ["Нет замеров приёмистости."] : []),
    ...(!(inp.pumpRateLs > 0) ? ["Расход должен быть больше нуля."] : []),
  ];
  addPoint("Исходное состояние");
  if (reasons.length) {
    return {
      points,
      stages,
      holds,
      outcome: "no_squeeze",
      outcomeText: "Расчёт задавливания не выполнен: " + reasons.join(" "),
      blocked: true,
      blockReasons: reasons,
      finalSurfaceMPa: 0,
      compInChannelM3: 0,
      totalTimeMin: 0,
      workLifeUsedPct: 0,
      warnings,
    };
  }
  const phase = (
    name: string,
    duration: number,
    kind: "pump" | "hold",
    tick: (dt: number) => void,
  ) => {
    if (duration <= 0) return;
    const start = t,
      n = Math.ceil(duration / dtMax),
      dt = duration / n;
    for (let i = 0; i < n; i++) {
      tick(dt);
      t += dt;
      addPoint(name, kind === "pump" ? inp.pumpRateLs : 0);
    }
    stages.push({ name, t0: start, t1: t, kind });
  };
  phase("Закачка цемента в НКТ", placed / qSet, "pump", (dt) => {
    const dv = Math.min(placed - cementFed, qSet * dt);
    cementFed += dv;
    vPumped += dv;
  });
  phase(
    "Продавка и размещение цемента напротив нарушения",
    spot.placementDisplacementM3 / qSet,
    "pump",
    (dt) => {
      const dv = Math.min(spot.placementDisplacementM3 - displaced, qSet * dt);
      displaced += dv;
      vPumped += dv;
    },
  );
  lifting = true;
  phase("Подъём НКТ выше пачки", 5, "hold", (dt) => {
    shoe = Math.max(
      g.liftedShoeMD,
      shoe - ((g.initialShoeMD - g.liftedShoeMD) * dt) / 5,
    );
  });
  shoe = g.liftedShoeMD;
  lifting = false;
  lifted = true;
  bopClosed = true;
  phase("Закрытие и проверка ПВО", 3, "hold", () => {});
  const maxMinutes = 1440,
    referenceLife = design?.workLifeAtBhctMin ?? 0;
  const flowStep = (wanted: number, dt: number, stage: string) => {
    const k = (j * mobility()) / 60,
      h = hydro(),
      cap = res.maxSurfaceMPa;
    const estimate = (q: number) => {
      const fr = friction(q),
        trial = pressure + (q * dt) / compliance;
      if (trial + h - fr <= pOpen) return trial;
      return (
        (compliance * pressure + q * dt + k * dt * (pOpen - h + fr)) /
        (compliance + k * dt)
      );
    };
    let q = wanted;
    if (estimate(q) > cap) {
      let lo = 0,
        hi = q;
      for (let n = 0; n < 30; n++) {
        const mid = (lo + hi) / 2;
        if (estimate(mid) > cap) hi = mid;
        else lo = mid;
      }
      q = lo;
    }
    const next = Math.max(0, Math.min(cap, estimate(q))),
      injected = q * dt,
      out = Math.max(0, injected + compliance * (pressure - next));
    const geo = geometry(),
      coverage =
        Math.max(
          0,
          Math.min(g.leakBottomMD, g.slurryBottomMD) -
            Math.max(g.leakTopMD, geo.topMD),
        ) / Math.max(1e-9, g.leakBottomMD - g.leakTopMD);
    const cementOut = Math.min(
      Math.max(0, placed - vCement),
      out * Math.min(1, coverage),
    );
    closedPumped += injected;
    vPumped += injected;
    vChannel += out;
    vCement += cementOut;
    pressure = next;
    elastic = compliance * pressure;
    maxBalance = Math.max(
      maxBalance,
      Math.abs(closedPumped - vChannel - elastic),
    );
    t += dt;
    addPoint(stage, q / 0.06);
    return injected;
  };
  const count = Math.max(1, Math.min(30, Math.round(inp.hesitationStages)));
  for (let stage = 1; stage <= count; stage++) {
    const target = planned / count,
      start = t;
    let pumped = 0,
      ticks = 0;
    while (pumped < target - 1e-10) {
      if (t >= maxMinutes || ticks++ > 12000) {
        iterationLimit = true;
        break;
      }
      if (design && t >= 0.75 * referenceLife) {
        ageLimit = true;
        break;
      }
      const dt = dtMax,
        dv = flowStep(
          Math.min(qSet, (target - pumped) / dt),
          dt,
          `Ступень ${stage}`,
        );
      pumped += dv;
      if (dv < 1e-12 && pressure >= res.maxSurfaceMPa - 1e-8) {
        iterationLimit = true;
        break;
      }
    }
    stages.push({
      name: `Ступень ${stage}`,
      t0: start,
      t1: t,
      kind: "squeeze",
    });
    const pStart = pressure,
      holdStart = t,
      hold = Math.max(0, inp.hesitationHoldMin),
      n = Math.ceil(hold / dtMax);
    for (let k = 0; k < n; k++) flowStep(0, hold / n, `Выдержка ${stage}`);
    stages.push({
      name: `Выдержка ${stage}`,
      t0: holdStart,
      t1: t,
      kind: "hold",
    });
    holds.push({
      stage,
      pStart,
      pEnd: pressure,
      decayPct:
        pStart > 0 ? Math.max(0, ((pStart - pressure) / pStart) * 100) : 100,
    });
    if (iterationLimit || ageLimit) break;
  }
  if (iterationLimit)
    warnings.push(
      "Расчёт остановлен по пределу длительности 24 ч либо недостижимому расходу; показаны фактически рассчитанные объёмы, а не полный план.",
    );
  if (ageLimit)
    warnings.push(
      "Достигнуто 75% времени жизни состава по используемой оценке: дальнейшая закачка остановлена.",
    );
  if (!design)
    warnings.push(
      "Лабораторное время загустевания и реология состава не заданы: загустевание не прогнозируется, относительная вязкость является сценарной оценкой.",
    );
  warnings.push(
    `Упругоёмкость принята ${compliance.toFixed(4)} м³/МПа (жидкость и трубы); спад на выдержке связан с выходом накопленного объёма. Максимальная невязка ${maxBalance.toExponential(2)} м³.`,
  );
  if (spot.cementHydroMPa > pOpen)
    warnings.push(
      "Гидростатика пачки выше принятого давления открытия. Возможны самопроизвольные перетоки; после падения до 0 МПа разрежение и многофазность данной моделью не рассчитываются.",
    );
  const outcome = vCement > 1e-9 ? "partial" : "no_squeeze";
  return {
    points,
    stages,
    holds,
    outcome,
    blocked: false,
    workLifeKnown: !!design,
    blockReasons: [],
    outcomeText:
      vCement > 1e-9
        ? `Расчётный сценарий: в нарушение поступило ${vCement.toFixed(3)} м³ состава при плане подачи ${planned.toFixed(3)} м³; накопленный упругий объём ${elastic.toFixed(3)} м³. Герметичность не подтверждена, необходим промысловый контроль.`
        : "В рассчитанном окне состав в нарушение не поступил; это результат сценария, а не испытание герметичности.",
    finalSurfaceMPa: pressure,
    compInChannelM3: vCement,
    totalTimeMin: t,
    workLifeUsedPct: referenceLife > 0 ? (t / referenceLife) * 100 : 0,
    warnings,
  };
}
