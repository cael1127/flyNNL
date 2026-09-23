"""Interval VFBquery poller. Refreshes data/circuit.json every few minutes."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://v3-cached.virtualflybrain.org"
ROOT = Path(__file__).resolve().parent.parent
CIRCUIT_PATH = ROOT / "data" / "circuit.json"
POLL_SECONDS = 8 * 60

QUERIES = {
    "LPLC2_GF": {
        "from": "LPLC2",
        "to": "GF",
        "params": {
            "upstream_type": "LPLC2",
            "downstream_type": "giant fiber neuron",
            "weight": "5",
        },
    },
    "GF_TTMn": {
        "from": "GF",
        "to": "TTMn",
        "params": {
            "upstream_type": "FBbt_00004020",
            "downstream_type": "FBbt_00007406",
            "weight": "3",
        },
    },
    "HRN_hPN": {
        "from": "HRN",
        "to": "hPN",
        "params": {
            "upstream_type": "FBbt_00005923",
            "downstream_type": "FBbt_00047227",
            "weight": "5",
        },
    },
    "Ir40a_hPN": {
        "from": "Ir40a",
        "to": "hPN",
        "params": {
            "upstream_type": "FBbt_00110990",
            "downstream_type": "FBbt_00047227",
            "weight": "5",
        },
    },
}


class VfbCache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.circuit: dict = {}
        self.last_ok: float | None = None
        self.last_error: str | None = None
        self.polling = False
        self.load_disk()

    def load_disk(self) -> None:
        if CIRCUIT_PATH.exists():
            try:
                self.circuit = json.loads(CIRCUIT_PATH.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                self.circuit = {}

    def snapshot(self) -> dict:
        with self.lock:
            age = None if self.last_ok is None else time.time() - self.last_ok
            rows = []
            for edge in self.circuit.get("vfb_edges", []):
                sources = edge.get("sources") or {}
                src = " · ".join(f"{k} {v}" for k, v in sources.items())
                rows.append(
                    [
                        f"{edge.get('from')} → {edge.get('to')}",
                        str(edge.get("pairs", "")),
                        f"{edge.get('synapses', 0):,}",
                        str(edge.get("weight_max", "")),
                        src,
                    ]
                )
            return {
                "queried": self.circuit.get("queried"),
                "lastOk": self.last_ok,
                "ageSeconds": age,
                "polling": self.polling,
                "error": self.last_error,
                "intervalSeconds": POLL_SECONDS,
                "rows": rows,
                "edges": self.circuit.get("vfb_edges", []),
                "engine": self.circuit.get("engine", "unknown"),
            }


def _get(path: str, params: dict, timeout: int = 90) -> dict:
    qs = urllib.parse.urlencode(params)
    url = f"{BASE}{path}?{qs}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def _summarize(name: str, spec: dict, data: dict) -> dict:
    conns = data.get("connections") or []
    resolved = data.get("resolved") or {}
    up = resolved.get("upstream") or {}
    down = resolved.get("downstream") or {}
    top = sorted(conns, key=lambda c: -c.get("weight", 0))[:5]
    return {
        "from": spec["from"],
        "to": spec["to"],
        "pairs": data.get("count", len(conns)),
        "synapses": sum(c.get("weight", 0) for c in conns),
        "up_instances": up.get("instances"),
        "down_instances": down.get("instances"),
        "unique_up": len({c.get("upstream_neuron_id") for c in conns}),
        "unique_down": len({c.get("downstream_neuron_id") for c in conns}),
        "weight_max": max((c.get("weight", 0) for c in conns), default=0),
        "sources": dict(Counter(c.get("up_data_source") for c in conns)),
        "top": [
            {
                "w": c.get("weight"),
                "up": c.get("upstream_neuron_name"),
                "up_id": c.get("upstream_neuron_id"),
                "down": c.get("downstream_neuron_name"),
                "down_id": c.get("downstream_neuron_id"),
            }
            for c in top
        ],
        "query": name,
    }


def poll_once(cache: VfbCache) -> None:
    cache.polling = True
    edges = []
    try:
        for name, spec in QUERIES.items():
            data = _get("/query_connectivity", spec["params"])
            edges.append(_summarize(name, spec, data))
        payload = {
            "title": "Forced-submersion circuit on VFB connectomes",
            "queried": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "api": BASE,
            "exclude_dbs_default": ["hb", "fafb"],
            "vfb_edges": edges,
        }
        if CIRCUIT_PATH.exists():
            old = json.loads(CIRCUIT_PATH.read_text(encoding="utf-8"))
            for key in ("datasets", "classes"):
                if key in old:
                    payload[key] = old[key]
        CIRCUIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        CIRCUIT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with cache.lock:
            cache.circuit = payload
            cache.last_ok = time.time()
            cache.last_error = None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        with cache.lock:
            cache.last_error = f"{type(exc).__name__}: {exc}"
    finally:
        cache.polling = False


def start_poller(cache: VfbCache) -> threading.Thread:
    def loop() -> None:
        poll_once(cache)
        while True:
            time.sleep(POLL_SECONDS)
            poll_once(cache)

    t = threading.Thread(target=loop, name="vfb-poller", daemon=True)
    t.start()
    return t
