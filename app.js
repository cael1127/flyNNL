const EDGES = [
  { from: "Ir40a", to: "hPN", w: 6886, vfb: true },
  { from: "Ir68a", to: "hPN", w: 12000, vfb: true },
  { from: "hPN", to: "DNp44", w: 80, vfb: false },
  { from: "JO", to: "GF", w: 400, vfb: false },
  { from: "LPLC2", to: "GF", w: 5680, vfb: true },
  { from: "GF", to: "TTMn", w: 375, vfb: true },
  { from: "GF", to: "PSI", w: 200, vfb: false },
  { from: "ISN", to: "DNg27", w: 120, vfb: false },
  { from: "DNg27", to: "SpMN", w: 80, vfb: false },
  { from: "DNp44", to: "TTMn", w: 40, vfb: false },
];

const CELLS = [
  { id: "Ir40a", label: "Ir40a", sub: "dry hygrosensor", x: 338, y: 78, r: 11, cls: "sensory" },
  { id: "Ir68a", label: "Ir68a", sub: "wet hygrosensor", x: 372, y: 98, r: 11, cls: "sensory" },
  { id: "JO", label: "JO", sub: "Johnston organ", x: 318, y: 128, r: 12, cls: "sensory" },
  { id: "LPLC2", label: "LPLC2", sub: "looming", x: 168, y: 158, r: 14, cls: "sensory" },
  { id: "hPN", label: "hPN", sub: "hygro PN", x: 428, y: 148, r: 12, cls: "command" },
  { id: "DNp44", label: "DNp44", sub: "dry escape DN", x: 468, y: 248, r: 12, cls: "command" },
  { id: "GF", label: "DNp01 GF", sub: "jump command", x: 508, y: 214, r: 16, cls: "command" },
  { id: "glia", label: "glia", sub: "Hsp70 / K+", x: 572, y: 126, r: 13, cls: "glia" },
  { id: "ISN", label: "ISN", sub: "hemolymph", x: 408, y: 292, r: 11, cls: "sensory" },
  { id: "DNg27", label: "DNg27", sub: "spiracle gate", x: 452, y: 348, r: 12, cls: "command" },
  { id: "TTMn", label: "TTMn", sub: "jump motor", x: 508, y: 508, r: 15, cls: "motor" },
  { id: "PSI", label: "PSI", sub: "flight premotor", x: 372, y: 518, r: 12, cls: "motor" },
  { id: "SpMN", label: "SpMN", sub: "spiracle MN", x: 568, y: 552, r: 12, cls: "motor" },
];

const cellById = Object.fromEntries(CELLS.map((c) => [c.id, c]));

const AXON = {
  "Ir40a-hPN": [[338, 78], [380, 110], [428, 148]],
  "Ir68a-hPN": [[372, 98], [400, 122], [428, 148]],
  "hPN-DNp44": [[428, 148], [448, 198], [468, 248]],
  "JO-GF": [[318, 128], [380, 168], [460, 198], [508, 214]],
  "LPLC2-GF": [[168, 158], [260, 170], [380, 192], [508, 214]],
  "GF-TTMn": [[508, 214], [512, 300], [510, 400], [508, 508]],
  "GF-PSI": [[508, 214], [500, 320], [430, 420], [372, 518]],
  "ISN-DNg27": [[408, 292], [430, 320], [452, 348]],
  "DNg27-SpMN": [[452, 348], [500, 430], [540, 500], [568, 552]],
  "DNp44-TTMn": [[468, 248], [478, 360], [496, 450], [508, 508]],
};

const CLS_COLOR = {
  sensory: [110, 196, 212],
  command: [232, 179, 90],
  motor: [224, 122, 104],
  glia: [143, 182, 122],
};

const EPHYS_ROWS = ["Ir68a", "JO", "LPLC2", "GF", "TTMn", "SpMN"];

const ui = {
  fire: {},
  hz: {},
  drive: {},
  spikes: {},
  history: [],
  events: [],
  chem: {},
  nodesMeta: {},
  dead: false,
  excitability: 1,
  phase: "Normoxia",
  note: "",
  t: 0,
  selected: "GF",
  lastEvents: "",
  glow: {},
  bolts: [],
  seen: {},
  view: { scale: 1, ox: 0, oy: 0, dw: 900, dh: 700 },
  physio: null,
  tVis: 0,
  hasJpeg: false,
};

function rgb(c, a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function setBar(id, frac) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

function fmtTime(s) {
  if (s < 90) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(2)} h`;
}

function fmtAge(sec) {
  if (sec == null) return "atlas · not polled";
  if (sec < 60) return `atlas · ${Math.round(sec)}s ago`;
  return `atlas · ${Math.round(sec / 60)}m ago`;
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return { ctx: null, w: 0, h: 0 };
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function fitBrain(w, h) {
  const dw = 900;
  const dh = 700;
  const scale = Math.min(w / dw, h / dh);
  ui.view = { scale, ox: (w - dw * scale) / 2, oy: (h - dh * scale) / 2, dw, dh };
}

function toScreen(x, y) {
  return [ui.view.ox + x * ui.view.scale, ui.view.oy + y * ui.view.scale];
}

function fromEvent(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  const x = ev.clientX - r.left;
  const y = ev.clientY - r.top;
  return [(x - ui.view.ox) / ui.view.scale, (y - ui.view.oy) / ui.view.scale];
}

function ellipse(ctx, x, y, rx, ry, fill, stroke) {
  const [sx, sy] = toScreen(x, y);
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * ui.view.scale, ry * ui.view.scale, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

function drawPath(ctx, pts, stroke, width, alpha) {
  if (pts.length < 2) return;
  ctx.beginPath();
  const [x0, y0] = toScreen(pts[0][0], pts[0][1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = toScreen(pts[i][0], pts[i][1]);
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = stroke;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function pointOnPath(pts, u) {
  const t = Math.max(0, Math.min(1, u));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segs.push({ i, len });
    total += len;
  }
  let walk = t * total;
  for (const s of segs) {
    if (walk <= s.len || s.i === segs.length - 1) {
      const f = s.len ? walk / s.len : 0;
      const a = pts[s.i];
      const b = pts[s.i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    walk -= s.len;
  }
  return pts[pts.length - 1];
}

function ingestSpikes(spikes) {
  const now = performance.now();
  for (const cell of CELLS) {
    const times = spikes[cell.id] || [];
    const last = ui.seen[cell.id] ?? -1;
    let newest = last;
    for (const t of times) {
      if (t > last + 1e-4) {
        ui.glow[cell.id] = 1;
        for (const e of EDGES) {
          if (e.from !== cell.id) continue;
          const pts = AXON[`${e.from}-${e.to}`];
          if (pts) ui.bolts.push({ pts, born: now, life: 380 + Math.min(220, e.w / 20) });
        }
      }
      if (t > newest) newest = t;
    }
    ui.seen[cell.id] = newest;
  }
  if (ui.bolts.length > 80) ui.bolts = ui.bolts.slice(-80);
}

function drawBrain(canvas) {
  const { ctx, w, h } = sizeCanvas(canvas);
  if (!ctx) return;
  fitBrain(w, h);
  ctx.fillStyle = "#0c0f13";
  ctx.fillRect(0, 0, w, h);

  ctx.font = `600 ${Math.max(11, 12 * ui.view.scale)}px IBM Plex Sans, sans-serif`;
  ctx.fillStyle = "#8a8376";
  const title = (label, x, y) => {
    const [sx, sy] = toScreen(x, y);
    ctx.fillText(label, sx, sy);
  };
  title("OPTIC LOBE", 88, 48);
  title("CENTRAL BRAIN", 390, 42);
  title("GNG", 420, 318);
  title("VNC  T1", 560, 430);
  title("T2", 560, 498);
  title("T3", 560, 568);

  ellipse(ctx, 160, 160, 100, 118, "rgba(40, 70, 82, 0.35)", "rgba(110, 196, 212, 0.28)");
  ellipse(ctx, 740, 160, 100, 118, "rgba(40, 70, 82, 0.22)", "rgba(110, 196, 212, 0.16)");
  ellipse(ctx, 450, 168, 168, 128, "rgba(48, 42, 30, 0.45)", "rgba(232, 179, 90, 0.22)");
  ellipse(ctx, 450, 300, 92, 48, "rgba(40, 44, 38, 0.4)", "rgba(143, 182, 122, 0.22)");
  ellipse(ctx, 450, 368, 20, 38, "rgba(36, 40, 46, 0.7)", "rgba(196, 189, 176, 0.2)");
  ellipse(ctx, 450, 432, 72, 30, "rgba(42, 36, 34, 0.45)", "rgba(224, 122, 104, 0.2)");
  ellipse(ctx, 450, 508, 84, 36, "rgba(42, 36, 34, 0.5)", "rgba(224, 122, 104, 0.28)");
  ellipse(ctx, 450, 578, 72, 30, "rgba(42, 36, 34, 0.45)", "rgba(224, 122, 104, 0.2)");
  ellipse(ctx, 450, 638, 40, 20, "rgba(36, 40, 46, 0.45)", "rgba(196, 189, 176, 0.16)");
  ellipse(ctx, 300, 52, 36, 16, "rgba(40, 70, 82, 0.25)", "rgba(110, 196, 212, 0.2)");

  const selected = ui.selected;
  const related = new Set();
  if (selected) {
    related.add(selected);
    for (const e of EDGES) {
      if (e.from === selected || e.to === selected) {
        related.add(e.from);
        related.add(e.to);
      }
    }
  }

  for (const e of EDGES) {
    const pts = AXON[`${e.from}-${e.to}`];
    if (!pts) continue;
    const pre = ui.fire[e.from] || 0;
    const on = !selected || e.from === selected || e.to === selected;
    const col = e.vfb ? "rgba(110,196,212," : "rgba(196,168,120,";
    drawPath(ctx, pts, `${col}${on ? 0.28 + 0.45 * pre : 0.08})`, (e.vfb ? 2.4 : 1.6) + 2.2 * pre, 1);
  }

  const now = performance.now();
  ui.bolts = ui.bolts.filter((b) => now - b.born < b.life);
  for (const b of ui.bolts) {
    const u = (now - b.born) / b.life;
    const [x, y] = pointOnPath(b.pts, u);
    const [sx, sy] = toScreen(x, y);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 16 * ui.view.scale);
    g.addColorStop(0, "rgba(255,244,214,0.95)");
    g.addColorStop(0.4, "rgba(232,179,90,0.7)");
    g.addColorStop(1, "rgba(232,179,90,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, 16 * ui.view.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `600 ${Math.max(12, 13 * ui.view.scale)}px IBM Plex Sans, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (const cell of CELLS) {
    const hz = ui.hz[cell.id] || 0;
    const glow = ui.glow[cell.id] || 0;
    ui.glow[cell.id] = glow * 0.86;
    const col = CLS_COLOR[cell.cls];
    const dim = selected && !related.has(cell.id);
    const [sx, sy] = toScreen(cell.x, cell.y);
    const r = (cell.r + 10 * glow) * ui.view.scale;
    const halo = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 3.2);
    halo.addColorStop(0, rgb(col, 0.18 + 0.65 * glow + 0.15 * Math.min(1, hz / 80)));
    halo.addColorStop(1, rgb(col, 0));
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgb(col, 0.35 + 0.55 * glow);
    ctx.fill();
    ctx.lineWidth = cell.id === selected ? 3 : 1.5;
    ctx.strokeStyle = cell.id === selected ? "#f4efe6" : rgb(col, 0.9);
    ctx.stroke();
    if (glow > 0.35) {
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,252,240,0.95)";
      ctx.fill();
    }
    const lx = sx + r + 8;
    ctx.fillStyle = dim ? "#8a8376" : "#f0ebe3";
    ctx.fillText(cell.label, lx, sy - 8);
    ctx.fillStyle = dim ? "#6e685c" : rgb(col, 1);
    ctx.font = `500 ${Math.max(11, 12 * ui.view.scale)}px IBM Plex Mono, monospace`;
    ctx.fillText(`${hz.toFixed(0)} Hz`, lx, sy + 9);
    ctx.font = `600 ${Math.max(12, 13 * ui.view.scale)}px IBM Plex Sans, sans-serif`;
    ctx.globalAlpha = 1;
  }
}

function voltageAt(id, tQuery) {
  const times = ui.spikes[id] || [];
  const ex = ui.excitability;
  const rest = -62 + (1 - ex) * 28;
  let v = rest;
  for (const ts of times) {
    const dt = (tQuery - ts) * 1000;
    if (dt < 0 || dt > 8) continue;
    if (dt < 0.35) v = rest + (38 - rest) * (dt / 0.35);
    else if (dt < 0.9) v = 38 - 108 * ((dt - 0.35) / 0.55);
    else v = Math.min(v, rest - 8 * Math.exp(-(dt - 0.9) / 2.2));
  }
  return v;
}

function drawEphys(canvas) {
  const { ctx, w, h } = sizeCanvas(canvas);
  if (!ctx) return;
  ctx.fillStyle = "#0c0f13";
  ctx.fillRect(0, 0, w, h);
  const ids = EPHYS_ROWS.slice();
  if (ui.selected && !ids.includes(ui.selected)) ids.unshift(ui.selected);
  const rowH = h / ids.length;
  const win = 0.5;
  const tNow = ui.t;
  const left = 92;
  ids.forEach((id, i) => {
    const y0 = i * rowH;
    const cell = cellById[id];
    const col = CLS_COLOR[cell ? cell.cls : "command"];
    if (id === ui.selected) {
      ctx.fillStyle = "rgba(244,239,230,0.05)";
      ctx.fillRect(0, y0, w, rowH);
    }
    ctx.fillStyle = "#f0ebe3";
    ctx.font = "600 13px IBM Plex Sans, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(cell ? cell.label : id, 10, y0 + rowH * 0.38);
    ctx.fillStyle = rgb(col, 1);
    ctx.font = "500 12px IBM Plex Mono, monospace";
    ctx.fillText(`${(ui.hz[id] || 0).toFixed(0)} Hz`, 10, y0 + rowH * 0.68);

    ctx.beginPath();
    const mid = y0 + rowH * 0.55;
    const amp = rowH * 0.38;
    const steps = Math.max(180, Math.floor((w - left) / 2));
    for (let s = 0; s <= steps; s++) {
      const tq = tNow - win + (s / steps) * win;
      const v = voltageAt(id, tq);
      const x = left + (s / steps) * (w - left - 8);
      const y = mid - ((v + 70) / 110) * amp;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgb(col, 0.95);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  });
}

function whyFiring(id) {
  const hz = ui.hz[id] || 0;
  const fire = ui.fire[id] || 0;
  const chem = ui.chem;
  if (ui.dead) return "Network silent — irreversible failure.";
  if (ui.excitability < 0.1 && id !== "glia") {
    return "Na+/K+ ATPase cannot hold spike threshold. ATP is down, [K+]o is high, pH is acid.";
  }
  if (id === "glia") {
    return `Glia track [K+]o. Hsp70 is ${((chem.hsp70 || 0) * 100).toFixed(0)}% of plateau (Armstrong 2011).`;
  }
  if (hz < 2) {
    return `${ui.phase}: this cell is below 2 Hz. No synaptic drive, or anoxia has clamped the membrane.`;
  }
  const parts = [];
  const ins = EDGES.filter((e) => e.to === id);
  if (ins.length) {
    parts.push(`Synaptic drive from ${ins.map((e) => `${e.from} ${(ui.hz[e.from] || 0).toFixed(0)} Hz`).join(", ")}.`);
  } else {
    parts.push("Primary sensory receptor — driven by water on the antenna / pulvilli, not by a presynaptic cell.");
  }
  if ((chem.octopamine || 1) > 1.4 && (id === "GF" || id === "TTMn" || id === "JO")) {
    parts.push(`Octopamine ${chem.octopamine.toFixed(2)}× rest raises escape gain. That is the fly norepinephrine analog, not cortisol.`);
  }
  if ((chem.corazonin || 1) > 1.4 && (id === "DNg27" || id === "SpMN" || id === "ISN")) {
    parts.push(`Corazonin ${chem.corazonin.toFixed(2)}× is the water / metabolic peptide on the spiracle gate.`);
  }
  if (fire > 0.5) parts.push(`You are watching ${hz.toFixed(0)} action potentials per second.`);
  return parts.join(" ");
}

function renderInspector() {
  const box = document.getElementById("inspector");
  const id = ui.selected;
  if (!id) {
    box.innerHTML = `<h2>Selected cell</h2><p class="hint">Click a glowing soma. You will see who drives it, where the spike goes, and why it is firing.</p>`;
    return;
  }
  const meta = ui.nodesMeta[id] || {};
  const cell = cellById[id];
  const ins = EDGES.filter((e) => e.to === id);
  const outs = EDGES.filter((e) => e.from === id);
  const rows = (list, key) =>
    list
      .map((e) => {
        const other = key === "from" ? e.from : e.to;
        return `<tr><td>${other}</td><td>${e.w.toLocaleString()}</td><td>${e.vfb ? "VFB" : "literature"}</td><td>${(ui.hz[other] || 0).toFixed(0)} Hz</td></tr>`;
      })
      .join("");
  box.innerHTML = `
    <h2>Selected cell</h2>
    <p class="trace-title"><strong>${meta.label || cell.label}</strong>
      ${meta.fbbt ? `<code>${meta.fbbt}</code>` : ""}
      <span>${meta.tx || ""} · ${meta.role || cell.sub}</span></p>
    <p class="trace-hz">${(ui.hz[id] || 0).toFixed(1)} Hz now</p>
    <p class="why">${whyFiring(id)}</p>
    <h3>Inputs — who is driving this spike</h3>
    ${
      ins.length
        ? `<table><thead><tr><th>Presynaptic</th><th>Synapses</th><th>Source</th><th>Now</th></tr></thead><tbody>${rows(ins, "from")}</tbody></table>`
        : `<p class="hint">Sensory ending. No presynaptic cell in this circuit.</p>`
    }
    <h3>Outputs — where this spike goes</h3>
    ${
      outs.length
        ? `<table><thead><tr><th>Postsynaptic</th><th>Synapses</th><th>Source</th><th>Now</th></tr></thead><tbody>${rows(outs, "to")}</tbody></table>`
        : `<p class="hint">Terminal effector. The spike ends in muscle or glia.</p>`
    }
  `;
}

function applyPhysio(p) {
  ui.fire = p.fire || ui.fire;
  ui.hz = p.hz || ui.hz;
  ui.drive = p.drive || ui.drive;
  ui.spikes = p.spikes || ui.spikes;
  ingestSpikes(ui.spikes);
  ui.dead = !!p.dead;
  ui.excitability = p.excitability ?? 1;
  ui.history = p.history || ui.history;
  ui.events = p.events || ui.events;
  ui.chem = p.chem || {};
  ui.nodesMeta = p.nodes || ui.nodesMeta;
  ui.phase = p.phase;
  ui.note = p.note;
  ui.t = p.t;
  ui.physio = p;

  document.getElementById("o2").textContent = `${p.o2.toFixed(1)}%`;
  document.getElementById("atp").textContent = `${p.atp.toFixed(1)}%`;
  document.getElementById("k").textContent = `${p.kRel.toFixed(2)}×`;
  document.getElementById("ph").textContent = p.pH.toFixed(2);
  document.getElementById("ex").textContent = `${(p.excitability * 100).toFixed(0)}%`;
  document.getElementById("surv").textContent = `${(p.survival * 100).toFixed(0)}%`;
  setBar("o2-bar", p.o2 / 21);
  setBar("atp-bar", p.atp / 100);
  setBar("k-bar", (p.kRel - 1) / 3);
  setBar("ph-bar", (p.pH - 6.2) / 1.2);
  setBar("ex-bar", p.excitability);
  setBar("surv-bar", p.survival);

  const c = p.chem || {};
  document.getElementById("oa").textContent = `${(c.octopamine ?? 1).toFixed(2)}×`;
  document.getElementById("crz").textContent = `${(c.corazonin ?? 1).toFixed(2)}×`;
  document.getElementById("akh").textContent = `${(c.akh ?? 1).toFixed(2)}×`;
  document.getElementById("lac").textContent = (c.lactate ?? 0).toFixed(2);
  document.getElementById("ala").textContent = (c.alanine ?? 0).toFixed(2);
  document.getElementById("ace").textContent = (c.acetate ?? 0).toFixed(2);
  document.getElementById("hsp").textContent = (c.hsp70 ?? 0).toFixed(2);
  document.getElementById("ros").textContent = (c.ros ?? 0).toFixed(2);
  document.getElementById("ampk").textContent = (c.ampk ?? 0).toFixed(2);
  setBar("oa-bar", ((c.octopamine ?? 1) - 0.5) / 3);
  setBar("crz-bar", ((c.corazonin ?? 1) - 0.5) / 2.5);
  setBar("akh-bar", ((c.akh ?? 1) - 0.5) / 2.5);
  setBar("lac-bar", c.lactate ?? 0);
  setBar("ala-bar", c.alanine ?? 0);
  setBar("ace-bar", c.acetate ?? 0);
  setBar("hsp-bar", c.hsp70 ?? 0);
  setBar("ros-bar", c.ros ?? 0);
  setBar("ampk-bar", c.ampk ?? 0);

  const clock = p.submerged ? p.submergedFor : p.t;
  document.getElementById("clock").textContent = fmtTime(clock);
  document.getElementById("phase").innerHTML = `<strong>${p.phase}</strong>${p.note}`;
  document.getElementById("water").classList.toggle("on", !!p.submerged);

  const evKey = JSON.stringify(ui.events);
  if (evKey !== ui.lastEvents) {
    ui.lastEvents = evKey;
    document.getElementById("event-log").innerHTML = ui.events
      .slice()
      .reverse()
      .map((e) => `<li><time>${fmtTime(e.t)}</time>${e.text}</li>`)
      .join("");
  }
  if (ui.selected) renderInspector();
}

function applyVfb(v) {
  document.getElementById("vfb-age").textContent = v.polling ? "atlas · polling…" : fmtAge(v.ageSeconds);
  const tb = document.getElementById("vfb-body");
  if (v.rows && v.rows.length) {
    tb.innerHTML = v.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  }
}

const offline = createOfflineSim();
let live = false;

function protocol(action) {
  const speed = Number(document.getElementById("speed").value);
  if (!live) {
    offline.protocol(action, speed);
    return;
  }
  fetch("/protocol", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, speed }),
  }).catch(() => {});
}

function startOffline() {
  live = false;
  document.getElementById("engine").textContent = "browser-physio";
  document.getElementById("fly-status").textContent =
    "Browser body · legs follow TTMn / octopamine / excitability";
  document.getElementById("fly-view").hidden = true;
  ui.hasJpeg = false;
  applyVfb(STATIC_VFB);
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/stream`);
  const img = document.getElementById("fly-view");
  const status = document.getElementById("fly-status");
  ws.onmessage = (ev) => {
    live = true;
    const msg = JSON.parse(ev.data);
    document.getElementById("engine").textContent = msg.engine || "engine";
    if (msg.jpeg) {
      img.src = `data:image/jpeg;base64,${msg.jpeg}`;
      img.hidden = false;
      ui.hasJpeg = true;
      status.textContent = msg.ready ? "NeuroMechFly · legs follow TTMn Hz" : msg.error || "Physics not ready";
    } else {
      img.hidden = true;
      ui.hasJpeg = false;
      status.textContent = msg.error || "Browser body · waiting for MuJoCo frame";
    }
    if (msg.physio) applyPhysio(msg.physio);
    if (msg.vfb) applyVfb(msg.vfb);
  };
  ws.onerror = () => {
    if (!live) startOffline();
  };
  ws.onclose = () => {
    if (live) {
      live = false;
      status.textContent = "Stream closed — using in-browser physio";
    }
    startOffline();
  };
}

async function connect() {
  try {
    const r = await fetch("/health", { cache: "no-store" });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.includes("json")) {
      connectWs();
      return;
    }
  } catch {
    /* static host */
  }
  startOffline();
}

function init() {
  const brain = document.getElementById("brain");
  const ephys = document.getElementById("ephys");
  const body = document.getElementById("fly-body");
  brain.addEventListener("click", (ev) => {
    const [x, y] = fromEvent(brain, ev);
    let hit = null;
    let best = 28;
    for (const cell of CELLS) {
      const d = Math.hypot(cell.x - x, cell.y - y);
      if (d < best) {
        best = d;
        hit = cell.id;
      }
    }
    ui.selected = hit;
    renderInspector();
  });
  document.getElementById("submerge").onclick = () => protocol("submerge");
  document.getElementById("surface").onclick = () => protocol("surface");
  document.getElementById("reset").onclick = () => protocol("reset");
  document.getElementById("speed").onchange = () => protocol("speed");
  renderInspector();
  let last = performance.now();
  function loop(now) {
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ui.tVis += realDt;
    if (!live) {
      offline.step(realDt * offline.s.speed);
      applyPhysio(offline.snapshot());
    }
    drawFlyBody(body, ui.physio, ui.tVis);
    drawBrain(brain);
    drawEphys(ephys);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  connect();
}

try {
  init();
} catch (err) {
  const status = document.getElementById("fly-status");
  if (status) status.textContent = `UI failed to start: ${err.message}`;
  console.error(err);
}
