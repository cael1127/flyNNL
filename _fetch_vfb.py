import json
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

# Summarize already-downloaded LPLC2 -> GF
src = Path(r"C:\Users\Cael\.cursor\projects\c-Users-Cael-Desktop-flyNNL\agent-tools\65d0e37d-a13f-47c9-bf9f-fbf55fa5c887.txt")
with src.open(encoding="utf-8") as f:
    d = json.load(f)

conns = d["connections"]
summary = {
    "pair": "LPLC2 -> giant fiber neuron",
    "count": d["count"],
    "excluded_dbs": d.get("excluded_dbs"),
    "resolved": d.get("resolved"),
    "warnings": d.get("warnings"),
    "weight_min": min(c["weight"] for c in conns),
    "weight_max": max(c["weight"] for c in conns),
    "weight_sum": sum(c["weight"] for c in conns),
    "unique_upstream": len({c["upstream_neuron_id"] for c in conns}),
    "unique_downstream": len({c["downstream_neuron_id"] for c in conns}),
    "sources": dict(Counter(c["up_data_source"] for c in conns)),
    "top": [
        {
            "weight": c["weight"],
            "up": c["upstream_neuron_name"],
            "up_id": c["upstream_neuron_id"],
            "down": c["downstream_neuron_name"],
            "down_id": c["downstream_neuron_id"],
            "source": c["up_data_source"],
        }
        for c in sorted(conns, key=lambda x: -x["weight"])[:20]
    ],
}
print(json.dumps(summary, indent=2))
(OUT / "lplc2_gf_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

# Compact edges for the sim (top 40 + class totals)
compact = {
    "pair": summary["pair"],
    "class_ids": {
        "upstream": "FBbt_00111763",
        "downstream": "FBbt_00004020",
    },
    "n_connections": d["count"],
    "n_upstream": summary["unique_upstream"],
    "n_downstream": summary["unique_downstream"],
    "synapse_sum": summary["weight_sum"],
    "sources": summary["sources"],
    "edges": summary["top"],
}
(OUT / "lplc2_gf.json").write_text(json.dumps(compact, indent=2), encoding="utf-8")

BASE = "https://v3-cached.virtualflybrain.org"


def get(path, params, timeout=90):
    qs = urllib.parse.urlencode(params)
    url = f"{BASE}{path}?{qs}"
    print("GET", url)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


queries = [
    ("gf_ttmn", {"upstream_type": "FBbt_00004020", "downstream_type": "FBbt_00007406", "weight": "3"}),
    ("hrn_hpn", {"upstream_type": "FBbt_00005923", "downstream_type": "FBbt_00047227", "weight": "5"}),
    ("ir40a_hpn", {"upstream_type": "FBbt_00110990", "downstream_type": "FBbt_00047227", "weight": "5"}),
    ("lplc2_gf_grouped", {"upstream_type": "LPLC2", "downstream_type": "giant fiber neuron", "group_by_class": "true"}),
]

for name, params in queries:
    try:
        data = get("/query_connectivity", params)
        conns = data.get("connections") or []
        compact_q = {
            "name": name,
            "params": params,
            "count": data.get("count", len(conns)),
            "resolved": data.get("resolved"),
            "warnings": data.get("warnings"),
            "excluded_dbs": data.get("excluded_dbs"),
            "weight_sum": sum(c.get("weight", 0) for c in conns),
            "unique_up": len({c.get("upstream_neuron_id") for c in conns}),
            "unique_down": len({c.get("downstream_neuron_id") for c in conns}),
            "sources": dict(Counter(c.get("up_data_source") for c in conns)),
            "top": sorted(conns, key=lambda x: -x.get("weight", 0))[:15],
        }
        (OUT / f"{name}.json").write_text(json.dumps(compact_q, indent=2), encoding="utf-8")
        print(name, "ok", compact_q["count"], "sum", compact_q["weight_sum"])
    except Exception as e:
        print(name, "FAIL", type(e).__name__, e)
        (OUT / f"{name}_error.txt").write_text(str(e), encoding="utf-8")

print("done")
