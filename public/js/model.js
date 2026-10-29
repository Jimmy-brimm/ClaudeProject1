/*
 * The project data model: defaults, the power bank example, cleanup of
 * incoming data (from the form, an imported file or the chat), and the
 * text builders (image prompt, Markdown concept sheet).
 * Works in the browser (window.Model) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHAPES = ['roundedBox', 'box', 'cylinder', 'sphere', 'capsule'];
  const PART_SHAPES = ['box', 'roundedBox', 'cylinder', 'torus', 'sphere'];

  const CALC_DEFAULTS = {
    panelW: 20,
    realFactorPct: 70,
    sunHours: 4,
    capacityMah: 20000,
    cellV: 3.7,
    outputEffPct: 85,
    loadW: 10,
    phoneMah: 4500,
    phoneV: 3.85,
    chargeEffPct: 90,
    wallW: 18,
    massG: 200,
    travelMm: 30,
    stepsPerS: 2,
    convEffPct: 40,
    walkHoursPerDay: 1,
    dailyUseWh: 20,
    cellType: '21700',
    packOverheadPct: 60,
    panelEffPct: 22,
    panelFolds: 4,
  };

  const SHAPE_DEFAULTS = { body: 'roundedBox', w: 80, h: 140, d: 30, radius: 8, color: '#5b6470', parts: [] };

  const POWER_BANK = {
    name: 'Self-charging power bank',
    summary:
      'A normal battery pack that a detachable solar panel and a small walking generator keep topped up while you move.',
    goal:
      'A power bank that tops itself up as you move, then works like any normal power bank. A truly infinite one is impossible, so it combines harvesters feeding one battery.',
    approach:
      'Build a larger prototype that reaches about 15 watts, prove the physics, then shrink each module later.',
    status: 'Concept and design only. No hardware is being built yet.',
    modules: [
      {
        id: 'battery',
        name: 'Main battery pack',
        role: 'Stores the energy and charges your devices.',
        details: 'Lithium cells, charge controller, USB output. A 20,000 mAh pack is about 70 Wh.',
        look: 'battery cells',
        placement: 'inside',
        links: [],
      },
      {
        id: 'solar',
        name: 'Solar panel',
        role: 'Main harvester. Foldable and separate from the pack.',
        details: 'About 20 W rated, roughly 15 W in real sun.',
        look: 'the foldable solar panel hovering beside it',
        placement: 'outside',
        links: [{ to: 'cable', label: '~15 W DC' }],
      },
      {
        id: 'magnets',
        name: 'Magnetic hold',
        role: 'Clamps the panel flush to the pack, even through fabric.',
        details: 'Matching rings of small magnets on the panel and the pack.',
        look: 'matching magnet rings on the panel and the pack',
        placement: 'outside',
        links: [
          { to: 'solar', label: 'clamps' },
          { to: 'battery', label: 'clamps' },
        ],
      },
      {
        id: 'cable',
        name: 'Retractable cable',
        role: 'Carries panel power into the pack and acts as a safety leash.',
        details: 'Spring-loaded reel inside the pack.',
        look: 'the cable reel',
        placement: 'inside',
        links: [{ to: 'battery', label: 'charge input' }],
      },
      {
        id: 'walking',
        name: 'Walking generator',
        role: 'Adds a small top-up while you walk.',
        details:
          'Spring-mounted mass tuned to walking pace, about two steps per second, moves a magnet through a coil. Expect a fraction of a watt.',
        look: 'the spring and copper coil generator',
        placement: 'inside',
        links: [{ to: 'battery', label: '< 1 W trickle' }],
      },
    ],
    openQuestions: [
      'How much does the walking generator add in practice compared with the solar panel?',
      'How strong do the magnets need to be to hold the panel through a jacket or bag?',
      'Can the cable reel carry 15 W without heating up or losing much to resistance?',
      'Which charge controller can take the panel and the generator at the same time?',
    ],
    laterExperiments: [
      'Sloshing-liquid triboelectric generator',
      'Paddle wheel in sloshing water',
      'Cooling loop',
    ],
    image: {
      subject: 'self-charging power bank only, no backpack',
      body: 'Slim rounded dark grey unit',
      extras: 'a cable linking the two, a USB port on the bottom edge',
      style: 'White background, soft studio lighting, thin callout labels.',
    },
    calc: { ...CALC_DEFAULTS },
    shape: {
      body: 'roundedBox',
      w: 75,
      h: 150,
      d: 28,
      radius: 10,
      color: '#3b3f45',
      parts: [
        { name: 'USB port', shape: 'box', size: [14, 4, 7], position: [0, -75, 0], rotation: [0, 0, 0], color: '#111418' },
        { name: 'Magnet ring (pack)', shape: 'torus', size: [20, 2.5, 0], position: [0, 25, 14.5], rotation: [0, 0, 0], color: '#b9bec6' },
        { name: 'Solar panel', shape: 'box', size: [150, 150, 3], position: [130, 20, -25], rotation: [0, -12, 0], color: '#1f3566' },
        { name: 'Magnet ring (panel)', shape: 'torus', size: [20, 2.5, 0], position: [130, 20, -22.5], rotation: [0, -12, 0], color: '#b9bec6' },
        { name: 'Cable', shape: 'cylinder', size: [1.6, 30, 0], position: [52, -50, -12], rotation: [0, 0, 90], color: '#c46a2b' },
      ],
    },
  };

  function blankProject() {
    return normalizeProject({
      name: 'New invention',
      summary: '',
      goal: '',
      approach: '',
      modules: [
        { name: 'Main body', role: 'What holds everything together.', placement: 'inside', links: [] },
      ],
      openQuestions: [],
      laterExperiments: [],
      image: { subject: '', body: '', extras: '', style: 'White background, soft studio lighting, thin callout labels.' },
      calc: { ...CALC_DEFAULTS },
      shape: { ...SHAPE_DEFAULTS },
    });
  }

  function examplePowerBank() {
    return normalizeProject(JSON.parse(JSON.stringify(POWER_BANK)));
  }

  // ---------- cleanup ----------

  const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
  const finite = (v, fallback) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : fallback);
  const strList = (v) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
      .map((s) => str(s, 500).trim())
      .filter(Boolean)
      .slice(0, 40);
  const vec3 = (v, fallback = [0, 0, 0]) =>
    [0, 1, 2].map((i) => finite(Array.isArray(v) ? v[i] : undefined, fallback[i]));
  const color = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

  function slug(s) {
    return (
      str(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'module'
    );
  }

  /** Returns a clean copy of any project-like object. Unknown fields are dropped. */
  function normalizeProject(input) {
    const p = input && typeof input === 'object' ? input : {};
    const used = new Set();
    const rawModules = Array.isArray(p.modules) ? p.modules.slice(0, 16) : [];
    const modules = rawModules.map((m) => {
      m = m && typeof m === 'object' ? m : {};
      let id = slug(m.id || m.name);
      for (let n = 2; used.has(id); n++) id = `${slug(m.id || m.name)}-${n}`;
      used.add(id);
      return {
        id,
        name: str(m.name, 80).trim() || 'Unnamed module',
        role: str(m.role, 300),
        details: str(m.details, 1000),
        look: str(m.look, 300),
        placement: m.placement === 'outside' ? 'outside' : 'inside',
        links: Array.isArray(m.links) ? m.links : [],
      };
    });
    // Links are resolved after ids are known; they may name a module by id or name.
    const byKey = new Map();
    modules.forEach((m) => byKey.set(m.id, m.id));
    modules.forEach((m) => {
      const key = m.name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, m.id);
    });
    modules.forEach((m) => {
      const seen = new Set();
      m.links = m.links
        .map((l) => (typeof l === 'string' ? { to: l } : l || {}))
        .map((l) => ({ to: byKey.get(str(l.to)) || byKey.get(str(l.to).toLowerCase()), label: str(l.label, 40) }))
        .filter((l) => l.to && l.to !== m.id && !seen.has(l.to) && seen.add(l.to))
        .slice(0, 8);
    });

    const c = p.calc && typeof p.calc === 'object' ? p.calc : {};
    const calc = {};
    for (const [k, def] of Object.entries(CALC_DEFAULTS)) {
      calc[k] = typeof def === 'number' ? Math.max(0, finite(c[k], def)) : str(c[k]) || def;
    }

    const s = p.shape && typeof p.shape === 'object' ? p.shape : {};
    const dim = (v, def) => Math.min(5000, Math.max(1, finite(v, def)));
    const shape = {
      body: SHAPES.includes(s.body) ? s.body : SHAPE_DEFAULTS.body,
      w: dim(s.w, SHAPE_DEFAULTS.w),
      h: dim(s.h, SHAPE_DEFAULTS.h),
      d: dim(s.d, SHAPE_DEFAULTS.d),
      radius: Math.max(0, finite(s.radius, SHAPE_DEFAULTS.radius)),
      color: color(s.color, SHAPE_DEFAULTS.color),
      parts: (Array.isArray(s.parts) ? s.parts.slice(0, 24) : []).map((pt) => {
        pt = pt && typeof pt === 'object' ? pt : {};
        return {
          name: str(pt.name, 60),
          shape: PART_SHAPES.includes(pt.shape) ? pt.shape : 'box',
          size: vec3(pt.size, [10, 10, 10]).map((v) => Math.abs(v)),
          position: vec3(pt.position),
          rotation: vec3(pt.rotation),
          color: color(pt.color, '#8a929c'),
        };
      }),
    };

    const img = p.image && typeof p.image === 'object' ? p.image : {};
    return {
      name: str(p.name, 120).trim() || 'Untitled invention',
      summary: str(p.summary, 2000),
      goal: str(p.goal, 2000),
      approach: str(p.approach, 2000),
      status: str(p.status, 300),
      modules,
      openQuestions: strList(p.openQuestions),
      laterExperiments: strList(p.laterExperiments),
      image: {
        subject: str(img.subject, 300),
        body: str(img.body, 300),
        extras: str(img.extras, 500),
        style: str(img.style, 500),
      },
      calc,
      shape,
    };
  }

  // ---------- text builders ----------

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  /** One clean product render, plain background, for image tools like Gemini. */
  function imagePrompt(p) {
    const looks = (where) =>
      p.modules
        .filter((m) => m.placement === where)
        .map((m) => m.look.trim())
        .filter(Boolean);
    const inside = looks('inside');
    const outside = looks('outside');
    const subject = p.image.subject.trim() || p.name;
    const body = p.image.body.trim() || 'The main unit';

    let scene = body;
    if (inside.length) scene += ` in cutaway showing ${joinList(inside)}`;
    const rest = [...outside, p.image.extras.trim()].filter(Boolean);
    if (rest.length) scene += `, with ${rest.join(', ')}`;

    const style = p.image.style.trim() || 'Plain white background, soft studio lighting.';
    return `Single clean product render: ${subject}. ${scene}. ${style}`.replace(/\.\./g, '.');
  }

  /** The concept sheet as Markdown, for pasting into a doc. */
  function sheetMarkdown(p, results, fmt) {
    const lines = [`# ${p.name}`, ''];
    if (p.summary) lines.push(p.summary, '');
    if (p.status) lines.push(`_${p.status}_`, '');
    if (p.goal) lines.push('## Goal', '', p.goal, '');
    if (p.approach) lines.push('## Approach', '', p.approach, '');
    lines.push('## Modules', '');
    p.modules.forEach((m) => {
      lines.push(`- **${m.name}**${m.role ? ` — ${m.role}` : ''}${m.details ? ` ${m.details}` : ''}`);
    });
    lines.push('');
    if (results && fmt) {
      lines.push('## Key numbers (rough estimates)', '');
      fmt.forEach(([label, value]) => lines.push(`- ${label}: ${value}`));
      lines.push('');
    }
    if (p.openQuestions.length) {
      lines.push('## Open questions', '');
      p.openQuestions.forEach((q) => lines.push(`- ${q}`));
      lines.push('');
    }
    if (p.laterExperiments.length) {
      lines.push('## Later experiments', '');
      p.laterExperiments.forEach((q) => lines.push(`- ${q}`));
      lines.push('');
    }
    lines.push('## Image prompt', '', imagePrompt(p), '');
    return lines.join('\n');
  }

  return {
    CALC_DEFAULTS,
    SHAPES,
    PART_SHAPES,
    blankProject,
    examplePowerBank,
    normalizeProject,
    imagePrompt,
    sheetMarkdown,
    slug,
  };
});
