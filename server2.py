# Ethereum SSF / LMD-GHOST research prototype (backend v2)
# Features:
#  - slots & epochs
#  - delayed vote delivery (simulated network latency)
#  - LMD-GHOST head selection using validators' latest messages
#  - Single Slot Finality (SSF): block may be finalized in the same slot if quorum reached
#  - fork attacks simulation, metrics endpoint
#
# Usage:
#   pip install flask flask-cors
#   python server2.py
#
# Author: Architecto0r

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import random
import time
import math
import threading

app = Flask(__name__, static_folder=".")
CORS(app)

# ----------------------
# Configurable parameters
# ----------------------
NUM_VALIDATORS = 19         # total validators (use odd for nicer quorums)
SLOTS_PER_EPOCH = 8         # small epochs for demo
SLOT_TIME_SEC = 1           # logical slot duration (seconds) — scaled for UI
QUORUM_RATIO = 2/3.0        # 2/3 quorum for finalization
MAX_DELAY_SLOTS = 2         # max simulated network delay in slots (0..MAX)
FORK_ATTACK_PROB = 0.12     # probability to spawn forked alternative block at simulate_slot
RANDOM_SEED = 42
random.seed(RANDOM_SEED)

# ----------------------
# State
# ----------------------
state_lock = threading.Lock()

current_slot = 0
current_epoch = 0

validators = [
    {
        "id": i,
        "faulty": False,
        "slashed": False,
        # last_message: {"slot": int, "block_id": str}
        "latest_message": None
    }
    for i in range(NUM_VALIDATORS)
]

# Chain storage:
# block_id -> block dict
# block dict: {
#   "id": str, "slot": int, "parent": str or None,
#   "votes_received": set(validator_ids that have been applied to this block),
#   "finalized": bool,
#   "proposer": int
# }
chain = {}
# maintain mapping: slot -> list of block_ids (supports forks)
blocks_in_slot = {}

# Vote delivery queue: list of events {deliver_slot, validator_id, block_id}
# Votes are applied when current_slot >= deliver_slot
vote_events = []

# Metrics
metrics = {
    "total_slots_simulated": 0,
    "total_forks": 0,
    "total_finalizations": 0
}

# Genesis block
def init_genesis():
    genesis = {
        "id": "genesis",
        "slot": 0,
        "parent": None,
        "votes_received": set(),
        "finalized": True,
        "proposer": None
    }
    chain["genesis"] = genesis
    blocks_in_slot[0] = ["genesis"]

init_genesis()

# ----------------------
# Helpers: chain & tree utils
# ----------------------
def make_block_id(slot, idx):
    return f"{slot}:{idx}"

def add_block(slot, parent_id, proposer):
    idx = len(blocks_in_slot.get(slot, []))
    bid = make_block_id(slot, idx)
    block = {
        "id": bid,
        "slot": slot,
        "parent": parent_id,
        "votes_received": set(),
        "finalized": False,
        "proposer": proposer
    }
    chain[bid] = block
    blocks_in_slot.setdefault(slot, []).append(bid)
    return block

def get_blocks_slot(slot):
    return blocks_in_slot.get(slot, [])

def get_block(block_id):
    return chain.get(block_id)

def ancestry(block_id):
    """Return list of ancestors up to genesis (inclusive), newest->oldest (block -> ... -> genesis)"""
    res = []
    cur = block_id
    while cur:
        b = chain.get(cur)
        if not b:
            break
        res.append(cur)
        cur = b["parent"]
    return res

def subtree_members(root_id):
    """Return set of block_ids in subtree rooted at root_id (including root)"""
    out = set()
    stack = [root_id]
    while stack:
        x = stack.pop()
        if x in out:
            continue
        out.add(x)
        for b in chain.values():
            if b["parent"] == x:
                stack.append(b["id"])
    return out

# ----------------------
# LMD-GHOST logic (demo)
# ----------------------
def lmd_ghost_head():
    root = "genesis"
    if not any(b for b in chain.values() if b["parent"] == root):
        return root
    cur = root
    while True:
        children = [b["id"] for b in chain.values() if b["parent"] == cur]
        if not children:
            return cur
        best_child = None
        best_weight = -1
        for child in children:
            subtree = subtree_members(child)
            weight = 0
            for v in validators:
                msg = v.get("latest_message")
                if msg and msg.get("block_id") in subtree:
                    weight += 1
            if weight > best_weight:
                best_weight = weight
                best_child = child
            elif weight == best_weight and best_child is not None:
                max_slot_curr = max([chain[x]["slot"] for x in subtree])
                max_slot_best = max([chain[x]["slot"] for x in subtree_members(best_child)])
                if max_slot_curr > max_slot_best:
                    best_child = child
        if best_child is None:
            return cur
        cur = best_child

# ----------------------
# Vote processing
# ----------------------
def schedule_votes_for_block(block_id, origin_slot):
    for v in validators:
        if v["faulty"] or v.get("slashed"):
            continue
        d = random.randint(0, MAX_DELAY_SLOTS)
        deliver_slot = origin_slot + d
        if d == 0:
            target = block_id
        else:
            if random.random() < 0.5:
                target = block_id
            else:
                target = lmd_ghost_head()
        vote_events.append({
            "deliver_slot": deliver_slot,
            "validator": v["id"],
            "block_id": target,
            "origin_slot": origin_slot
        })

def apply_due_votes():
    global vote_events
    to_apply = [e for e in vote_events if e["deliver_slot"] <= current_slot]
    vote_events = [e for e in vote_events if e["deliver_slot"] > current_slot]
    applied = []
    for e in to_apply:
        vid = e["validator"]
        bid = e["block_id"]
        if bid not in chain:
            if chain:
                bid = max(chain.keys(), key=lambda k: (chain[k]["slot"], k))
            else:
                bid = "genesis"
        validators[vid]["latest_message"] = {"slot": current_slot, "block_id": bid}
        chain[bid]["votes_received"].add(vid)
        applied.append((vid, bid))
    return applied

# ----------------------
# Finalization check (SSF)
# ----------------------
def try_finalize_block(block):
    if block["finalized"]:
        return False
    votes = len(block["votes_received"])
    quorum_needed = math.ceil(NUM_VALIDATORS * QUORUM_RATIO)
    if votes >= quorum_needed:
        block["finalized"] = True
        metrics["total_finalizations"] += 1
        return True
    return False

# ----------------------
# Slot simulation
# ----------------------
def simulate_one_slot(simulate_fork_attack=False):
    global current_slot, current_epoch
    with state_lock:
        current_slot += 1
        if current_slot % SLOTS_PER_EPOCH == 0:
            current_epoch += 1
        metrics["total_slots_simulated"] += 1

        applied_votes = apply_due_votes()

        proposer = random.randint(0, NUM_VALIDATORS - 1)
        parent = lmd_ghost_head()

        new_blocks = []
        if simulate_fork_attack and random.random() < FORK_ATTACK_PROB:
            num_forks = random.randint(1, 3)
            for i in range(num_forks):
                b = add_block(current_slot, parent, proposer)
                new_blocks.append(b)
            metrics["total_forks"] += num_forks - 1
        else:
            b = add_block(current_slot, parent, proposer)
            new_blocks.append(b)

        for b in new_blocks:
            schedule_votes_for_block(b["id"], origin_slot=current_slot)

        newly_applied = apply_due_votes()

        for b in new_blocks:
            try_finalize_block(b)

        for slot, bids in blocks_in_slot.items():
            for bid in bids:
                b = chain[bid]
                try_finalize_block(b)

        return {
            "slot": current_slot,
            "created_blocks": [b["id"] for b in new_blocks],
            "applied_votes": applied_votes + newly_applied
        }

# ----------------------
# API endpoints
# ----------------------
@app.route("/status", methods=["GET"])
def status():
    with state_lock:
        chain_view = {}
        for bid, b in chain.items():
            chain_view[bid] = {
                "id": bid,
                "slot": b["slot"],
                "parent": b["parent"],
                "finalized": b["finalized"],
                "votes_count": len(b["votes_received"]) if b.get("votes_received") else 0,
                "proposer": b["proposer"]
            }
        validators_view = []
        for v in validators:
            validators_view.append({
                "id": v["id"],
                "faulty": v["faulty"],
                "slashed": v.get("slashed", False),
                "latest_message": v.get("latest_message")
            })
        pending_votes = [
            {"deliver_slot": e["deliver_slot"], "validator": e["validator"], "block_id": e["block_id"]}
            for e in vote_events
        ]
        return jsonify({
            "current_slot": current_slot,
            "current_epoch": current_epoch,
            "validators": validators_view,
            "chain": chain_view,
            "blocks_in_slot": blocks_in_slot,
            "head": lmd_ghost_head(),
            "pending_votes": pending_votes,
            "metrics": metrics
        })

@app.route("/simulate_slot", methods=["POST"])
def api_simulate_slot():
    payload = request.get_json(force=True, silent=True) or {}
    attack = bool(payload.get("attack", False))
    res = simulate_one_slot(simulate_fork_attack=attack)
    return jsonify(res)

@app.route("/toggle_fault", methods=["POST"])
def api_toggle_fault():
    data = request.get_json(force=True)
    vid = data.get("id")
    if vid is None or not (0 <= vid < NUM_VALIDATORS):
        return jsonify({"error": "invalid validator id"}), 400
    with state_lock:
        validators[vid]["faulty"] = not validators[vid]["faulty"]
        return jsonify({"ok": True, "validator": validators[vid]})

@app.route("/metrics", methods=["GET"])
def api_metrics():
    with state_lock:
        total_blocks = len(chain)
        total_finalized = sum(1 for b in chain.values() if b["finalized"])
        avg_votes_per_block = (
            sum(len(b["votes_received"]) for b in chain.values()) / total_blocks
        ) if total_blocks else 0
        return jsonify({
            "current_slot": current_slot,
            "total_blocks": total_blocks,
            "total_finalized": total_finalized,
            "avg_votes_per_block": avg_votes_per_block,
            "total_forks": metrics["total_forks"],
            "total_slots_simulated": metrics["total_slots_simulated"],
            "total_finalizations": metrics["total_finalizations"]
        })

@app.route("/config", methods=["GET", "POST"])
def api_config():
    global MAX_DELAY_SLOTS, FORK_ATTACK_PROB, QUORUM_RATIO
    if request.method == "GET":
        return jsonify({
            "NUM_VALIDATORS": NUM_VALIDATORS,
            "SLOTS_PER_EPOCH": SLOTS_PER_EPOCH,
            "SLOT_TIME_SEC": SLOT_TIME_SEC,
            "QUORUM_RATIO": QUORUM_RATIO,
            "MAX_DELAY_SLOTS": MAX_DELAY_SLOTS,
            "FORK_ATTACK_PROB": FORK_ATTACK_PROB
        })
    else:
        data = request.get_json(force=True)
        if "max_delay_slots" in data:
            MAX_DELAY_SLOTS = int(data["max_delay_slots"])
        if "fork_attack_prob" in data:
            FORK_ATTACK_PROB = float(data["fork_attack_prob"])
        if "quorum_ratio" in data:
            QUORUM_RATIO = float(data["quorum_ratio"])
        return jsonify({"ok": True, "config": {"MAX_DELAY_SLOTS": MAX_DELAY_SLOTS, "FORK_ATTACK_PROB": FORK_ATTACK_PROB, "QUORUM_RATIO": QUORUM_RATIO}})

@app.route("/simulate_attack", methods=["POST"])
def api_simulate_attack():
    data = request.get_json(force=True, silent=True) or {}
    count = int(data.get("slots", 5))
    results = []
    for _ in range(count):
        results.append(simulate_one_slot(simulate_fork_attack=True))
    return jsonify({"ran": count, "results": results})

@app.route("/reset", methods=["POST"])
def api_reset():
    global current_slot, current_epoch, chain, blocks_in_slot, vote_events, validators, metrics
    with state_lock:
        current_slot = 0
        current_epoch = 0
        validators = [{"id": i, "faulty": False, "slashed": False, "latest_message": None} for i in range(NUM_VALIDATORS)]
        chain = {}
        blocks_in_slot = {}
        init_genesis()
        vote_events = []
        metrics = {"total_slots_simulated": 0, "total_forks": 0, "total_finalizations": 0}
    return jsonify({"ok": True})

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/app.js")
def appjs():
    return send_from_directory(".", "app.js")

if __name__ == "__main__":
    print("Starting server2.py — SSF/LMD-GHOST prototype")
    print("Open http://localhost:5000/")
    app.run(debug=True)
