"""Tethered NeuroMechFly scene with rising water and JPEG frames."""

from __future__ import annotations

import io
import threading
import time
from typing import Any

import numpy as np
from PIL import Image

from .motor import MotorMapper
from .physiology import PhysioState, reset_state, step as physio_step

ENGINE = "unavailable"
_INIT_ERROR: str | None = None


def _try_import() -> dict[str, Any] | None:
    global ENGINE, _INIT_ERROR
    try:
        from flygym import Simulation
        from flygym.anatomy import ActuatedDOFPreset, AxisOrder, JointPreset, Skeleton
        from flygym.compose.fly import ActuatorType, NeuroMechFly
        from flygym.compose.pose import KinematicPosePreset
        from flygym.compose.world import TetheredWorld
        from flygym.utils.math import Rotation3D
        from flygym.utils.mjcf import CAMERA_MODES, GEOM_TYPES
        import mujoco as mj

        ENGINE = "flygym-NeuroMechFly"
        return {
            "Simulation": Simulation,
            "ActuatedDOFPreset": ActuatedDOFPreset,
            "AxisOrder": AxisOrder,
            "JointPreset": JointPreset,
            "Skeleton": Skeleton,
            "ActuatorType": ActuatorType,
            "NeuroMechFly": NeuroMechFly,
            "KinematicPosePreset": KinematicPosePreset,
            "TetheredWorld": TetheredWorld,
            "Rotation3D": Rotation3D,
            "GEOM_TYPES": GEOM_TYPES,
            "CAMERA_MODES": CAMERA_MODES,
            "mj": mj,
        }
    except Exception as exc:  # noqa: BLE001
        ENGINE = "fallback-unavailable"
        _INIT_ERROR = f"{type(exc).__name__}: {exc}"
        return None


class FlySim:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.physio = PhysioState()
        self.latest_jpeg = b""
        self.engine = ENGINE
        self.error = _INIT_ERROR
        self._api = None
        self.ready = False
        self._t_vis = 0.0
        self._water_id: int | None = None
        self._cam_id = 0
        self._built = False

    def start(self) -> None:
        """Build MuJoCo + GL on the thread that will render."""
        if self._built:
            return
        self._api = _try_import()
        self.engine = ENGINE
        self.error = _INIT_ERROR
        if self._api is None:
            return
        try:
            self._build()
            self.ready = True
            self._built = True
        except Exception as exc:  # noqa: BLE001
            self.error = f"{type(exc).__name__}: {exc}"
            self.engine = "init-failed"
            self.ready = False

    def _build(self) -> None:
        api = self._api
        assert api is not None
        fly = api["NeuroMechFly"](name="nmf")
        skel = api["Skeleton"](
            axis_order=api["AxisOrder"].PITCH_ROLL_YAW,
            joint_preset=api["JointPreset"].LEGS_ONLY,
        )
        fly.add_joints(skel, neutral_pose=api["KinematicPosePreset"].NEUTRAL)
        dofs = skel.get_actuated_dofs_from_preset(api["ActuatedDOFPreset"].LEGS_ACTIVE_ONLY)
        fly.add_actuators(
            dofs,
            api["ActuatorType"].POSITION,
            neutral_input=api["KinematicPosePreset"].NEUTRAL,
            kp=35.0,
        )
        fly.colorize()

        world = api["TetheredWorld"](name="submersion")
        for tex in world.mjcf_root.textures:
            if tex.name == "skybox":
                tex.rgb1 = (0.07, 0.08, 0.10)
                tex.rgb2 = (0.16, 0.17, 0.19)
        wb = world.mjcf_root.worldbody
        gtypes = api["GEOM_TYPES"]
        cam_modes = api["CAMERA_MODES"]
        side_cam = wb.add_camera(
            name="side",
            mode=cam_modes["fixed"],
            pos=[0.5, -4.6, 2.45],
            xyaxes=[1, 0, 0, 0, 0, 1],
            fovy=40,
        )
        wb.add_geom(
            name="floor",
            type=gtypes["plane"],
            size=[0, 0, 0.1],
            pos=[0, 0, -1.6],
            rgba=[0.16, 0.17, 0.19, 1],
            contype=0,
            conaffinity=0,
        )
        wb.add_geom(
            name="fixture",
            type=gtypes["box"],
            size=[0.08, 0.08, 0.45],
            pos=[0.5, 0, 3.35],
            rgba=[0.42, 0.40, 0.36, 1],
            contype=0,
            conaffinity=0,
        )
        wb.add_geom(
            name="water",
            type=gtypes["box"],
            size=[10.0, 10.0, 2.2],
            pos=[0, 0, -2.8],
            rgba=[0.20, 0.52, 0.62, 0.55],
            contype=0,
            conaffinity=0,
            group=1,
        )
        world.add_fly(
            fly,
            spawn_position=(0.0, 0.0, 1.15),
            spawn_rotation=api["Rotation3D"]("quat", (1, 0, 0, 0)),
        )

        sim = api["Simulation"](world, timestep=0.0002)
        renderer = sim.set_renderer(
            side_cam,
            camera_res=(320, 480),
            buffer_frames=False,
            playback_speed=1.0,
            output_fps=20,
        )
        api["mj"].mj_forward(sim.mj_model, sim.mj_data)
        neutrals = np.array(
            [fly.jointdof_to_neutralangle.get(d, 0.0) for d in dofs],
            dtype=np.float64,
        )
        self.sim = sim
        self.fly = fly
        self.renderer = renderer
        self.dofs = dofs
        self.mapper = MotorMapper(dofs, neutrals)
        self.act_type = api["ActuatorType"].POSITION
        self._cam_id = next(iter(renderer._cameras_names2id.values()))
        self._water_id = self._find_geom("water")
        self._render_jpeg()

    def _find_geom(self, suffix: str) -> int | None:
        model = self.sim.mj_model
        for i in range(model.ngeom):
            name = model.geom(i).name
            if name.endswith(suffix) or name == suffix:
                return i
        return None

    def _set_water(self, submerged: bool, submerged_for: float) -> None:
        if self._water_id is None:
            return
        # Rise from below the fly to cover thorax/head (~z=1.2).
        if not submerged:
            z = -2.8
        else:
            rise = min(1.0, submerged_for / 1.8)
            z = -2.8 + rise * 5.2
        self.sim.mj_model.geom_pos[self._water_id, 2] = z

    def _render_jpeg(self) -> None:
        if not hasattr(self, "renderer"):
            return
        r = self.renderer
        r.mj_renderer.update_scene(self.sim.mj_data, self._cam_id)
        rgb = r.mj_renderer.render()
        img = Image.fromarray(np.asarray(rgb))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=68)
        self.latest_jpeg = buf.getvalue()

    def tick(self, real_dt: float) -> None:
        with self.lock:
            dt = min(0.05, max(0.0, real_dt))
            self._t_vis += dt
            physio_dt = dt * max(0.1, self.physio.speed)
            physio_step(self.physio, physio_dt)
            if not self.ready:
                return
            self._set_water(self.physio.submerged, self.physio.submerged_for)
            targets = self.mapper.targets(self._t_vis, self.physio)
            n_phys = 8 if self.physio.speed < 100 else 4
            for _ in range(n_phys):
                self.sim.set_actuator_inputs(self.fly.name, self.act_type, targets)
                self.sim.step()
            self._render_jpeg()

    def protocol(self, action: str, speed: float | None = None) -> None:
        with self.lock:
            if speed is not None:
                self.physio.speed = float(speed)
            if action == "submerge":
                self.physio.submerged = True
                self.physio.recovered = False
            elif action == "surface":
                self.physio.submerged = False
            elif action == "reset":
                reset_state(self.physio)
                self._t_vis = 0.0
                if self.ready:
                    self.sim.reset()
                    self._set_water(False, 0.0)
                    self._render_jpeg()


def run_loop(sim: FlySim, stop: threading.Event) -> None:
    sim.start()
    last = time.perf_counter()
    while not stop.is_set():
        now = time.perf_counter()
        sim.tick(now - last)
        last = now
        time.sleep(0.03)
