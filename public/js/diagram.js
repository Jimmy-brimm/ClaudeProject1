/*
 * SVG block diagram of how the modules connect. The most-connected module
 * sits in the middle and the rest are spaced around it. Colors are written
 * as attributes so a downloaded SVG looks the same as the one on screen.
 */
(function (root) {
  'use strict';

  const BOX_W = 184;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function wrap(text, maxChars, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxChars && line) {
        lines.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
  }

  // Point where the segment from the box centre toward (tx, ty) leaves the box.
  function exitPoint(n, tx, ty, pad = 4) {
    const dx = tx - n.x;
    const dy = ty - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    const hw = n.w / 2 + pad;
    const hh = n.h / 2 + pad;
    const s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return { x: n.x + dx * s, y: n.y + dy * s };
  }

  // Order the outer ring so modules linked to each other sit side by side.
  // Tries every order for small rings (up to 7 modules) and keeps the first best one.
  function ringOrder(list) {
    if (list.length < 4 || list.length > 7) return list;
    const ids = list.map((m) => m.id);
    const pairs = [];
    list.forEach((m) => m.links.forEach((l) => ids.includes(l.to) && pairs.push([m.id, l.to])));
    if (!pairs.length) return list;
    const n = list.length;
    let best = list;
    let bestCost = Infinity;
    const permute = (rest, chosen) => {
      if (!rest.length) {
        const pos = new Map(chosen.map((m, i) => [m.id, i]));
        const cost = pairs.reduce((sum, [a, b]) => {
          const d = Math.abs(pos.get(a) - pos.get(b));
          return sum + Math.min(d, n - d);
        }, 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = chosen;
        }
        return;
      }
      rest.forEach((m, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...chosen, m]));
    };
    permute(list.slice(1), [list[0]]); // first module stays at the top
    return best;
  }

  function render(project, colors) {
    const mods = project.modules;
    if (!mods.length) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 120" role="img" aria-label="No modules yet"><text x="300" y="64" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${colors.muted}">Add a module to see the diagram.</text></svg>`;
    }

    const degree = new Map(mods.map((m) => [m.id, 0]));
    mods.forEach((m) =>
      m.links.forEach((l) => {
        degree.set(m.id, degree.get(m.id) + 1);
        degree.set(l.to, (degree.get(l.to) || 0) + 1);
      }),
    );
    const hub = mods.reduce((best, m) => (degree.get(m.id) > degree.get(best.id) ? m : best), mods[0]);
    const others = ringOrder(mods.filter((m) => m !== hub));

    const nodes = new Map();
    const place = (m, x, y) => {
      const name = wrap(m.name, 20, 2);
      const role = wrap(m.role, 30, 3);
      const h = 18 + name.length * 18 + (role.length ? 6 + role.length * 15 : 0) + 10;
      nodes.set(m.id, { m, x, y, w: BOX_W, h, name, role });
    };

    const cx = 0;
    const cy = 0;
    place(hub, cx, cy);
    const rx = others.length <= 2 ? 300 : 310;
    const ry = others.length <= 2 ? 0 : 190;
    others.forEach((m, i) => {
      const a = others.length === 1 ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / others.length + (others.length === 2 ? Math.PI / 2 : 0);
      place(m, cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    });
    const margin = 36;
    const legendH = 34;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin + legendH;

    const edges = [];
    const labels = [];
    mods.forEach((m) =>
      m.links.forEach((l) => {
        const a = nodes.get(m.id);
        const b = nodes.get(l.to);
        if (!a || !b) return;
        const viaHub = a.m === hub || b.m === hub;
        let d, lx, ly;
        if (viaHub) {
          const p1 = exitPoint(a, b.x, b.y);
          const p2 = exitPoint(b, a.x, a.y, 9);
          d = `M${p1.x.toFixed(1)},${p1.y.toFixed(1)} L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
          lx = (p1.x + p2.x) / 2;
          ly = (p1.y + p2.y) / 2;
        } else {
          // Bow the curve sideways, away from the hub, far enough that its
          // middle clears the hub box. A quadratic's apex sits halfway to the control point.
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const sx = b.x - a.x;
          const sy = b.y - a.y;
          const slen = Math.hypot(sx, sy) || 1;
          let px = -sy / slen;
          let py = sx / slen;
          if (px * (mx - cx) + py * (my - cy) < 0) {
            px = -px;
            py = -py;
          }
          const along = px * (mx - cx) + py * (my - cy); // how far the midpoint already is from the hub
          const hubNode = nodes.get(hub.id);
          const clear = Math.abs(px) * (hubNode.w / 2) + Math.abs(py) * (hubNode.h / 2) + 46;
          const bow = Math.max(70, 2 * (clear - along));
          const qx = mx + px * bow;
          const qy = my + py * bow;
          const p1 = exitPoint(a, qx, qy);
          const p2 = exitPoint(b, qx, qy, 9);
          d = `M${p1.x.toFixed(1)},${p1.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
          lx = 0.25 * p1.x + 0.5 * qx + 0.25 * p2.x;
          ly = 0.25 * p1.y + 0.5 * qy + 0.25 * p2.y;
          minX = Math.min(minX, qx - margin);
          maxX = Math.max(maxX, qx + margin);
          minY = Math.min(minY, qy - margin);
          maxY = Math.max(maxY, qy + margin);
        }
        edges.push(`<path d="${d}" fill="none" stroke="${colors.copper}" stroke-width="2" marker-end="url(#cd-arrow)"/>`);
        if (l.label) {
          const tw = Math.min(160, l.label.length * 6.6 + 14);
          labels.push(
            `<g><rect x="${(lx - tw / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${tw.toFixed(1)}" height="21" rx="10" fill="${colors.surface}" stroke="${colors.copper}" stroke-width="1"/>` +
              `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-family="IBM Plex Mono, ui-monospace, monospace" fill="${colors.ink}">${esc(l.label)}</text></g>`,
          );
        }
      }),
    );

    const boxes = [];
    nodes.forEach((n) => {
      const x = n.x - n.w / 2;
      const y = n.y - n.h / 2;
      const isHub = n.m === hub;
      const outside = n.m.placement === 'outside';
      let ty = y + 26;
      let t = `<text x="${n.x.toFixed(1)}" text-anchor="middle" font-family="IBM Plex Sans, system-ui, sans-serif">`;
      n.name.forEach((line, i) => {
        t += `<tspan x="${n.x.toFixed(1)}" y="${(ty + i * 18).toFixed(1)}" font-size="15" font-weight="600" fill="${colors.ink}">${esc(line)}</tspan>`;
      });
      ty += n.name.length * 18 + 4;
      n.role.forEach((line, i) => {
        t += `<tspan x="${n.x.toFixed(1)}" y="${(ty + i * 15).toFixed(1)}" font-size="12" fill="${colors.muted}">${esc(line)}</tspan>`;
      });
      t += '</text>';
      boxes.push(
        `<g><title>${esc(n.m.name)}${n.m.details ? ': ' + esc(n.m.details) : ''}</title>` +
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${n.w}" height="${n.h}" rx="8" fill="${colors.surface}" stroke="${isHub ? colors.copper : colors.ink}" stroke-width="${isHub ? 2.5 : 1.4}"${outside ? ' stroke-dasharray="6 4"' : ''}/>` +
          t +
          '</g>',
      );
    });

    // Leave room for the legend even when there is only one box.
    if (maxX - minX < 500) {
      const extra = (500 - (maxX - minX)) / 2;
      minX -= extra;
      maxX += extra;
    }
    const vbW = maxX - minX;
    const vbH = maxY - minY;
    const ly = maxY - 22;
    const lx = minX + margin;
    const legend =
      `<g font-family="IBM Plex Sans, system-ui, sans-serif" font-size="12" fill="${colors.muted}">` +
      `<rect x="${lx}" y="${ly - 10}" width="22" height="14" rx="3" fill="none" stroke="${colors.ink}" stroke-width="1.4"/>` +
      `<text x="${lx + 30}" y="${ly + 1}">inside the main unit</text>` +
      `<rect x="${lx + 170}" y="${ly - 10}" width="22" height="14" rx="3" fill="none" stroke="${colors.ink}" stroke-width="1.4" stroke-dasharray="5 3"/>` +
      `<text x="${lx + 200}" y="${ly + 1}">separate part</text>` +
      `<line x1="${lx + 320}" y1="${ly - 3}" x2="${lx + 348}" y2="${ly - 3}" stroke="${colors.copper}" stroke-width="2" marker-end="url(#cd-arrow)"/>` +
      `<text x="${lx + 358}" y="${ly + 1}">feeds or holds</text></g>`;

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${vbW.toFixed(0)} ${vbH.toFixed(0)}" role="img" aria-label="Diagram of how the modules of ${esc(project.name)} connect">` +
      `<defs><marker id="cd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${colors.copper}"/></marker></defs>` +
      `<rect x="${minX.toFixed(0)}" y="${minY.toFixed(0)}" width="${vbW.toFixed(0)}" height="${vbH.toFixed(0)}" fill="${colors.bg}"/>` +
      edges.join('') +
      boxes.join('') +
      labels.join('') +
      legend +
      '</svg>'
    );
  }

  root.Diagram = { render };
})(typeof self !== 'undefined' ? self : this);
