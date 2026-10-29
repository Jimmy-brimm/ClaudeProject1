/*
 * Formula-based estimates for the calculators. No physics simulation:
 * every result is a simple multiplication or division you can check by hand.
 * Works in the browser (window.CalcLib) and in Node (require) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalcLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 9.81; // m/s²
  const SUN_W_PER_M2 = 1000; // standard test-condition irradiance

  // Common cell formats for the sizing check.
  const CELLS = {
    '18650': { label: '18650 cylinder', volts: 3.6, ah: 3.0, grams: 47, cm3: 16.5 },
    '21700': { label: '21700 cylinder', volts: 3.6, ah: 5.0, grams: 70, cm3: 24.2 },
    pouch: { label: 'Li-po pouch (per 10 Wh)', volts: 3.7, ah: 2.7, grams: 45, cm3: 21 },
  };

  const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);
  const pct = (v) => num(v) / 100;

  /** Panel rating × real-world factor = watts you actually get. */
  function solar({ panelW, realFactorPct, sunHours }) {
    const usableW = num(panelW) * pct(realFactorPct);
    return { usableW, whPerDay: usableW * num(sunHours) };
  }

  /** mAh × volts ÷ 1000 = Wh. Runtime and phone charges from that. */
  function battery({ capacityMah, cellV, outputEffPct, loadW, phoneMah, phoneV }) {
    const wh = (num(capacityMah) * num(cellV)) / 1000;
    const deliverableWh = wh * pct(outputEffPct);
    const phoneWh = (num(phoneMah) * num(phoneV)) / 1000;
    return {
      wh,
      deliverableWh,
      runtimeH: num(loadW) > 0 ? deliverableWh / num(loadW) : Infinity,
      phoneWh,
      phoneCharges: phoneWh > 0 ? deliverableWh / phoneWh : 0,
    };
  }

  /** Battery Wh ÷ charging W = hours (charging loss applied to the watts). */
  function rechargeHours(batteryWh, chargeW, chargeEffPct) {
    const w = num(chargeW) * pct(chargeEffPct);
    return w > 0 ? num(batteryWh) / w : Infinity;
  }

  /**
   * Walking generator: the mass is lifted through its travel once per step,
   * so mechanical power ≈ m · g · travel · steps-per-second. Conversion
   * efficiency then takes off what the magnet and coil lose.
   */
  function walking({ massG, travelMm, stepsPerS, convEffPct, walkHoursPerDay }) {
    const mechW = (num(massG) / 1000) * G * (num(travelMm) / 1000) * num(stepsPerS);
    const elecW = mechW * pct(convEffPct);
    return { mechW, elecW, whPerDay: elecW * num(walkHoursPerDay) };
  }

  /** How many cells, how much space and weight, and how big the panel is. */
  function sizing({ batteryWh, cellType, packOverheadPct, bodyMm, panelW, panelEffPct, panelFolds }) {
    const cell = CELLS[cellType] || CELLS['18650'];
    const cellWh = cell.volts * cell.ah;
    const cells = Math.max(1, Math.ceil(num(batteryWh) / cellWh));
    const overhead = 1 + pct(packOverheadPct);
    const cellsCm3 = cells * cell.cm3;
    const neededCm3 = cellsCm3 * overhead;
    const [w, h, d] = (bodyMm || []).map((v) => num(v));
    const bodyCm3 = (w * h * d) / 1000;
    const fill = bodyCm3 > 0 ? neededCm3 / bodyCm3 : Infinity;
    const panelAreaCm2 =
      pct(panelEffPct) > 0 ? (num(panelW) / (SUN_W_PER_M2 * pct(panelEffPct))) * 10000 : 0;
    const folds = Math.max(1, Math.round(num(panelFolds, 1)));
    return {
      cell,
      cellWh,
      cells,
      cellsCm3,
      neededCm3,
      bodyCm3,
      fill,
      fit: fill <= 0.8 ? 'fits' : fill <= 1 ? 'tight' : 'too small',
      massG: cells * cell.grams * overhead,
      panelAreaCm2,
      panelFolds: folds,
      panelSideCm: Math.sqrt(panelAreaCm2 / folds),
      airlineOk: num(batteryWh) <= 100,
    };
  }

  /** Runs every calculator from one inputs object (project.calc). */
  function runAll(c, bodyMm) {
    const s = solar(c);
    const b = battery(c);
    const wk = walking(c);
    const harvestW = s.usableW + wk.elecW;
    const recharge = {
      solar: rechargeHours(b.wh, s.usableW, c.chargeEffPct),
      walking: rechargeHours(b.wh, wk.elecW, c.chargeEffPct),
      both: rechargeHours(b.wh, harvestW, c.chargeEffPct),
      wall: rechargeHours(b.wh, c.wallW, c.chargeEffPct),
    };
    const z = sizing({ ...c, batteryWh: b.wh, bodyMm });
    const harvestWhPerDay = s.whPerDay + wk.whPerDay;
    const useWhPerDay = num(c.dailyUseWh);
    return {
      solar: s,
      battery: b,
      walking: wk,
      recharge,
      sizing: z,
      budget: {
        harvestWhPerDay,
        useWhPerDay,
        selfChargedPct: useWhPerDay > 0 ? (harvestWhPerDay / useWhPerDay) * 100 : 0,
        walkingSharePct: harvestWhPerDay > 0 ? (wk.whPerDay / harvestWhPerDay) * 100 : 0,
      },
    };
  }

  return { CELLS, G, solar, battery, rechargeHours, walking, sizing, runAll };
});
