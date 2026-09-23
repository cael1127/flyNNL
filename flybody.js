/** Tethered adult Drosophila, side view. Legs follow the same CPG / TTMn / limp rules as server/motor.py. */

function motorGait(p, tVis) {
  const ex = p.excitability ?? 1;
  const hz = p.hz || {};
  const chem = p.chem || {};
  const tt = (hz.TTMn || 0) / 90;
  const psi = (hz.PSI || 0) / 70;
  const oa = chem.octopamine ?? 1;
  const limp = !!(p.dead || p.blocked || ex < 0.08);
  const contact = p.submerged && p.submergedFor < 2;
  const escape = p.submerged && p.submergedFor >= 0.4 && p.submergedFor < 12;
  const hypoxia = p.submerged && p.submergedFor >= 12 && p.submergedFor < 45;
  const recovering = !p.submerged && p.surfacedFor > 0 && !p.recovered;
  let freq;
  let amp;
  if (limp) {
    freq = 0.4;
    amp = 0.02;
  } else if (recovering) {
    freq = 1.6;
    amp = 0.06 * ex;
  } else if (contact) {
    freq = 12 + 2 * oa;
    amp = 0.45 + 0.12 * (oa - 1);
  } else if (escape) {
    freq = 8 + 4 * tt;
    amp = 0.28 * ex * (0.7 + 0.3 * oa);
  } else if (hypoxia) {
    freq = 3 + 5 * ex;
    amp = 0.14 * ex;
  } else {
    freq = 6.5;
    amp = 0.26 * Math.max(ex, 0.15);
  }
  return {
    freq,
    amp,
    limp,
    contact,
    escape,
    hypoxia,
    recovering,
    tt,
    psi,
    oa,
    ex,
    phase: Math.PI * 2 * freq * tVis,
  };
}

const LEGS = [
  { id: "lf", side: 1, trip: 0, hip: [-38, 8], rest: [18, 38, 32] },
  { id: "lm", side: 1, trip: Math.PI, hip: [-4, 14], rest: [28, 44, 36] },
  { id: "lh", side: 1, trip: 0, hip: [28, 10], rest: [22, 40, 34] },
  { id: "rf", side: -1, trip: Math.PI, hip: [-34, 4], rest: [16, 34, 28] },
  { id: "rm", side: -1, trip: 0, hip: [0, 8], rest: [24, 40, 32] },
  { id: "rh", side: -1, trip: Math.PI, hip: [32, 6], rest: [20, 36, 30] },
];

function size2d(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return null;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawFlyBody(canvas, p, tVis) {
  const sized = size2d(canvas);
  if (!sized) return;
  const { ctx, w, h } = sized;
  ctx.fillStyle = "#080a0d";
  ctx.fillRect(0, 0, w, h);

  const gait = motorGait(p || {}, tVis);
  const cx = w * 0.48;
  const cy = h * 0.46;
  const s = Math.min(w, h) / 520;

  // Fixture / floor
  ctx.fillStyle = "#141820";
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.strokeStyle = "#2a323c";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.lineTo(w, h * 0.78);
  ctx.stroke();

  // Tether
  ctx.strokeStyle = "#8a8376";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, 8);
  ctx.lineTo(cx, cy - 28 * s);
  ctx.stroke();
  ctx.fillStyle = "#c4bdb0";
  ctx.fillRect(cx - 10 * s, cy - 36 * s, 20 * s, 10 * s);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  // Wings (PSI / limp)
  const wing = gait.limp ? 8 : 18 + 10 * gait.psi * Math.sin(gait.phase * 2);
  ctx.fillStyle = "rgba(210, 220, 230, 0.18)";
  ctx.strokeStyle = "rgba(210, 220, 230, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(18, -22, 78, 16, -0.35 + wing * 0.01, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Abdomen
  ctx.fillStyle = "#5a3a28";
  ctx.beginPath();
  ctx.ellipse(62, 10, 58, 26, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a2418";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(38 + i * 12, 6 + i * 3, 22 - i * 2, 18 - i, 0.18, 0, Math.PI);
    ctx.stroke();
  }

  // Thorax
  ctx.fillStyle = "#6a4630";
  ctx.beginPath();
  ctx.ellipse(0, 0, 36, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a2e1c";
  ctx.beginPath();
  ctx.ellipse(-4, -8, 18, 10, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Head + eye
  ctx.fillStyle = "#5c3a26";
  ctx.beginPath();
  ctx.ellipse(-48, -6, 22, 18, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c45c4a";
  ctx.beginPath();
  ctx.ellipse(-56, -8, 10, 12, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a1210";
  ctx.beginPath();
  ctx.ellipse(-58, -8, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Antennae / arista
  ctx.strokeStyle = "#d8c4a8";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-66, -16);
  ctx.quadraticCurveTo(-78, -38, -70, -52);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-62, -18);
  ctx.quadraticCurveTo(-68, -40, -58, -50);
  ctx.stroke();

  // Proboscis
  ctx.strokeStyle = "#8a6450";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-64, 4);
  ctx.lineTo(-72, 16);
  ctx.stroke();

  for (const leg of LEGS) {
    const trip = gait.phase + leg.trip;
    let coxa = 0.35;
    let femur = 0.9;
    let tibia = 0.55;
    if (gait.limp) {
      coxa = 0.55;
      femur = 1.25;
      tibia = 0.85;
    } else {
      const swing = gait.amp * Math.sin(trip);
      coxa = 0.28 + 0.22 * swing;
      femur = 0.75 + 0.45 * swing;
      tibia = 0.4 + 0.35 * Math.sin(trip + 0.6);
      if (gait.escape && (leg.id === "lm" || leg.id === "rm")) {
        const kick = 0.62 * Math.min(1, gait.tt);
        femur = 0.35 - 0.25 * kick;
        tibia = 0.15;
        coxa = 0.15 - 0.1 * kick;
      }
      if (gait.contact) {
        femur += 0.12 * Math.sin(trip * 1.7);
      }
    }
    const [hx, hy] = leg.hip;
    const ySign = 1;
    const x0 = hx;
    const y0 = hy;
    const x1 = x0 + Math.sin(coxa) * 16 * leg.side * 0.15 + Math.cos(coxa) * 2;
    const y1 = y0 + Math.cos(coxa) * 18 * ySign;
    const x2 = x1 + Math.sin(femur) * 4 + Math.cos(femur - 0.2) * 6 * (leg.side > 0 ? 0.2 : -0.05);
    const y2 = y1 + Math.sin(femur) * leg.rest[1];
    const x3 = x2 + Math.sin(tibia) * 8 * (leg.id.includes("f") ? -0.4 : 0.3);
    const y3 = y2 + Math.sin(tibia) * leg.rest[2];
    ctx.strokeStyle = leg.side > 0 ? "#c4a078" : "#8a6a48";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = leg.side > 0 ? 4.2 : 3.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
    ctx.fillStyle = "#e8d2b0";
    ctx.beginPath();
    ctx.arc(x1, y1, 2.2, 0, Math.PI * 2);
    ctx.arc(x2, y2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Water column
  if (p && p.submerged) {
    const rise = Math.min(1, (p.submergedFor || 0) / 8);
    const top = h * (0.72 - 0.42 * rise);
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, "rgba(80, 170, 190, 0.18)");
    g.addColorStop(1, "rgba(40, 90, 110, 0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, h - top);
    ctx.fillStyle = "rgba(160, 220, 230, 0.35)";
    ctx.fillRect(0, top, w, 3);
  }

  ctx.fillStyle = "#c4bdb0";
  ctx.font = "12px IBM Plex Mono, Consolas, monospace";
  ctx.textAlign = "left";
  const label = gait.limp
    ? "legs limp · motor map silent"
    : gait.escape
      ? `TTMn jump ${(p.hz && p.hz.TTMn ? p.hz.TTMn : 0).toFixed(0)} Hz`
      : gait.contact
        ? "contact struggle"
        : `${gait.freq.toFixed(1)} Hz CPG`;
  ctx.fillText(label, 10, h - 12);
}
