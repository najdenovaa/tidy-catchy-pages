## Проблема

В графике ЭЦП оранжевая кривая «на башмаке пред. ОК» во время продавки становится выше синей «на забое». Физически неверно — башмак выше забоя.

**Корень бага:** `calcAnnularHydrostaticAtDepth(targetMD)` в `src/lib/cementing-calculations.ts` (строки 1481–1529). При `targetMD == prevShoe` условие нижней секции `currentBottomMD > prevShoe` (строка 1500) не срабатывает (равенство), и весь цемент попадает в верхнюю секцию, завышая гидростатику на башмаке.

## Изменения

### 1. `src/lib/cementing-calculations.ts` — `calcAnnularHydrostaticAtDepth`

Перед основным циклом заполнения добавить «резервирование» объёмов в нижней секции, когда `targetMD <= prevShoe + ε` и `lowerLen > 0`:

- ёмкость нижней секции: `lowerCapacity = lowerLen * lowerVPMhydro`;
- пройти `exitBatches` снизу вверх (от последнего к первому), уменьшать `batch.volumeM3` на `min(остаток, оставшаяся ёмкость нижней секции)` — эти объёмы **не** добавляются в `pressure` (они физически ниже башмака);
- после этого текущий цикл с `currentBottomMD = targetMD` (≤ prevShoe) заполняет только верхнюю секцию, используя уменьшенные `batch.volumeM3`.

Реализация: сделать локальную копию `exitBatches` (иммутабельно) и корректировать `volumeM3` копий, чтобы не влиять на другие вызовы.

Случай `prevShoe < targetMD < casingDepthMD` остаётся без изменений — текущая логика частичного заполнения корректна.

**Проверка согласованности:** объёмы, «посаженные» в нижнюю секцию, должны совпадать с тем, что делает `calcAnnularHydrostatic()` (строки 1411–…) и `calcAnnularProfile()` (1163–…). При `targetMD == casingDepthMD` (полный столб) новая логика не активируется, значение = старому расчёту. Свойство `ecdAtBottom >= ecdAtPrevShoe` должно выполняться автоматически, т.к. при `targetMD = prevShoe` в верхнюю секцию попадают только те же лёгкие флюиды сверху, что и при `targetMD = casingDepthMD` (с точностью до вытеснения).

### 2. `src/components/ChartsSection.tsx` — сообщение безопасности (строки 206–219)

- `maxEcd` считать по **обоим** уровням:
  ```ts
  const perPoint = pressureData.map(p => ({
    bottom: p.ecdAtBottomGcm3 || 0,
    shoe: p.ecdAtPrevShoeGcm3 || 0,
  }));
  const maxBottom = Math.max(...perPoint.map(x => x.bottom));
  const maxShoe = Math.max(...perPoint.map(x => x.shoe));
  const maxEcd = Math.max(maxBottom, maxShoe);
  const maxLocation = maxShoe > maxBottom ? "на башмаке пред. ОК" : "на забое";
  ```
- В сообщении (ok/риск) заменить фиксированное «на забое» на `maxLocation`.

## Не менять

- `calcAnnularHydrostatic()` и `calcAnnularProfile()` — там расчёт по всему столбу, баг не проявляется.
- Логику при `prevShoe < targetMD < casingDepthMD`.
- Прочие компоненты (`HydraulicsSection`, `SafetyTrafficLight`) — там уже используется `ecdAtBottom` как основной критерий, менять контракт не нужно.
