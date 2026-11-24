// Gráficos em SVG: linha (evolução) e barras agrupadas (mês a mês). Cada um tem legenda, dica ao passar o mouse e visão em tabela.
(function () {
  'use strict';
  const { esc, fmt: F } = App;
  const NS = 'http://www.w3.org/2000/svg';
  const observers = [];
  const short = v => { const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' mi'; if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + ' mil'; return String(Math.round(v)); };
  function niceMax(v) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  const tip = () => document.getElementById('tip');
  function showTip(x, y, title, rows) {
    const t = tip(); t.innerHTML = `<b>${esc(title)}</b>` + rows.map(r => `<span style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span>${r.color ? `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${r.color};margin-right:6px"></i>` : ''}${esc(r.name)}</span><span>${esc(r.value)}</span></span>`).join('');
    t.hidden = false; const w = t.offsetWidth, h = t.offsetHeight;
    let left = x + 14, top = y - h - 10; if (left + w > window.innerWidth - 8) left = x - w - 14; if (top < 8) top = y + 16;
    t.style.left = Math.max(8, left) + 'px'; t.style.top = top + 'px';
  }
  const hideTip = () => { tip().hidden = true; };

  // casca comum: gráfico + legenda + botão de tabela
  function shell(el, o) {
    el.innerHTML = `<div class="chart-wrap"><div class="chart-tools"><button class="linkish" type="button" data-act="chart-table">Ver como tabela</button></div>
      <div class="chart" role="img" aria-label="${esc(o.label)}"></div>
      ${o.legend && o.legend.length > 1 ? `<div class="legend">${o.legend.map(l => `<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join('')}</div>` : ''}
      <div class="chart-table" hidden><table class="data-table"><thead><tr>${o.table.head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${o.table.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    return el.querySelector('.chart');
  }
  App.actions['chart-table'] = (d, btn) => {
    const w = btn.closest('.chart-wrap'), t = w.querySelector('.chart-table'), c = w.querySelector('.chart'), lg = w.querySelector('.legend');
    const show = t.hidden; t.hidden = !show; c.hidden = show; if (lg) lg.hidden = show; btn.textContent = show ? 'Ver como gráfico' : 'Ver como tabela';
  };
  function mount(host, draw) {
    draw(); let last = host.clientWidth, timer;
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (host.clientWidth !== last && host.isConnected) { last = host.clientWidth; draw(); } }, 120); });
    ro.observe(host); observers.push(ro);
  }
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  // ---------- linha ----------
  // series: [{ name, color, points: [{ x: 'AAAA-MM-DD', y: número }] }]
  function line(el, o) {
    const S = o.series.filter(s => s.points.length); const fmtY = o.fmt || F.brl0;
    const xs = [...new Set(S.flatMap(s => s.points.map(p => p.x)))].sort();
    const table = { head: [o.xLabel || 'Dia', ...S.map(s => s.name)], rows: xs.map(x => [F.date(x), ...S.map(s => { const p = s.points.find(p => p.x === x); return p ? fmtY(p.y) : '—'; })]) };
    const host = shell(el, { label: o.label, legend: S.map(s => ({ name: s.name, color: s.color })), table });
    mount(host, () => {
      host.querySelector('svg')?.remove();
      const W = Math.max(260, host.clientWidth), H = o.height || 230, pl = 50, pr = 14, pt = 12, pb = 26;
      const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, host);
      const max = niceMax(Math.max(...S.flatMap(s => s.points.map(p => p.y)), 1) * 1.05), iw = W - pl - pr, ih = H - pt - pb;
      const X = i => pl + (xs.length === 1 ? iw / 2 : (i / (xs.length - 1)) * iw), Y = v => pt + ih - (v / max) * ih;
      for (let i = 0; i <= 4; i++) { const v = max * i / 4, y = Y(v); mk('line', { class: 'gl', x1: pl, x2: W - pr, y1: y, y2: y }, svg); const t = mk('text', { class: 'ax', x: pl - 8, y: y + 4, 'text-anchor': 'end' }, svg); t.textContent = (o.money === false ? short(v) : 'R$ ' + short(v)); }
      const ticks = xs.length <= 5 ? xs.map((x, i) => i) : [0, 1, 2, 3, 4].map(k => Math.round(k * (xs.length - 1) / 4));
      ticks.forEach(i => { const t = mk('text', { class: 'ax', x: X(i), y: H - 6, 'text-anchor': i === 0 && xs.length > 1 ? 'start' : i === xs.length - 1 && xs.length > 1 ? 'end' : 'middle' }, svg); t.textContent = F.short(xs[i]); });
      S.forEach(s => {
        const pts = s.points.map(p => [X(xs.indexOf(p.x)), Y(p.y)]);
        if (pts.length > 1) mk('path', { class: 'ln', d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), stroke: s.color }, svg);
        const last = pts[pts.length - 1]; mk('circle', { cx: last[0], cy: last[1], r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
      });
      const cross = mk('line', { y1: pt, y2: pt + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
      const marks = S.map(s => mk('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
      const hit = mk('rect', { x: pl, y: pt, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair;touch-action:pan-y' }, svg);
      const move = e => {
        const r = svg.getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const i = xs.length === 1 ? 0 : Math.max(0, Math.min(xs.length - 1, Math.round((cx - pl) / iw * (xs.length - 1))));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        const rows = [];
        S.forEach((s, k) => { const p = s.points.find(p => p.x === xs[i]); if (p) { marks[k].setAttribute('cx', X(i)); marks[k].setAttribute('cy', Y(p.y)); marks[k].setAttribute('visibility', 'visible'); rows.push({ name: s.name, value: fmtY(p.y), color: s.color }); } else marks[k].setAttribute('visibility', 'hidden'); });
        showTip((e.touches ? e.touches[0].clientX : e.clientX), (e.touches ? e.touches[0].clientY : e.clientY), F.date(xs[i]), rows);
      };
      const leave = () => { cross.setAttribute('visibility', 'hidden'); marks.forEach(m => m.setAttribute('visibility', 'hidden')); hideTip(); };
      hit.addEventListener('mousemove', move); hit.addEventListener('mouseleave', leave); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchend', leave);
    });
    if (xs.length < 2) { const n = document.createElement('p'); n.className = 'small muted'; n.style.margin = '4px 0 0'; n.textContent = o.shortNote || 'O histórico começa a ser montado hoje; a linha aparece quando houver mais de um dia.'; el.appendChild(n); }
  }

  // ---------- barras agrupadas ----------
  // groups: [{ label, values: [{ name, color, v }] }]
  function bars(el, o) {
    const G = o.groups, names = G[0] ? G[0].values.map(v => ({ name: v.name, color: v.color })) : []; const fmtY = o.fmt || F.brl0;
    const table = { head: [o.xLabel || 'Mês', ...names.map(n => n.name)], rows: G.map(g => [g.long || g.label, ...g.values.map(v => fmtY(v.v))]) };
    const host = shell(el, { label: o.label, legend: names, table });
    mount(host, () => {
      host.querySelector('svg')?.remove();
      const W = Math.max(260, host.clientWidth), H = o.height || 230, pl = 50, pr = 8, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
      const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, host);
      const max = niceMax(Math.max(...G.flatMap(g => g.values.map(v => v.v)), 1) * 1.05), Y = v => pt + ih - (v / max) * ih;
      for (let i = 0; i <= 4; i++) { const v = max * i / 4, y = Y(v); mk('line', { class: 'gl', x1: pl, x2: W - pr, y1: y, y2: y }, svg); const t = mk('text', { class: 'ax', x: pl - 8, y: y + 4, 'text-anchor': 'end' }, svg); t.textContent = 'R$ ' + short(v); }
      const gw = iw / G.length, n = names.length, bw = Math.min(26, (gw * .7 - (n - 1) * 2) / n);
      G.forEach((g, gi) => {
        const total = n * bw + (n - 1) * 2, x0 = pl + gi * gw + (gw - total) / 2;
        const t = mk('text', { class: 'ax', x: pl + gi * gw + gw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); t.textContent = g.label;
        g.values.forEach((v, vi) => {
          const x = x0 + vi * (bw + 2), h = Math.max(v.v > 0 ? 2 : 0, (v.v / max) * ih), y = pt + ih - h, r = Math.min(4, bw / 2, h);
          if (h > 0) mk('path', { d: `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${y + h}Z`, fill: v.color }, svg);
        });
        const hit = mk('rect', { x: pl + gi * gw, y: pt, width: gw, height: ih, fill: 'transparent' }, svg);
        const on = e => showTip(e.clientX, e.clientY, g.long || g.label, g.values.map(v => ({ name: v.name, value: fmtY(v.v), color: v.color })));
        hit.addEventListener('mousemove', on); hit.addEventListener('mouseleave', hideTip); hit.addEventListener('touchstart', e => on(e.touches[0]), { passive: true }); hit.addEventListener('touchend', hideTip);
      });
    });
  }

  // ---------- barras horizontais em HTML (rankings) ----------
  // rows: [{ label, value, text, color }]
  function hbars(el, rows, o = {}) {
    if (!rows.length) { el.innerHTML = `<p class="muted small">${esc(o.empty || 'Sem dados ainda.')}</p>`; return; }
    const max = Math.max(...rows.map(r => r.value), 1);
    el.innerHTML = rows.map(r => `<div class="hbar"><span title="${esc(r.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.label)}</span><div class="track" role="img" aria-label="${esc(r.label)}: ${esc(r.text)}"><div class="fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color || 'var(--s1)'}"></div></div><b style="font-weight:600">${esc(r.text)}</b></div>`).join('');
  }

  window.Charts = { line, bars, hbars, dispose() { observers.splice(0).forEach(o => o.disconnect()); hideTip(); }, short };
})();
