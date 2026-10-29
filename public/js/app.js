/*
 * Concept Bench: wires the form to the concept sheet, diagram, image prompt,
 * calculators and 3D preview. Projects are kept in this browser's storage.
 */
(function () {
  'use strict';

  const { Model, CalcLib, Diagram, Preview3D } = window;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const STORE_KEY = 'concept-bench:v1';

  // ---------- storage (per browser; the page works without it) ----------

  const storage = {
    read() {
      try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      } catch {
        return null;
      }
    },
    write(data) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
      } catch {
        /* storage blocked or full: keep working in memory */
      }
    },
  };

  let store = storage.read();
  if (!store || !store.projects || !Object.keys(store.projects).length) {
    const id = newId();
    store = { projects: { [id]: Model.examplePowerBank() }, order: [id], currentId: id, chats: {}, ui: {} };
  }
  store.chats = store.chats || {};
  store.ui = store.ui || {};
  store.order = (store.order || []).filter((id) => store.projects[id]);
  Object.keys(store.projects).forEach((id) => {
    store.projects[id] = Model.normalizeProject(store.projects[id]);
    if (!store.order.includes(id)) store.order.push(id);
  });
  if (!store.projects[store.currentId]) store.currentId = store.order[0];

  let project = store.projects[store.currentId];
  const undoStack = [];

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage.write(store), 300);
  }
  // Write straight away when the page is closed or hidden, so the last edit is kept.
  const saveNow = () => {
    clearTimeout(saveTimer);
    storage.write(store);
  };
  addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());

  // ---------- small helpers ----------

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }

  const fmt = {
    w(v) {
      if (!Number.isFinite(v)) return '—';
      if (v === 0) return '0 W';
      if (v < 1) return `${(v * 1000).toFixed(v < 0.01 ? 1 : 0)} mW`;
      return `${v.toFixed(v < 10 ? 1 : 0)} W`;
    },
    wh(v) {
      if (!Number.isFinite(v)) return '—';
      if (v < 1 && v > 0) return `${(v * 1000).toFixed(0)} mWh`;
      return `${v.toFixed(v < 10 ? 1 : 0)} Wh`;
    },
    h(v) {
      if (!Number.isFinite(v)) return 'never';
      if (v < 1) return `${Math.round(v * 60)} min`;
      if (v > 72) return `${Math.round(v).toLocaleString()} h (${Math.round(v / 24).toLocaleString()} days)`;
      return `${v.toFixed(1)} h`;
    },
    n(v, d = 1) {
      return Number.isFinite(v) ? (+v.toFixed(d)).toLocaleString() : '—';
    },
    pct(v) {
      if (!Number.isFinite(v)) return '—';
      return `${v < 1 && v > 0 ? v.toFixed(2) : Math.round(v)}%`;
    },
  };

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  // Copy inside the click handler; fall back to selecting the text.
  function copyText(text, okMsg, selectEl) {
    const fallback = () => {
      if (selectEl) {
        const r = document.createRange();
        r.selectNodeContents(selectEl);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        toast('Copy was blocked. The text is selected, so copy it by hand.');
      } else {
        openJsonDialog('Copy this', text, false);
      }
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback);
    } catch {
      fallback();
    }
  }

  // Two taps to confirm, since the page cannot show confirm() dialogs everywhere.
  function confirmTap(btn, label, action) {
    if (btn.dataset.armed) {
      action();
      return;
    }
    const original = btn.innerHTML;
    btn.dataset.armed = '1';
    btn.classList.add('confirm');
    btn.textContent = label;
    setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.armed;
      btn.classList.remove('confirm');
      btn.innerHTML = original;
    }, 3000);
  }

  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { bg: v('--surface'), surface: v('--surface'), ink: v('--ink'), muted: v('--muted'), copper: v('--copper'), line: v('--line') };
  }

  // ---------- tabs ----------

  function setupTabs(tablist, key, onShow) {
    const tabs = $$('[role="tab"]', tablist);
    const show = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
      store.ui[key] = tab.id;
      save();
      onShow && onShow(tab.id);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => show(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) show(tabs[(i + d + tabs.length) % tabs.length], true);
      });
    });
    const saved = tabs.find((t) => t.id === store.ui[key]);
    show(saved || tabs[0]);
    return { show: (id) => show(tabs.find((t) => t.id === id)) };
  }

  // ---------- form ----------

  const form = $('#panel-describe');

  function fillForm() {
    $$('[data-bind]', form).forEach((el) => {
      const v = getPath(project, el.dataset.bind);
      el.value = el.hasAttribute('data-list') ? (v || []).join('\n') : v == null ? '' : v;
    });
    $('#f-shape-parts').value = JSON.stringify(project.shape.parts, null, 1);
    $('#parts-error').hidden = true;
    renderModules();
  }

  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind) {
      let v = el.value;
      if (el.hasAttribute('data-list')) v = v.split('\n').map((s) => s.trim()).filter(Boolean);
      if (el.hasAttribute('data-num')) v = Math.max(el.min ? +el.min : 0, +v || 0);
      setPath(project, el.dataset.bind, v);
      changed(el.dataset.bind.startsWith('shape') ? 'shape' : 'text');
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  $('#f-shape-parts').addEventListener('input', (e) => {
    const err = $('#parts-error');
    try {
      const parts = JSON.parse(e.target.value || '[]');
      if (!Array.isArray(parts)) throw new Error('Use a list: [ {...}, {...} ]');
      project.shape.parts = Model.normalizeProject({ shape: { ...project.shape, parts } }).shape.parts;
      err.hidden = true;
      changed('shape');
    } catch (ex) {
      err.textContent = `Not valid yet: ${ex.message}`;
      err.hidden = false;
    }
  });

  // Module cards

  const modulesEl = $('#modules');

  function renderModules() {
    modulesEl.innerHTML = project.modules
      .map((m, i) => {
        const others = project.modules.filter((o) => o.id !== m.id);
        const linkRows = m.links
          .map(
            (l, j) => `
          <div class="link-row">
            <select data-link="${j}" data-field="to" aria-label="${esc(m.name)} connects to">
              ${others.map((o) => `<option value="${o.id}"${o.id === l.to ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
            </select>
            <input type="text" data-link="${j}" data-field="label" value="${esc(l.label)}" placeholder="What flows, e.g. 15 W" aria-label="Connection label">
            <button type="button" class="icon-btn" data-action="remove-link" data-link="${j}" aria-label="Remove connection">×</button>
          </div>`,
          )
          .join('');
        return `
        <div class="module-card" data-index="${i}" data-placement="${m.placement}">
          <div class="module-head">
            <label class="visually-hidden" for="m-name-${m.id}">Module name</label>
            <input id="m-name-${m.id}" type="text" data-field="name" value="${esc(m.name)}">
            <button type="button" class="icon-btn" data-action="remove-module" aria-label="Remove ${esc(m.name)}">×</button>
          </div>
          <div class="seg" role="group" aria-label="Where it sits">
            <button type="button" data-action="placement" data-value="inside" aria-pressed="${m.placement === 'inside'}">Inside the main unit</button>
            <button type="button" data-action="placement" data-value="outside" aria-pressed="${m.placement === 'outside'}">Separate part</button>
          </div>
          <div class="mod-grid">
            <div class="field"><label for="m-role-${m.id}">What it does</label>
              <input id="m-role-${m.id}" type="text" data-field="role" value="${esc(m.role)}"></div>
            <div class="field"><label for="m-details-${m.id}">Details and numbers</label>
              <textarea id="m-details-${m.id}" rows="2" data-field="details">${esc(m.details)}</textarea></div>
            <div class="field"><label for="m-look-${m.id}">In the render</label>
              <input id="m-look-${m.id}" type="text" data-field="look" value="${esc(m.look)}" placeholder="How it looks in the image prompt"></div>
            <div class="field"><label>Connects to</label>
              <div class="links">${linkRows}
                ${others.length ? '<button type="button" class="link-add" data-action="add-link">+ Add connection</button>' : '<span class="hint">Add another module to connect it.</span>'}
              </div></div>
          </div>
        </div>`;
      })
      .join('');
  }

  const moduleOf = (el) => project.modules[+el.closest('.module-card').dataset.index];

  modulesEl.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.closest('.module-card')) return;
    const m = moduleOf(el);
    if (el.dataset.link !== undefined) {
      m.links[+el.dataset.link][el.dataset.field] = el.value;
    } else if (el.dataset.field) {
      m[el.dataset.field] = el.value;
      if (el.dataset.field === 'name') {
        $$(`option[value="${m.id}"]`, modulesEl).forEach((o) => (o.textContent = el.value || 'Unnamed module'));
      }
    }
    changed('text');
  });

  modulesEl.addEventListener('change', (e) => {
    if (e.target.dataset.link !== undefined) changed('text');
  });

  modulesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const m = moduleOf(btn);
    const act = btn.dataset.action;
    if (act === 'remove-module') {
      confirmTap(btn, 'Remove?', () => {
        snapshot();
        project.modules = project.modules.filter((x) => x !== m);
        project.modules.forEach((x) => (x.links = x.links.filter((l) => l.to !== m.id)));
        renderModules();
        changed('text');
      });
      return;
    }
    if (act === 'placement') m.placement = btn.dataset.value;
    if (act === 'add-link') {
      const taken = new Set(m.links.map((l) => l.to));
      const target = project.modules.find((o) => o.id !== m.id && !taken.has(o.id)) || project.modules.find((o) => o.id !== m.id);
      m.links.push({ to: target.id, label: '' });
    }
    if (act === 'remove-link') m.links.splice(+btn.dataset.link, 1);
    renderModules();
    changed('text');
  });

  $('#btn-add-module').addEventListener('click', () => {
    const ids = new Set(project.modules.map((m) => m.id));
    let id = 'module';
    for (let n = 2; ids.has(id); n++) id = `module-${n}`;
    project.modules.push({ id, name: 'New module', role: '', details: '', look: '', placement: 'inside', links: [] });
    renderModules();
    changed('text');
    const input = $(`#m-name-${id}`);
    input.focus();
    input.select();
  });

  // ---------- results ----------

  function results() {
    return CalcLib.runAll(project.calc, [project.shape.w, project.shape.h, project.shape.d]);
  }

  function keyNumbers(r) {
    return [
      ['Battery', fmt.wh(r.battery.wh)],
      ['Usable solar', fmt.w(r.solar.usableW)],
      ['Walking generator', fmt.w(r.walking.elecW)],
      ['Recharge from solar', fmt.h(r.recharge.solar)],
      ['Phone charges', `${fmt.n(r.battery.phoneCharges)} per full pack`],
      ['Harvest per day', `${fmt.wh(r.budget.harvestWhPerDay)} of ${fmt.wh(r.budget.useWhPerDay)} used`],
    ];
  }

  function sanityNotes(r) {
    const notes = [];
    const s = r.sizing;
    const fillPct = Math.round(s.fill * 100);
    notes.push([
      s.fit === 'fits' ? 'good' : s.fit === 'tight' ? 'warn' : 'bad',
      s.fit,
      `${s.cells} × ${s.cell.label} cells plus parts need about ${fmt.n(s.neededCm3, 0)} cm³, ${Number.isFinite(fillPct) ? fillPct + '%' : 'all'} of the ${fmt.n(s.bodyCm3, 0)} cm³ body.`,
    ]);
    if (r.solar.usableW > 0 && r.walking.elecW < r.solar.usableW * 0.1) {
      notes.push([
        'info',
        'bonus',
        `The walking generator gives ${fmt.w(r.walking.elecW)}, about ${fmt.pct((r.walking.elecW / r.solar.usableW) * 100)} of the solar panel. Treat it as a top-up, not a main source.`,
      ]);
    }
    if (r.budget.useWhPerDay > 0) {
      const p = r.budget.selfChargedPct;
      notes.push([
        p >= 100 ? 'good' : p >= 50 ? 'warn' : 'info',
        p >= 100 ? 'covered' : 'partial',
        `On a typical day the harvesters cover ${fmt.pct(p)} of the ${fmt.wh(r.budget.useWhPerDay)} you use.`,
      ]);
    }
    if (!s.airlineOk) notes.push(['warn', 'travel', `${fmt.wh(r.battery.wh)} is over the usual 100 Wh airline carry-on limit.`]);
    if (project.modules.length > 1) {
      const linked = new Set();
      project.modules.forEach((m) => m.links.forEach((l) => (linked.add(m.id), linked.add(l.to))));
      project.modules
        .filter((m) => !linked.has(m.id))
        .forEach((m) => notes.push(['warn', 'loose', `${m.name} is not connected to anything yet.`]));
    }
    return notes;
  }

  function renderSheet(r) {
    const p = project;
    const mods = p.modules
      .map((m) => {
        const to = m.links
          .map((l) => {
            const t = p.modules.find((x) => x.id === l.to);
            return t ? `${esc(t.name)}${l.label ? ` <span class="tag">${esc(l.label)}</span>` : ''}` : '';
          })
          .join('');
        return `<tr><td>${esc(m.name)}<span class="tag">${m.placement === 'outside' ? 'separate part' : 'inside'}</span></td><td>${esc(m.role)}</td><td>${esc(m.details)}</td><td>${to || '<span class="hint">—</span>'}</td></tr>`;
      })
      .join('');
    const list = (items) => `<ul class="checklist">${items.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`;

    $('#out-sheet').innerHTML = `
      <header class="sheet-head">
        <p class="eyebrow">Concept sheet</p>
        <h1>${esc(p.name)}</h1>
        ${p.summary ? `<p class="summary">${esc(p.summary)}</p>` : ''}
        <div class="sheet-meta"><span>${p.modules.length} module${p.modules.length === 1 ? '' : 's'}</span>${p.status ? `<span>${esc(p.status)}</span>` : ''}</div>
      </header>
      <div class="sheet-cols">
        <section><h2>Goal</h2><p>${esc(p.goal) || '<span class="hint">Say what it should do for the person using it.</span>'}</p></section>
        <section><h2>Approach</h2><p>${esc(p.approach) || '<span class="hint">Say how you will prove it works first.</span>'}</p></section>
      </div>
      <section><h2>Modules</h2>
        <div class="table-scroll"><table class="mod-table">
          <thead><tr><th>Module</th><th>What it does</th><th>Details</th><th>Connects to</th></tr></thead>
          <tbody>${mods}</tbody></table></div>
      </section>
      <section><h2>Key numbers</h2>
        <dl class="keynums">${keyNumbers(r).map(([k, v]) => `<div class="keynum"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <p class="hint">Rough estimates from the Numbers tab.</p>
      </section>
      <section><h2>Sanity checks</h2>
        <ul class="notes">${sanityNotes(r).map(([cls, tag, text]) => `<li><span class="pill ${cls}">${tag}</span><span>${esc(text)}</span></li>`).join('')}</ul>
      </section>
      <div class="sheet-cols">
        <section><h2>Open questions</h2>${p.openQuestions.length ? list(p.openQuestions) : '<p class="hint">None yet.</p>'}</section>
        ${p.laterExperiments.length ? `<section><h2>Later experiments</h2>${list(p.laterExperiments)}</section>` : ''}
      </div>
      <div class="sheet-actions"><button type="button" class="btn" id="btn-copy-md">Copy as Markdown</button></div>`;
    $('#btn-copy-md').addEventListener('click', () =>
      copyText(Model.sheetMarkdown(project, results(), keyNumbers(results())), 'Concept sheet copied as Markdown'),
    );
  }

  let lastSvg = '';
  function renderDiagram() {
    lastSvg = Diagram.render(project, colors());
    $('#diagram').innerHTML = lastSvg;
  }

  function renderPrompt() {
    const text = Model.imagePrompt(project);
    $('#prompt-text').textContent = text;
    $('#prompt-count').textContent = `${text.split(/\s+/).length} words`;
  }

  // Calculators: inputs are built once per project so typing keeps focus;
  // only the results are redrawn on each change.

  const CARDS = [
    {
      title: 'Solar power',
      inputs: [['panelW', 'Panel rating', 'W'], ['realFactorPct', 'Real-world factor', '%'], ['sunHours', 'Good sun per day', 'h']],
      out: (r, c) => [
        ['Usable power', fmt.w(r.solar.usableW), `${c.panelW} W × ${c.realFactorPct}%`],
        ['Energy per sunny day', fmt.wh(r.solar.whPerDay), `${fmt.w(r.solar.usableW)} × ${c.sunHours} h`],
      ],
    },
    {
      title: 'Battery and runtime',
      inputs: [['capacityMah', 'Capacity', 'mAh'], ['cellV', 'Cell voltage', 'V'], ['outputEffPct', 'Output efficiency', '%'], ['loadW', 'Device draw', 'W']],
      out: (r, c) => [
        ['Stored energy', fmt.wh(r.battery.wh), `${c.capacityMah} mAh × ${c.cellV} V ÷ 1000`],
        ['Energy you can use', fmt.wh(r.battery.deliverableWh), `${fmt.wh(r.battery.wh)} × ${c.outputEffPct}%`],
        ['Runtime at device draw', fmt.h(r.battery.runtimeH), `${fmt.wh(r.battery.deliverableWh)} ÷ ${c.loadW} W`],
      ],
    },
    {
      title: 'Phone charges',
      inputs: [['phoneMah', 'Phone battery', 'mAh'], ['phoneV', 'Phone voltage', 'V']],
      out: (r, c) => [
        ['Phone battery', fmt.wh(r.battery.phoneWh), `${c.phoneMah} mAh × ${c.phoneV} V ÷ 1000`],
        ['Charges per full pack', fmt.n(r.battery.phoneCharges), `${fmt.wh(r.battery.deliverableWh)} ÷ ${fmt.wh(r.battery.phoneWh)}`],
      ],
    },
    {
      title: 'Recharge time',
      inputs: [['chargeEffPct', 'Charging efficiency', '%'], ['wallW', 'Wall charger', 'W']],
      out: (r, c) => [
        ['From the panel', fmt.h(r.recharge.solar), `${fmt.wh(r.battery.wh)} ÷ (${fmt.w(r.solar.usableW)} × ${c.chargeEffPct}%)`],
        ['Sunny days to fill', fmt.n(r.recharge.solar / (c.sunHours || Infinity)), `panel hours ÷ ${c.sunHours} h of sun`],
        ['Panel plus walking', fmt.h(r.recharge.both), `${fmt.wh(r.battery.wh)} ÷ (${fmt.w(r.solar.usableW + r.walking.elecW)} × ${c.chargeEffPct}%)`],
        ['Walking only', fmt.h(r.recharge.walking), `${fmt.wh(r.battery.wh)} ÷ (${fmt.w(r.walking.elecW)} × ${c.chargeEffPct}%)`],
        ['From the wall', fmt.h(r.recharge.wall), `${fmt.wh(r.battery.wh)} ÷ (${c.wallW} W × ${c.chargeEffPct}%)`],
      ],
    },
    {
      title: 'Walking generator',
      inputs: [['massG', 'Moving mass', 'g'], ['travelMm', 'Travel per step', 'mm'], ['stepsPerS', 'Steps per second', '/s'], ['convEffPct', 'Magnet and coil efficiency', '%'], ['walkHoursPerDay', 'Walking per day', 'h']],
      out: (r, c) => [
        ['Mechanical power', fmt.w(r.walking.mechW), `${c.massG / 1000} kg × 9.81 × ${c.travelMm / 1000} m × ${c.stepsPerS}/s`],
        ['Electrical power', fmt.w(r.walking.elecW), `${fmt.w(r.walking.mechW)} × ${c.convEffPct}%`],
        ['Energy per day', fmt.wh(r.walking.whPerDay), `${fmt.w(r.walking.elecW)} × ${c.walkHoursPerDay} h`],
        ['Share of one phone charge', fmt.pct((r.walking.whPerDay / (r.battery.phoneWh || Infinity)) * 100), `per day ÷ ${fmt.wh(r.battery.phoneWh)}`],
      ],
    },
    {
      title: 'Sizing check',
      inputs: [
        ['cellType', 'Cell type', '', Object.entries(CalcLib.CELLS).map(([k, v]) => [k, v.label])],
        ['packOverheadPct', 'Space for case and parts', '%'],
        ['panelEffPct', 'Panel efficiency', '%'],
        ['panelFolds', 'Panel leaves', 'folds'],
      ],
      out: (r, c) => {
        const s = r.sizing;
        return [
          ['Cells needed', `${s.cells} × ${fmt.wh(s.cellWh)}`, `${fmt.wh(r.battery.wh)} ÷ ${fmt.wh(s.cellWh)}, rounded up`],
          ['Space needed', `${fmt.n(s.neededCm3, 0)} cm³`, `${fmt.n(s.cellsCm3, 0)} cm³ of cells × ${1 + c.packOverheadPct / 100}`],
          [
            'Body volume',
            `${fmt.n(s.bodyCm3, 0)} cm³ <span class="pill ${s.fit === 'fits' ? 'good' : s.fit === 'tight' ? 'warn' : 'bad'}">${s.fit}</span>`,
            `${project.shape.w} × ${project.shape.h} × ${project.shape.d} mm from 3D shape`,
          ],
          ['Pack weight', `${fmt.n(s.massG, 0)} g`, `${s.cells} × ${s.cell.grams} g × ${1 + c.packOverheadPct / 100}`],
          ['Panel area', `${fmt.n(s.panelAreaCm2, 0)} cm²`, `${c.panelW} W ÷ (1000 W/m² × ${c.panelEffPct}%)`],
          ['Each leaf', `${fmt.n(s.panelSideCm)} × ${fmt.n(s.panelSideCm)} cm`, `area ÷ ${s.panelFolds}, as a square`],
          ['Airline carry-on', s.airlineOk ? '<span class="pill good">under 100 Wh</span>' : '<span class="pill warn">over 100 Wh</span>', 'usual limit without airline approval'],
        ];
      },
    },
    {
      title: 'Daily energy budget',
      inputs: [['dailyUseWh', 'You use per day', 'Wh']],
      out: (r) => {
        const b = r.budget;
        const solarShare = 100 - b.walkingSharePct;
        return [
          ['Harvested per day', fmt.wh(b.harvestWhPerDay), 'solar per day + walking per day'],
          ['Self-charged share', fmt.pct(b.selfChargedPct), `${fmt.wh(b.harvestWhPerDay)} ÷ ${fmt.wh(b.useWhPerDay)}`],
          [
            'Where it comes from',
            '',
            `<div class="bar solar" title="Solar ${fmt.pct(solarShare)}"><span style="width:${Math.max(0, Math.min(100, solarShare)).toFixed(1)}%"></span></div>` +
              `solar ${fmt.pct(solarShare)} · walking ${fmt.pct(b.walkingSharePct)}`,
            true,
          ],
        ];
      },
    },
  ];

  function buildCalc() {
    $('#calc').innerHTML = CARDS.map(
      (card, i) => `
      <section class="calc-card" data-card="${i}">
        <h3>${card.title}</h3>
        <div class="calc-inputs">
          ${card.inputs
            .map(([key, label, unit, options]) => {
              const id = `c-${key}`;
              const val = project.calc[key];
              const control = options
                ? `<select id="${id}" data-calc="${key}">${options.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('')}</select>`
                : `<input id="${id}" type="number" min="0" step="any" inputmode="decimal" data-calc="${key}" value="${val}">`;
              return `<div class="field"><label for="${id}">${label}${unit ? ` <span class="unit">${unit}</span>` : ''}</label>${control}</div>`;
            })
            .join('')}
        </div>
        <div class="calc-out"></div>
      </section>`,
    ).join('');
  }

  function renderCalcOutputs(r) {
    $$('.calc-card', $('#calc')).forEach((el) => {
      const card = CARDS[+el.dataset.card];
      $('.calc-out', el).innerHTML = card
        .out(r, project.calc)
        .map(
          ([label, value, formula, rawFormula]) => `
          <div class="result">
            <div class="result-line"><span class="result-label">${label}</span>${value ? `<span class="result-value">${value}</span>` : ''}</div>
            <div class="formula">${rawFormula ? formula : esc(formula)}</div>
          </div>`,
        )
        .join('');
    });
  }

  $('#calc').addEventListener('input', (e) => {
    const key = e.target.dataset.calc;
    if (!key) return;
    project.calc[key] = e.target.tagName === 'SELECT' ? e.target.value : Math.max(0, parseFloat(e.target.value) || 0);
    changed('calc');
  });

  // 3D preview is created the first time its tab is shown (it needs a size).
  let viewer = null;
  function render3d() {
    if (!viewer) return;
    viewer.update(project.shape);
  }
  function ensureViewer() {
    if (viewer) {
      viewer.resize && viewer.resize();
      return;
    }
    viewer = Preview3D.create($('#viewer'));
    viewer.setEdgeColor && viewer.setEdgeColor(colors().ink);
    render3d();
    const spinBtn = $('#btn-spin');
    const syncSpin = () => {
      spinBtn.textContent = viewer.spinning ? 'Pause spin' : 'Spin';
      spinBtn.setAttribute('aria-pressed', String(!!viewer.spinning));
    };
    spinBtn.onclick = () => {
      viewer.setSpin(!viewer.spinning);
      syncSpin();
    };
    syncSpin();
  }

  // ---------- change handling ----------

  let renderTimer = 0;
  const pending = new Set();
  function changed(kind) {
    pending.add(kind);
    save();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(flush, 90);
  }
  function flush() {
    const r = results();
    renderSheet(r);
    renderDiagram();
    renderPrompt();
    renderCalcOutputs(r);
    if (pending.has('shape') || pending.has('all')) render3d();
    if (pending.has('text') || pending.has('all')) refreshProjectSelect();
    pending.clear();
  }

  function renderEverything() {
    fillForm();
    buildCalc();
    pending.add('all');
    flush();
    window.Chat && window.Chat.projectChanged();
  }

  // ---------- projects, undo ----------

  function refreshProjectSelect() {
    $('#project-select').innerHTML = store.order
      .map((id) => `<option value="${id}"${id === store.currentId ? ' selected' : ''}>${esc(store.projects[id].name)}</option>`)
      .join('');
    $('#btn-undo').disabled = !undoStack.length;
  }

  function snapshot() {
    undoStack.push({ id: store.currentId, json: JSON.stringify(project) });
    if (undoStack.length > 30) undoStack.shift();
    $('#btn-undo').disabled = false;
  }

  function switchTo(id) {
    store.currentId = id;
    project = store.projects[id];
    save();
    renderEverything();
  }

  function addProject(p, msg) {
    const id = newId();
    store.projects[id] = Model.normalizeProject(p);
    store.order.push(id);
    switchTo(id);
    if (msg) toast(msg);
  }

  $('#project-select').addEventListener('change', (e) => switchTo(e.target.value));
  $('#btn-new').addEventListener('click', () => addProject(Model.blankProject(), 'New project started'));
  $('#btn-example').addEventListener('click', (e) => {
    e.target.closest('details').open = false;
    addProject(Model.examplePowerBank(), 'Power bank example loaded as a new project');
  });
  $('#btn-undo').addEventListener('click', () => {
    const last = undoStack.pop();
    if (!last || !store.projects[last.id]) return refreshProjectSelect();
    store.projects[last.id] = Model.normalizeProject(JSON.parse(last.json));
    switchTo(last.id);
    toast('Undone');
  });
  $('#btn-delete').addEventListener('click', (e) => {
    confirmTap(e.target, 'Tap again to delete', () => {
      e.target.closest('details').open = false;
      const id = store.currentId;
      delete store.projects[id];
      delete store.chats[id];
      store.order = store.order.filter((x) => x !== id);
      if (!store.order.length) {
        const nid = newId();
        store.projects[nid] = Model.blankProject();
        store.order.push(nid);
      }
      switchTo(store.order[0]);
      toast('Project deleted');
    });
  });

  // JSON copy / paste

  const dialog = $('#json-dialog');
  function openJsonDialog(title, text, canApply) {
    $('#json-title').textContent = title;
    $('#json-text').value = text;
    $('#json-error').hidden = true;
    $('#json-apply').hidden = !canApply;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    if (!canApply) $('#json-text').select();
  }
  const closeDialog = () => (dialog.close ? dialog.close() : dialog.removeAttribute('open'));
  $('#json-close').addEventListener('click', closeDialog);
  $('#btn-export').addEventListener('click', (e) => {
    e.target.closest('details').open = false;
    copyText(JSON.stringify(project, null, 2), 'Project JSON copied');
  });
  $('#btn-import').addEventListener('click', (e) => {
    e.target.closest('details').open = false;
    openJsonDialog('Paste project JSON', '', true);
  });
  $('#json-apply').addEventListener('click', () => {
    try {
      const data = JSON.parse($('#json-text').value);
      closeDialog();
      addProject(data, 'Project loaded');
    } catch (ex) {
      $('#json-error').textContent = `That is not valid JSON: ${ex.message}`;
      $('#json-error').hidden = false;
    }
  });

  $('#btn-copy-prompt').addEventListener('click', () => copyText(Model.imagePrompt(project), 'Image prompt copied', $('#prompt-text')));
  $('#btn-copy-svg').addEventListener('click', () => copyText(lastSvg, 'Diagram SVG copied'));

  // Close the More menu when clicking elsewhere.
  document.addEventListener('click', (e) => {
    const menu = $('.menu');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  // Redraw colour-dependent pieces when the theme flips.
  const reTheme = () => {
    renderDiagram();
    viewer && viewer.setEdgeColor && viewer.setEdgeColor(colors().ink);
  };
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme);
  new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- API for the chat ----------

  window.App = {
    get project() {
      return project;
    },
    get projectId() {
      return store.currentId;
    },
    chatHistory(id) {
      return (store.chats[id] = store.chats[id] || []);
    },
    saveChat() {
      save();
    },
    /** Replace the current project with a version from the chat. Returns the list of changed areas. */
    applyFromChat(next) {
      const clean = Model.normalizeProject(next);
      const areas = [];
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(clean.modules, project.modules)) areas.push('modules');
      if (!same(clean.calc, project.calc)) areas.push('numbers');
      if (!same(clean.shape, project.shape)) areas.push('3D shape');
      if (!same(clean.image, project.image)) areas.push('image prompt');
      if (['name', 'summary', 'goal', 'approach', 'status', 'openQuestions', 'laterExperiments'].some((k) => !same(clean[k], project[k])))
        areas.push('sheet text');
      if (!areas.length) return areas;
      snapshot();
      store.projects[store.currentId] = clean;
      project = clean;
      save();
      renderEverything();
      return areas;
    },
    undo() {
      $('#btn-undo').click();
    },
    toast,
  };

  // ---------- start ----------

  window.Chat && window.Chat.init();
  setupTabs($('.pane-input .tabs'), 'inputTab', (id) => id === 'tab-chat' && window.Chat && window.Chat.shown());
  setupTabs($('.pane-output .tabs'), 'outputTab', (id) => id === 'tab-3d' && ensureViewer());
  renderEverything();
})();
