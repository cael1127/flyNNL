"""Adult Drosophila forced-submersion physiology.

Flies do not make cortisol. Escape/stress analog is octopamine;
water/metabolic peptides are corazonin and AKH. Energy and ions
follow Callier 2015, Krishnan 1997, Feala 2007, Armstrong 2011.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

NODE_IDS = (
    "Ir40a",
    "Ir68a",
    "JO",
    "LPLC2",
    "ISN",
    "hPN",
    "DNp44",
    "GF",
    "DNg27",
    "glia",
    "TTMn",
    "PSI",
    "SpMN",
)

# Peak firing used to turn a 0–1 drive into Hz. Giant fiber is a fast spike.
MAX_HZ = {
    "Ir40a": 60,
    "Ir68a": 70,
    "JO": 80,
    "LPLC2": 50,
    "ISN": 25,
    "hPN": 45,
    "DNp44": 40,
    "GF": 180,
    "DNg27": 30,
    "glia": 8,
    "TTMn": 90,
    "PSI": 70,
    "SpMN": 40,
}

NODES_META = {
    "Ir40a": {"label": "Ir40a HRN", "fbbt": "FBbt_00110990", "tx": "cholinergic", "role": "dry hygrosensor"},
    "Ir68a": {"label": "Ir68a HRN", "fbbt": "FBbt_00049659", "tx": "cholinergic", "role": "humid / wet sensor"},
    "JO": {"label": "Johnston organ", "fbbt": "FBbt_00005251", "tx": "cholinergic", "role": "mechanosensory water hit"},
    "LPLC2": {"label": "LPLC2", "fbbt": "FBbt_00111763", "tx": "cholinergic", "role": "looming startle"},
    "ISN": {"label": "ISN", "fbbt": None, "tx": "interoceptive", "role": "hemolymph osmolarity"},
    "hPN": {"label": "VP hygro PN", "fbbt": "FBbt_00047227", "tx": "cholinergic", "role": "2nd-order humidity"},
    "DNp44": {"label": "DNp44", "fbbt": None, "tx": "descending", "role": "dry-escape descending"},
    "GF": {"label": "DNp01 GF", "fbbt": "FBbt_00004020", "tx": "cholinergic", "role": "jump command"},
    "DNg27": {"label": "DNg27", "fbbt": None, "tx": "glutamatergic", "role": "spiracle / flight gate"},
    "glia": {"label": "glia", "fbbt": None, "tx": "Hsp70 / K+ buffer", "role": "ion homeostasis"},
    "TTMn": {"label": "TTMn", "fbbt": "FBbt_00007406", "tx": "glutamatergic", "role": "jump motor"},
    "PSI": {"label": "PSI", "fbbt": "FBbt_00004021", "tx": "electrical from GF", "role": "flight premotor"},
    "SpMN": {"label": "SpMN", "fbbt": None, "tx": "motor", "role": "spiracle closer"},
}

# (pre, post, synapse_count or literature weight, vfb)
EDGES = (
    ("Ir40a", "hPN", 6886, True),
    ("Ir68a", "hPN", 12000, True),
    ("hPN", "DNp44", 80, False),
    ("JO", "GF", 400, False),
    ("LPLC2", "GF", 5680, True),
    ("GF", "TTMn", 375, True),
    ("GF", "PSI", 200, False),
    ("ISN", "DNg27", 120, False),
    ("DNg27", "SpMN", 80, False),
    ("DNp44", "TTMn", 40, False),
)

_EDGE_SCALE = {e[0:2]: math.log10(e[2] + 1) / 4.2 for e in EDGES}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _smooth(current: float, target: float, dt: float, tau: float) -> float:
    return current + (target - current) * (1.0 - math.exp(-dt / max(tau, 1e-6)))


def recovery_delay_s(submerged_for: float) -> float:
    """Krishnan 1997: first movement ~15 min after 2 h, ~60 min after 4 h."""
    if submerged_for <= 0:
        return 0.0
    if submerged_for <= 7200:
        return 900.0 * (submerged_for / 7200.0)
    extra = min(1.0, (submerged_for - 7200.0) / 7200.0)
    return 900.0 + 2700.0 * extra


@dataclass
class PhysioState:
    t: float = 0.0
    submerged: bool = False
    submerged_for: float = 0.0
    surfaced_for: float = 0.0
    o2: float = 21.0
    atp: float = 100.0
    k_rel: float = 1.0
    pH: float = 7.4
    survival: float = 1.0
    dead: bool = False
    recovered: bool = False
    phase: str = "Normoxia"
    note: str = "Adult fly at rest. Network is sparse and metabolically cheap."
    fire: dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in NODE_IDS})
    hz: dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in NODE_IDS})
    drive: dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in NODE_IDS})
    spikes: dict[str, list[float]] = field(default_factory=lambda: {k: [] for k in NODE_IDS})
    _spike_debt: dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in NODE_IDS})
    events: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    last_log: float = 0.0
    speed: float = 10.0
    octopamine: float = 1.0
    corazonin: float = 1.0
    akh: float = 1.0
    lactate: float = 0.0
    alanine: float = 0.0
    acetate: float = 0.0
    hsp70: float = 0.05
    ros: float = 0.05
    ampk: float = 0.1
    last_phase: str = "Normoxia"

    def excitability(self) -> float:
        atp_gate = 1.0 / (1.0 + math.exp(-(self.atp - 28.0) / 6.0))
        k_gate = 1.0 / (1.0 + math.exp((self.k_rel - 1.85) / 0.18))
        ph_gate = 1.0 / (1.0 + math.exp(-(self.pH - 6.55) / 0.12))
        return _clamp(atp_gate * k_gate * ph_gate, 0.0, 1.0)

    def mean_fire(self) -> float:
        vals = [self.fire[k] for k in NODE_IDS if k != "glia"]
        return sum(vals) / len(vals) if vals else 0.0

    def blocked(self) -> bool:
        if self.dead:
            return True
        if (not self.submerged) and self.surfaced_for > 0:
            return self.surfaced_for < recovery_delay_s(self.submerged_for)
        return False

    def snapshot(self) -> dict:
        window = 2.0
        recent = {
            nid: [t for t in times if self.t - t <= window] for nid, times in self.spikes.items()
        }
        return {
            "t": self.t,
            "submerged": self.submerged,
            "submergedFor": self.submerged_for,
            "surfacedFor": self.surfaced_for,
            "o2": self.o2,
            "atp": self.atp,
            "kRel": self.k_rel,
            "pH": self.pH,
            "survival": self.survival,
            "dead": self.dead,
            "recovered": self.recovered,
            "phase": self.phase,
            "note": self.note,
            "fire": dict(self.fire),
            "hz": dict(self.hz),
            "drive": dict(self.drive),
            "spikes": recent,
            "events": list(self.events[-24:]),
            "excitability": self.excitability(),
            "meanFire": self.mean_fire(),
            "speed": self.speed,
            "history": list(self.history[-240:]),
            "chem": {
                "octopamine": self.octopamine,
                "corazonin": self.corazonin,
                "akh": self.akh,
                "lactate": self.lactate,
                "alanine": self.alanine,
                "acetate": self.acetate,
                "hsp70": self.hsp70,
                "ros": self.ros,
                "ampk": self.ampk,
            },
            "recoveryDelay": recovery_delay_s(self.submerged_for),
            "blocked": self.blocked(),
            "nodes": NODES_META,
            "edges": [
                {"from": a, "to": b, "w": w, "vfb": vfb, "current": self.fire[a] * _EDGE_SCALE[(a, b)]}
                for a, b, w, vfb in EDGES
            ],
        }


def classify_phase(s: PhysioState) -> tuple[str, str]:
    if s.dead:
        return (
            "Irreversible failure",
            "ATP and [K+]o did not recover. Adult LT50 is ~8 h at room temperature.",
        )
    if s.blocked() and not s.submerged:
        left = recovery_delay_s(s.submerged_for) - s.surfaced_for
        return (
            "Reoxygenation block",
            f"O2 is back but the motor map is still silent for {left:.0f} s "
            "(Krishnan: first twitch scales with anoxia duration).",
        )
    if s.recovered and not s.submerged:
        return (
            "Recovered",
            "Ion gradients restored. Octopamine falling; ROS from reoxygenation still elevated.",
        )
    if not s.submerged and s.surfaced_for > 0 and s.atp < 90:
        return (
            "Reoxygenation",
            "Aerobic ATP returning. Clearing [K+]o takes minutes. ROS burst on air.",
        )
    if not s.submerged:
        return "Normoxia", "Air available. Sparse baseline spikes. Stress peptides at rest."
    if s.submerged_for < 2:
        return "Contact", "Ir68a / Ir40a / Johnston organ spike. Octopamine rising."
    if s.submerged_for < 12:
        return "Escape attempt", "JO+LPLC2 → DNp01 → TTMn jump. Spiracles closing."
    if s.submerged_for < 45:
        return (
            "Hypoxic collapse",
            "Na+/K+ ATPase slowing. Spikes irregular. Lactate/alanine/acetate starting.",
        )
    if s.submerged_for < 120:
        return "Anoxic stupor", "Spike arrest. Adult paralyzed within ~30–120 s (Krishnan 1997)."
    return (
        "Anoxic coma",
        "ATP held near 3% for hours. [K+]o ~2× at 2 h, pH 6.4. Survivable if surfaced in time.",
    )


def _push_event(s: PhysioState, text: str) -> None:
    if s.events and s.events[-1]["text"] == text:
        return
    s.events.append({"t": s.t, "phase": s.phase, "text": text})
    if len(s.events) > 40:
        s.events = s.events[-40:]


def _emit_spikes(s: PhysioState, dt: float) -> None:
    window = 2.2
    for nid in NODE_IDS:
        rate = s.hz[nid]
        times = s.spikes[nid]
        # Large protocol speeds must not unroll tens of thousands of spikes.
        span = min(dt, window)
        expected = rate * span
        n = min(int(expected + random.random()), 120)
        if n:
            for _ in range(n):
                times.append(s.t - random.random() * span)
        s._spike_debt[nid] = expected - n
        if times and (len(times) > 160 or times[0] < s.t - window):
            s.spikes[nid] = [t for t in times if s.t - t <= window]


def step(s: PhysioState, dt: float) -> None:
    if s.dead:
        s.phase, s.note = classify_phase(s)
        return

    s.t += dt
    ex = s.excitability()

    if s.submerged:
        s.submerged_for += dt
        s.surfaced_for = 0.0
        s.o2 = _smooth(s.o2, 0.05, dt, 6.0)
        if s.submerged_for < 7200:
            atp_target = max(3.0, 100.0 * math.exp(-s.submerged_for / 1400.0))
        else:
            atp_target = max(1.2, 3.0 - (s.submerged_for - 7200.0) / 20000.0)
        s.atp = _smooth(s.atp, atp_target, dt, 8.0)
        # Callier 2015: ~2× [K+]o at 2 h, ~4× at 12 h
        k_target = 1.0 + 1.0 * (1.0 - math.exp(-s.submerged_for / 3600.0))
        if s.submerged_for > 7200:
            k_target = 2.0 + 2.0 * min(1.0, (s.submerged_for - 7200.0) / 36000.0)
        s.k_rel = _smooth(s.k_rel, k_target, dt, 40.0)
        # pH 7.4 → ~6.7 in 15 min, 6.4 at 2 h
        if s.submerged_for < 900:
            ph_target = 7.4 - 0.7 * (s.submerged_for / 900.0)
        else:
            ph_target = 6.7 - 0.3 * min(1.0, (s.submerged_for - 900.0) / 6300.0)
        s.pH = _smooth(s.pH, ph_target, dt, 20.0)
        if s.submerged_for > 8 * 3600 and s.atp < 2.2 and s.k_rel > 3.4:
            s.survival = 0.0
            s.dead = True
        elif s.submerged_for > 4 * 3600:
            s.survival = _clamp(1.0 - (s.submerged_for - 4 * 3600) / (8 * 3600), 0.05, 1.0)
    else:
        s.o2 = _smooth(s.o2, 21.0, dt, 3.0)
        rec_tau = 18.0 + s.submerged_for * 0.1
        s.atp = _smooth(s.atp, 100.0, dt, rec_tau)
        s.k_rel = _smooth(s.k_rel, 1.0, dt, 12.0 + s.submerged_for * 0.08)
        s.pH = _smooth(s.pH, 7.4, dt, 40.0)
        if s.submerged_for > 0:
            s.surfaced_for += dt
        delay = recovery_delay_s(s.submerged_for)
        if s.atp > 85 and s.k_rel < 1.15 and s.surfaced_for > delay and s.submerged_for > 0:
            s.recovered = True
        if s.submerged_for > 8 * 3600 and s.k_rel > 2.8:
            s.dead = True
            s.survival = 0.0

    s.atp = _clamp(s.atp, 0.4, 100.0)
    s.o2 = _clamp(s.o2, 0.0, 21.0)
    s.k_rel = _clamp(s.k_rel, 1.0, 4.5)
    s.pH = _clamp(s.pH, 6.2, 7.4)

    contact = s.submerged and s.submerged_for < 2
    escape = s.submerged and 0.4 <= s.submerged_for < 12
    hypoxia = s.submerged and 12 <= s.submerged_for < 45
    coma = s.submerged and s.submerged_for >= 45

    # Hormones / metabolites. Fold-change vs rest except metabolites (0–1 plateau).
    if s.submerged:
        oa_target = 3.2 if contact or escape else (1.4 if hypoxia else 0.7)
        crz_target = 1.2 + 1.6 * min(1.0, s.submerged_for / 30.0)
        akh_target = 1.1 + 1.4 * min(1.0, s.submerged_for / 180.0)
        lac_target = min(0.85, s.submerged_for / 7200.0)
        ala_target = min(1.0, s.submerged_for / 5400.0)
        ace_target = min(1.0, s.submerged_for / 4800.0)
        hsp_target = min(1.0, 0.05 + s.submerged_for / 3600.0)
        ros_target = 0.08
        ampk_target = min(1.0, s.submerged_for / 600.0)
    else:
        oa_target = 1.0
        crz_target = _smooth(1.0, 1.0, 1.0, 1.0)
        crz_target = 1.0 + 0.4 * min(1.0, s.surfaced_for / 120.0) if s.submerged_for else 1.0
        akh_target = 1.0
        lac_target = max(0.0, s.lactate - s.surfaced_for / 2400.0)
        ala_target = max(0.0, s.alanine - s.surfaced_for / 3000.0)
        ace_target = max(0.0, s.acetate - s.surfaced_for / 2800.0)
        hsp_target = min(1.0, s.hsp70 + (0.25 if s.submerged_for else 0.0))
        ros_target = 0.85 if (s.submerged_for > 0 and s.surfaced_for < 90) else 0.05
        ampk_target = 0.15 if s.recovered else max(0.1, s.ampk * 0.7)
    s.octopamine = _smooth(s.octopamine, oa_target, dt, 4.0 if s.submerged else 20.0)
    s.corazonin = _smooth(s.corazonin, crz_target, dt, 12.0)
    s.akh = _smooth(s.akh, akh_target, dt, 25.0)
    s.lactate = _smooth(s.lactate, lac_target, dt, 40.0)
    s.alanine = _smooth(s.alanine, ala_target, dt, 50.0)
    s.acetate = _smooth(s.acetate, ace_target, dt, 50.0)
    s.hsp70 = _smooth(s.hsp70, hsp_target, dt, 80.0)
    s.ros = _smooth(s.ros, ros_target, dt, 6.0)
    s.ampk = _smooth(s.ampk, ampk_target, dt, 30.0)

    raw = {
        "Ir40a": 0.95 if contact else (0.18 if s.submerged else 0.05),
        "Ir68a": 1.0 if contact else (0.40 if s.submerged else 0.06),
        "JO": 0.95 if (contact or escape) else 0.07,
        "LPLC2": 0.55 if escape else 0.08,
        "ISN": 0.45 if s.submerged else 0.04,
        "hPN": 0.0,
        "DNp44": 0.0,
        "GF": 0.0,
        "DNg27": 0.0,
        "glia": 0.2 + 0.7 * _clamp((s.k_rel - 1.0) / 2.0, 0.0, 1.0),
        "TTMn": 0.0,
        "PSI": 0.0,
        "SpMN": 0.85 if s.submerged else 0.08,
    }
    # Synaptic convergence using VFB/log weights.
    raw["hPN"] = raw["Ir40a"] * _EDGE_SCALE[("Ir40a", "hPN")] + raw["Ir68a"] * _EDGE_SCALE[("Ir68a", "hPN")]
    raw["DNp44"] = raw["hPN"] * 0.85
    raw["GF"] = raw["LPLC2"] * _EDGE_SCALE[("LPLC2", "GF")] + raw["JO"] * 0.7
    raw["GF"] *= 0.7 + 0.25 * _clamp(s.octopamine - 1.0, 0.0, 2.0)
    raw["DNg27"] = raw["ISN"] * 0.8 + 0.25 * _clamp(s.corazonin - 1.0, 0.0, 2.0)
    raw["TTMn"] = raw["GF"] * _EDGE_SCALE[("GF", "TTMn")] * 1.15 + raw["DNp44"] * 0.25
    raw["PSI"] = raw["GF"] * 0.7
    raw["SpMN"] = max(raw["SpMN"], raw["DNg27"] * 0.7)

    blocked = s.blocked()
    for nid in NODE_IDS:
        f = raw[nid] * (1.0 if nid == "glia" else ex)
        if hypoxia and nid != "glia":
            f *= 0.4 + 0.45 * random.random()
        if coma and nid != "glia":
            f *= 0.03
        if blocked and nid != "glia":
            f *= 0.08
        s.drive[nid] = raw[nid]
        s.fire[nid] = _clamp(f, 0.0, 1.0)
        s.hz[nid] = s.fire[nid] * MAX_HZ[nid]

    _emit_spikes(s, dt)
    s.phase, s.note = classify_phase(s)

    if s.phase != s.last_phase:
        _push_event(s, f"Phase -> {s.phase}")
        s.last_phase = s.phase
    if contact:
        _push_event(s, f"Ir68a {s.hz['Ir68a']:.0f} Hz + JO {s.hz['JO']:.0f} Hz (water contact)")
    if escape and s.hz["GF"] > 20:
        _push_event(
            s,
            f"JO+LPLC2 -> GF {s.hz['GF']:.0f} Hz -> TTMn {s.hz['TTMn']:.0f} Hz "
            f"(octopamine {s.octopamine:.1f}x)",
        )
    if coma and s.hz["GF"] < 5:
        _push_event(s, "Giant-fiber -> muscle EPSP silent (Krishnan 1997)")

    if s.t - s.last_log >= 0.25:
        s.history.append(
            {
                "t": s.t,
                "o2": s.o2,
                "atp": s.atp,
                "k": s.k_rel,
                "fire": s.mean_fire(),
                "oa": s.octopamine,
                "crz": s.corazonin,
                "ros": s.ros,
                "lac": s.lactate,
            }
        )
        if len(s.history) > 240:
            s.history = s.history[-240:]
        s.last_log = s.t


def reset_state(s: PhysioState) -> None:
    s.t = 0.0
    s.submerged = False
    s.submerged_for = 0.0
    s.surfaced_for = 0.0
    s.o2 = 21.0
    s.atp = 100.0
    s.k_rel = 1.0
    s.pH = 7.4
    s.survival = 1.0
    s.dead = False
    s.recovered = False
    s.phase = "Normoxia"
    s.note = "Adult fly at rest. Network is sparse and metabolically cheap."
    s.fire = {k: 0.0 for k in NODE_IDS}
    s.hz = {k: 0.0 for k in NODE_IDS}
    s.drive = {k: 0.0 for k in NODE_IDS}
    s.spikes = {k: [] for k in NODE_IDS}
    s._spike_debt = {k: 0.0 for k in NODE_IDS}
    s.events = []
    s.history = []
    s.last_log = 0.0
    s.octopamine = 1.0
    s.corazonin = 1.0
    s.akh = 1.0
    s.lactate = 0.0
    s.alanine = 0.0
    s.acetate = 0.0
    s.hsp70 = 0.05
    s.ros = 0.05
    s.ampk = 0.1
    s.last_phase = "Normoxia"
