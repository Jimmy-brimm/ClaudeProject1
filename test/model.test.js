const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../public/js/model.js');

test('example image prompt matches the style that worked', () => {
  const prompt = Model.imagePrompt(Model.examplePowerBank());
  assert.equal(
    prompt,
    'Single clean product render: self-charging power bank only, no backpack. ' +
      'Slim rounded dark grey unit in cutaway showing battery cells, the cable reel, and the spring and copper coil generator, ' +
      'with the foldable solar panel hovering beside it, matching magnet rings on the panel and the pack, ' +
      'a cable linking the two, a USB port on the bottom edge. White background, soft studio lighting, thin callout labels.',
  );
});

test('normalizeProject drops bad links and fills defaults', () => {
  const p = Model.normalizeProject({
    name: '  Kettle  ',
    modules: [
      { name: 'Base', links: [{ to: 'Lid' }, { to: 'nowhere' }, { to: 'base' }] },
      { name: 'Lid', placement: 'outside' },
      { name: 'Lid' },
    ],
    calc: { panelW: 'abc', sunHours: 6 },
    shape: { body: 'pyramid', color: 'red', parts: [{ shape: 'cone', size: [1, -2] }] },
  });
  assert.equal(p.name, 'Kettle');
  assert.deepEqual(p.modules.map((m) => m.id), ['base', 'lid', 'lid-2']);
  assert.deepEqual(p.modules[0].links, [{ to: 'lid', label: '' }]);
  assert.equal(p.modules[1].placement, 'outside');
  assert.equal(p.calc.panelW, Model.CALC_DEFAULTS.panelW);
  assert.equal(p.calc.sunHours, 6);
  assert.equal(p.shape.body, 'roundedBox');
  assert.equal(p.shape.color, '#5b6470');
  assert.equal(p.shape.parts[0].shape, 'box');
  assert.deepEqual(p.shape.parts[0].size, [1, 2, 10]);
});

test('normalizeProject survives junk input', () => {
  for (const junk of [null, 42, 'text', [], { modules: 'no' }]) {
    const p = Model.normalizeProject(junk);
    assert.equal(typeof p.name, 'string');
    assert.ok(Array.isArray(p.modules));
  }
});

test('sheet Markdown lists modules and questions', () => {
  const md = Model.sheetMarkdown(Model.examplePowerBank());
  assert.match(md, /^# Self-charging power bank/);
  assert.match(md, /- \*\*Walking generator\*\*/);
  assert.match(md, /## Open questions/);
  assert.match(md, /## Image prompt/);
});
