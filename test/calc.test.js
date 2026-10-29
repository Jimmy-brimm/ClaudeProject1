const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../public/js/calc.js');
const Model = require('../public/js/model.js');

const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

test('solar: panel watts × real-world factor', () => {
  const r = Calc.solar({ panelW: 20, realFactorPct: 70, sunHours: 4 });
  close(r.usableW, 14);
  close(r.whPerDay, 56);
});

test('battery: 20,000 mAh at 3.7 V is about 70 Wh', () => {
  const r = Calc.battery({ capacityMah: 20000, cellV: 3.7, outputEffPct: 85, loadW: 10, phoneMah: 4500, phoneV: 3.85 });
  close(r.wh, 74);
  close(r.deliverableWh, 62.9);
  close(r.runtimeH, 6.29);
  close(r.phoneCharges, 62.9 / 17.325);
});

test('recharge: Wh ÷ charging W, with zero watts meaning never', () => {
  close(Calc.rechargeHours(74, 14, 100), 74 / 14);
  close(Calc.rechargeHours(74, 14, 90), 74 / 12.6);
  assert.equal(Calc.rechargeHours(74, 0, 90), Infinity);
});

test('walking generator gives a fraction of a watt with the example inputs', () => {
  const r = Calc.walking({ massG: 200, travelMm: 30, stepsPerS: 2, convEffPct: 40, walkHoursPerDay: 1 });
  close(r.mechW, 0.2 * 9.81 * 0.03 * 2);
  close(r.elecW, 0.2 * 9.81 * 0.03 * 2 * 0.4);
  assert.ok(r.elecW > 0 && r.elecW < 1);
});

test('sizing: example pack fits its body and is under the airline limit', () => {
  const r = Calc.sizing({
    batteryWh: 74,
    cellType: '21700',
    packOverheadPct: 60,
    bodyMm: [75, 150, 28],
    panelW: 20,
    panelEffPct: 22,
    panelFolds: 4,
  });
  assert.equal(r.cells, 5);
  close(r.bodyCm3, 315);
  assert.equal(r.fit, 'fits');
  assert.ok(r.airlineOk);
  close(r.panelAreaCm2, (20 / 220) * 10000);
});

test('runAll works on the example project', () => {
  const p = Model.examplePowerBank();
  const r = Calc.runAll(p.calc, [p.shape.w, p.shape.h, p.shape.d]);
  assert.ok(r.recharge.solar > 5 && r.recharge.solar < 7);
  assert.ok(r.budget.walkingSharePct < 5);
});
