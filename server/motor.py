"""Map live spike rates onto FlyGym position-actuator targets."""

from __future__ import annotations

import math

import numpy as np

from .physiology import PhysioState


class MotorMapper:
    """Gain-modulated CPG + TTMn jump + limp. Drive comes from Hz, not a pose clip."""

    def __init__(self, dofs: list, neutrals: np.ndarray) -> None:
        self.dofs = dofs
        self.neutral = np.asarray(neutrals, dtype=np.float64)
        self.n = len(dofs)
        self._meta: list[tuple[str, str, str]] = []
        for dof in dofs:
            pos = getattr(dof.child, "pos", "")
            link = getattr(dof.child, "link", "")
            axis = getattr(dof.axis, "value", str(dof.axis))
            self._meta.append((pos, link, axis))

    def targets(self, t_vis: float, physio: PhysioState) -> np.ndarray:
        ex = physio.excitability()
        tt = physio.hz.get("TTMn", 0.0) / 90.0
        psi = physio.hz.get("PSI", 0.0) / 70.0
        oa = physio.octopamine
        limp = physio.dead or physio.blocked() or ex < 0.08
        contact = physio.submerged and physio.submerged_for < 2
        escape = physio.submerged and 0.4 <= physio.submerged_for < 12
        hypoxia = physio.submerged and 12 <= physio.submerged_for < 45
        recovering = (not physio.submerged) and physio.surfaced_for > 0 and not physio.recovered

        if limp:
            freq = 0.4
            amp = 0.02
        elif recovering:
            freq = 1.6
            amp = 0.06 * ex
        elif contact:
            freq = 12.0 + 2.0 * oa
            amp = 0.45 + 0.12 * (oa - 1.0)
        elif escape:
            freq = 8.0 + 4.0 * tt
            amp = 0.28 * ex * (0.7 + 0.3 * oa)
        elif hypoxia:
            freq = 3.0 + 5.0 * ex
            amp = 0.14 * ex
        else:
            freq = 6.5
            amp = 0.26 * max(ex, 0.15)

        phase = 2.0 * math.pi * freq * t_vis
        out = self.neutral.copy()

        for i, (pos, link, axis) in enumerate(self._meta):
            trip = 0.0 if pos in {"lf", "rm", "lh"} else math.pi
            scale = 1.0 if axis == "pitch" else 0.45
            if limp:
                droop = 0.35 if link in {"trochanterfemur", "tibia"} else 0.1
                out[i] = self.neutral[i] + droop * (1.0 if axis == "pitch" else 0.2)
                out[i] += 0.015 * math.sin(phase + i * 0.3)
                continue

            out[i] = self.neutral[i] + amp * scale * math.sin(phase + trip)

            if escape and pos in {"lm", "rm"}:
                kick = 0.62 * min(1.0, tt)
                if link in {"trochanterfemur", "tibia"}:
                    out[i] = self.neutral[i] - kick
                elif link == "coxa" and axis == "pitch":
                    out[i] = self.neutral[i] + 0.4 * kick

            if escape and psi > 0.2 and pos in {"lf", "rf"}:
                out[i] += 0.18 * psi * math.sin(phase * 2.0)

            if contact:
                out[i] += 0.10 * math.sin(phase * 1.7 + i)

        return out
