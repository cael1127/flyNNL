const NODE_IDS = [
  "Ir40a", "Ir68a", "JO", "LPLC2", "ISN", "hPN", "DNp44",
  "GF", "DNg27", "glia", "TTMn", "PSI", "SpMN",
];

const MAX_HZ = {
  Ir40a: 60, Ir68a: 70, JO: 80, LPLC2: 50, ISN: 25, hPN: 45, DNp44: 40,
  GF: 180, DNg27: 30, glia: 8, TTMn: 90, PSI: 70, SpMN: 40,
};

const NODES_META = {
  Ir40a: { label: "Ir40a HRN", fbbt: "FBbt_00110990", tx: "cholinergic", role: "dry hygrosensor" },
  Ir68a: { label: "Ir68a HRN", fbbt: "FBbt_00049659", tx: "cholinergic", role: "humid / wet sensor" },
  JO: { label: "Johnston organ", fbbt: "FBbt_00005251", tx: "cholinergic", role: "mechanosensory water hit" },
  LPLC2: { label: "LPLC2", fbbt: "FBbt_00111763", tx: "cholinergic", role: "looming startle" },
  ISN: { label: "ISN", fbbt: null, tx: "interoceptive", role: "hemolymph osmolarity" },
  hPN: { label: "VP hygro PN", fbbt: "FBbt_00047227", tx: "cholinergic", role: "2nd-order humidity" },
  DNp44: { label: "DNp44", fbbt: null, tx: "descending", role: "dry-escape descending" },
  GF: { label: "DNp01 GF", fbbt: "FBbt_00004020", tx: "cholinergic", role: "jump command" },
  DNg27: { label: "DNg27", fbbt: null, tx: "glutamatergic", role: "spiracle / flight gate" },
  glia: { label: "glia", fbbt: null, tx: "Hsp70 / K+ buffer", role: "ion homeostasis" },
  TTMn: { label: "TTMn", fbbt: "FBbt_00007406", tx: "glutamatergic", role: "jump motor" },
  PSI: { label: "PSI", fbbt: "FBbt_00004021", tx: "electrical from GF", role: "flight premotor" },
  SpMN: { label: "SpMN", fbbt: null, tx: "motor", role: "spiracle closer" },
};

const PHYS_EDGES = [
  ["Ir40a", "hPN", 6886, true],
  ["Ir68a", "hPN", 12000, true],
  ["hPN", "DNp44", 80, false],
  ["JO", "GF", 400, false],
  ["LPLC2", "GF", 5680, true],
  ["GF", "TTMn", 375, true],
  ["GF", "PSI", 200, false],
  ["ISN", "DNg27", 120, false],
  ["DNg27", "SpMN", 80, false],
  ["DNp44", "TTMn", 40, false],
];

const EDGE_SCALE = Object.fromEntries(
  PHYS_EDGES.map(([a, b, w]) => [`${a}-${b}`, Math.log10(w + 1) / 4.2])
);

const STATIC_VFB = {
  ageSeconds: null,
  polling: false,
  rows: [
    ["LPLC2 → GF", "275", "5,680", "64", "flywire783 99 · male_cns 176"],
    ["GF → TTMn", "5", "375", "146", "MANC 3 · male_cns 2"],
    ["HRN → hPN", "628", "18,942", "", "VFB cached"],
    ["Ir40a → hPN", "297", "6,886", "", "VFB cached"],
  ],
};

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _smooth(current, target, dt, tau) {
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 1e-6)));
}

function recoveryDelay(submergedFor) {
  if (submergedFor <= 0) return 0;
  if (submergedFor <= 7200) return 900 * (submergedFor / 7200);
  return 900 + 2700 * Math.min(1, (submergedFor - 7200) / 7200);
}

function createOfflineSim() {
  const zeros = () => Object.fromEntries(NODE_IDS.map((k) => [k, 0]));
  const lists = () => Object.fromEntries(NODE_IDS.map((k) => [k, []]));
  const s = {
    t: 0,
    submerged: false,
    submergedFor: 0,
    surfacedFor: 0,
    o2: 21,
    atp: 100,
    kRel: 1,
    pH: 7.4,
    survival: 1,
    dead: false,
    recovered: false,
    phase: "Normoxia",
    note: "Adult fly at rest. Network is sparse and metabolically cheap.",
    fire: zeros(),
    hz: zeros(),
    drive: zeros(),
    spikes: lists(),
    events: [],
    history: [],
    lastLog: 0,
    speed: 10,
    octopamine: 1,
    corazonin: 1,
    akh: 1,
    lactate: 0,
    alanine: 0,
    acetate: 0,
    hsp70: 0.05,
    ros: 0.05,
    ampk: 0.1,
    lastPhase: "Normoxia",
  };

  function excitability() {
    const atpGate = 1 / (1 + Math.exp(-(s.atp - 28) / 6));
    const kGate = 1 / (1 + Math.exp((s.kRel - 1.85) / 0.18));
    const phGate = 1 / (1 + Math.exp(-(s.pH - 6.55) / 0.12));
    return _clamp(atpGate * kGate * phGate, 0, 1);
  }

  function meanFire() {
    const vals = NODE_IDS.filter((k) => k !== "glia").map((k) => s.fire[k]);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function blocked() {
    if (s.dead) return true;
    if (!s.submerged && s.surfacedFor > 0) return s.surfacedFor < recoveryDelay(s.submergedFor);
    return false;
  }

  function classify() {
    if (s.dead) {
      return ["Irreversible failure", "ATP and [K+]o did not recover. Adult LT50 is ~8 h at room temperature."];
    }
    if (blocked() && !s.submerged) {
      const left = recoveryDelay(s.submergedFor) - s.surfacedFor;
      return ["Reoxygenation block", `O2 is back but the motor map is still silent for ${left.toFixed(0)} s (Krishnan).`];
    }
    if (s.recovered && !s.submerged) {
      return ["Recovered", "Ion gradients restored. Octopamine falling; ROS from reoxygenation still elevated."];
    }
    if (!s.submerged && s.surfacedFor > 0 && s.atp < 90) {
      return ["Reoxygenation", "Aerobic ATP returning. Clearing [K+]o takes minutes. ROS burst on air."];
    }
    if (!s.submerged) return ["Normoxia", "Air available. Sparse baseline spikes. Stress peptides at rest."];
    if (s.submergedFor < 2) return ["Contact", "Ir68a / Ir40a / Johnston organ spike. Octopamine rising."];
    if (s.submergedFor < 12) return ["Escape attempt", "JO+LPLC2 → DNp01 → TTMn jump. Spiracles closing."];
    if (s.submergedFor < 45) return ["Hypoxic collapse", "Na+/K+ ATPase slowing. Spikes irregular. Lactate starting."];
    if (s.submergedFor < 120) return ["Anoxic stupor", "Spike arrest. Adult paralyzed within ~30–120 s (Krishnan 1997)."];
    return ["Anoxic coma", "ATP held near 3% for hours. [K+]o ~2× at 2 h, pH 6.4."];
  }

  function pushEvent(text) {
    if (s.events.length && s.events[s.events.length - 1].text === text) return;
    s.events.push({ t: s.t, phase: s.phase, text });
    if (s.events.length > 40) s.events = s.events.slice(-40);
  }

  function emitSpikes(dt) {
    const window = 2.2;
    for (const nid of NODE_IDS) {
      const span = Math.min(dt, window);
      const expected = s.hz[nid] * span;
      const n = Math.min(Math.floor(expected + Math.random()), 120);
      const times = s.spikes[nid];
      for (let i = 0; i < n; i++) times.push(s.t - Math.random() * span);
      if (times.length > 160 || (times[0] != null && times[0] < s.t - window)) {
        s.spikes[nid] = times.filter((t) => s.t - t <= window);
      }
    }
  }

  function reset() {
    Object.assign(s, {
      t: 0, submerged: false, submergedFor: 0, surfacedFor: 0,
      o2: 21, atp: 100, kRel: 1, pH: 7.4, survival: 1, dead: false, recovered: false,
      phase: "Normoxia", note: "Adult fly at rest. Network is sparse and metabolically cheap.",
      fire: zeros(), hz: zeros(), drive: zeros(), spikes: lists(), events: [], history: [],
      lastLog: 0, octopamine: 1, corazonin: 1, akh: 1, lactate: 0, alanine: 0, acetate: 0,
      hsp70: 0.05, ros: 0.05, ampk: 0.1, lastPhase: "Normoxia",
    });
  }

  function step(dt) {
    if (s.dead) {
      [s.phase, s.note] = classify();
      return;
    }
    s.t += dt;
    const ex = excitability();
    if (s.submerged) {
      s.submergedFor += dt;
      s.surfacedFor = 0;
      s.o2 = _smooth(s.o2, 0.05, dt, 6);
      const atpTarget = s.submergedFor < 7200
        ? Math.max(3, 100 * Math.exp(-s.submergedFor / 1400))
        : Math.max(1.2, 3 - (s.submergedFor - 7200) / 20000);
      s.atp = _smooth(s.atp, atpTarget, dt, 8);
      let kTarget = 1 + (1 - Math.exp(-s.submergedFor / 3600));
      if (s.submergedFor > 7200) kTarget = 2 + 2 * Math.min(1, (s.submergedFor - 7200) / 36000);
      s.kRel = _smooth(s.kRel, kTarget, dt, 40);
      const phTarget = s.submergedFor < 900
        ? 7.4 - 0.7 * (s.submergedFor / 900)
        : 6.7 - 0.3 * Math.min(1, (s.submergedFor - 900) / 6300);
      s.pH = _smooth(s.pH, phTarget, dt, 20);
      if (s.submergedFor > 8 * 3600 && s.atp < 2.2 && s.kRel > 3.4) {
        s.survival = 0;
        s.dead = true;
      } else if (s.submergedFor > 4 * 3600) {
        s.survival = _clamp(1 - (s.submergedFor - 4 * 3600) / (8 * 3600), 0.05, 1);
      }
    } else {
      s.o2 = _smooth(s.o2, 21, dt, 3);
      s.atp = _smooth(s.atp, 100, dt, 18 + s.submergedFor * 0.1);
      s.kRel = _smooth(s.kRel, 1, dt, 12 + s.submergedFor * 0.08);
      s.pH = _smooth(s.pH, 7.4, dt, 40);
      if (s.submergedFor > 0) s.surfacedFor += dt;
      if (s.atp > 85 && s.kRel < 1.15 && s.surfacedFor > recoveryDelay(s.submergedFor) && s.submergedFor > 0) {
        s.recovered = true;
      }
    }
    s.atp = _clamp(s.atp, 0.4, 100);
    s.o2 = _clamp(s.o2, 0, 21);
    s.kRel = _clamp(s.kRel, 1, 4.5);
    s.pH = _clamp(s.pH, 6.2, 7.4);

    const contact = s.submerged && s.submergedFor < 2;
    const escape = s.submerged && s.submergedFor >= 0.4 && s.submergedFor < 12;
    const hypoxia = s.submerged && s.submergedFor >= 12 && s.submergedFor < 45;
    const coma = s.submerged && s.submergedFor >= 45;

    let oaT, crzT, akhT, lacT, alaT, aceT, hspT, rosT, ampkT;
    if (s.submerged) {
      oaT = contact || escape ? 3.2 : hypoxia ? 1.4 : 0.7;
      crzT = 1.2 + 1.6 * Math.min(1, s.submergedFor / 30);
      akhT = 1.1 + 1.4 * Math.min(1, s.submergedFor / 180);
      lacT = Math.min(0.85, s.submergedFor / 7200);
      alaT = Math.min(1, s.submergedFor / 5400);
      aceT = Math.min(1, s.submergedFor / 4800);
      hspT = Math.min(1, 0.05 + s.submergedFor / 3600);
      rosT = 0.08;
      ampkT = Math.min(1, s.submergedFor / 600);
    } else {
      oaT = 1;
      crzT = s.submergedFor ? 1 + 0.4 * Math.min(1, s.surfacedFor / 120) : 1;
      akhT = 1;
      lacT = Math.max(0, s.lactate - s.surfacedFor / 2400);
      alaT = Math.max(0, s.alanine - s.surfacedFor / 3000);
      aceT = Math.max(0, s.acetate - s.surfacedFor / 2800);
      hspT = Math.min(1, s.hsp70 + (s.submergedFor ? 0.25 : 0));
      rosT = s.submergedFor > 0 && s.surfacedFor < 90 ? 0.85 : 0.05;
      ampkT = s.recovered ? 0.15 : Math.max(0.1, s.ampk * 0.7);
    }
    s.octopamine = _smooth(s.octopamine, oaT, dt, s.submerged ? 4 : 20);
    s.corazonin = _smooth(s.corazonin, crzT, dt, 12);
    s.akh = _smooth(s.akh, akhT, dt, 25);
    s.lactate = _smooth(s.lactate, lacT, dt, 40);
    s.alanine = _smooth(s.alanine, alaT, dt, 50);
    s.acetate = _smooth(s.acetate, aceT, dt, 50);
    s.hsp70 = _smooth(s.hsp70, hspT, dt, 80);
    s.ros = _smooth(s.ros, rosT, dt, 6);
    s.ampk = _smooth(s.ampk, ampkT, dt, 30);

    const raw = {
      Ir40a: contact ? 0.95 : s.submerged ? 0.18 : 0.05,
      Ir68a: contact ? 1 : s.submerged ? 0.4 : 0.06,
      JO: contact || escape ? 0.95 : 0.07,
      LPLC2: escape ? 0.55 : 0.08,
      ISN: s.submerged ? 0.45 : 0.04,
      hPN: 0, DNp44: 0, GF: 0, DNg27: 0,
      glia: 0.2 + 0.7 * _clamp((s.kRel - 1) / 2, 0, 1),
      TTMn: 0, PSI: 0,
      SpMN: s.submerged ? 0.85 : 0.08,
    };
    raw.hPN = raw.Ir40a * EDGE_SCALE["Ir40a-hPN"] + raw.Ir68a * EDGE_SCALE["Ir68a-hPN"];
    raw.DNp44 = raw.hPN * 0.85;
    raw.GF = (raw.LPLC2 * EDGE_SCALE["LPLC2-GF"] + raw.JO * 0.7) * (0.7 + 0.25 * _clamp(s.octopamine - 1, 0, 2));
    raw.DNg27 = raw.ISN * 0.8 + 0.25 * _clamp(s.corazonin - 1, 0, 2);
    raw.TTMn = raw.GF * EDGE_SCALE["GF-TTMn"] * 1.15 + raw.DNp44 * 0.25;
    raw.PSI = raw.GF * 0.7;
    raw.SpMN = Math.max(raw.SpMN, raw.DNg27 * 0.7);

    const blk = blocked();
    for (const nid of NODE_IDS) {
      let f = raw[nid] * (nid === "glia" ? 1 : ex);
      if (hypoxia && nid !== "glia") f *= 0.4 + 0.45 * Math.random();
      if (coma && nid !== "glia") f *= 0.03;
      if (blk && nid !== "glia") f *= 0.08;
      s.drive[nid] = raw[nid];
      s.fire[nid] = _clamp(f, 0, 1);
      s.hz[nid] = s.fire[nid] * MAX_HZ[nid];
    }
    emitSpikes(dt);
    [s.phase, s.note] = classify();
    if (s.phase !== s.lastPhase) {
      pushEvent(`Phase -> ${s.phase}`);
      s.lastPhase = s.phase;
    }
    if (contact) pushEvent(`Ir68a ${s.hz.Ir68a.toFixed(0)} Hz + JO ${s.hz.JO.toFixed(0)} Hz (water contact)`);
    if (escape && s.hz.GF > 20) {
      pushEvent(`JO+LPLC2 -> GF ${s.hz.GF.toFixed(0)} Hz -> TTMn ${s.hz.TTMn.toFixed(0)} Hz (octopamine ${s.octopamine.toFixed(1)}x)`);
    }
    if (coma && s.hz.GF < 5) pushEvent("Giant-fiber -> muscle EPSP silent (Krishnan 1997)");
    if (s.t - s.lastLog >= 0.25) {
      s.history.push({
        t: s.t, o2: s.o2, atp: s.atp, k: s.kRel, fire: meanFire(),
        oa: s.octopamine, crz: s.corazonin, ros: s.ros, lac: s.lactate,
      });
      if (s.history.length > 240) s.history = s.history.slice(-240);
      s.lastLog = s.t;
    }
  }

  function snapshot() {
    const recent = {};
    for (const nid of NODE_IDS) recent[nid] = s.spikes[nid].filter((t) => s.t - t <= 2);
    return {
      t: s.t,
      submerged: s.submerged,
      submergedFor: s.submergedFor,
      surfacedFor: s.surfacedFor,
      o2: s.o2,
      atp: s.atp,
      kRel: s.kRel,
      pH: s.pH,
      survival: s.survival,
      dead: s.dead,
      recovered: s.recovered,
      phase: s.phase,
      note: s.note,
      fire: { ...s.fire },
      hz: { ...s.hz },
      drive: { ...s.drive },
      spikes: recent,
      events: s.events.slice(-24),
      excitability: excitability(),
      meanFire: meanFire(),
      speed: s.speed,
      history: s.history.slice(-240),
      chem: {
        octopamine: s.octopamine, corazonin: s.corazonin, akh: s.akh,
        lactate: s.lactate, alanine: s.alanine, acetate: s.acetate,
        hsp70: s.hsp70, ros: s.ros, ampk: s.ampk,
      },
      recoveryDelay: recoveryDelay(s.submergedFor),
      blocked: blocked(),
      nodes: NODES_META,
    };
  }

  function protocol(action, speed) {
    if (speed) s.speed = speed;
    if (action === "submerge") s.submerged = true;
    if (action === "surface") s.submerged = false;
    if (action === "reset") reset();
  }

  return { s, step, snapshot, protocol, reset };
}
