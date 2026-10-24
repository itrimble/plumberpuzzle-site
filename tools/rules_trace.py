#!/usr/bin/env python3
"""Replay seeded random rotations on the demo's boards with the game's own model.

Prints JSON: per level, a list of states (the rotation string after each move) with
the game's solve_flow steps, is_won and first pressure dead end. tools/test_rules.mjs
replays the same moves through play/rules.js and must match every state.
usage: python3 -B tools/rules_trace.py [--game "~/projects/Pipe Flow/PlumberPuzzle"]
"""
import argparse
import json
import random
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--game", default="~/projects/Pipe Flow/PlumberPuzzle")
game = Path(ap.parse_args().game).expanduser()
sys.path.insert(0, str(game / "godot" / "tools"))
import reference_model as rm  # noqa: E402

site = Path(__file__).resolve().parent.parent
levels_js = (site / "play" / "levels.js").read_text()
demo = json.loads(levels_js[levels_js.index("["):levels_js.rindex("]") + 1])
by_id = {lv.id: lv for lv in rm.load_levels()}
rng = random.Random(20261023)
out = []
for lv in demo:
    board = by_id[lv["id"]].make_board()
    assert rm.rot_string(board) == lv["start"], f"levels.js is stale for level {lv['id']}"
    canon = by_id[lv["id"]].make_canonical()
    rotatable = [i for i, t in enumerate(board.tiles) if rm.can_rotate(t.kind) and not t.fixed]

    def state(b, move):
        w = b.width
        def idx(p): return p[1] * w + p[0]
        flow = [[idx(s["pos"]), s["distance"], s["flow_dx"], s["flow_dy"]] for s in b.solve_flow()]
        dead = None
        best = None
        dist = {}
        for s in b.solve_flow():
            dist.setdefault(s["pos"], s["distance"])
        for p in b.pressure_dead_ends():
            if best is None or dist[p] < best:
                best, dead = dist[p], idx(p)
        return {"move": move, "rot": rm.rot_string(b), "flow": flow, "won": b.is_won(), "dead": dead}

    states = [state(board, None), state(canon, "solved")]
    for _ in range(400):
        i = rng.choice(rotatable)
        board.tiles[i].rotate()
        states.append(state(board, i))
    out.append({"id": lv["id"], "states": states})
json.dump(out, sys.stdout)
