from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import random, threading, time

app = Flask(__name__, static_folder=".")
CORS(app)

NUM_VALIDATORS = 10
QUORUM_RATIO = 2/3
current_slot = 0
finalized_slot = -1
validators = [{"id": i, "faulty": False} for i in range(NUM_VALIDATORS)]
chain = {}  # slot -> list of blocks (for fork)
head_slot = None

lock = threading.Lock()

# ----------------------
# Helper
# ----------------------
def select_votes(block):
    # Each validator votes with a delay
    votes=[]
    for v in validators:
        if not v["faulty"]:
            delay=random.uniform(0,2)  # delay 0-2 slots
            time.sleep(delay*0.01)  # imitation (we multiply it so it doesn't last really long)
            votes.append(v["id"])
    return votes

def compute_finalization(votes):
    return len(votes) >= int(NUM_VALIDATORS*QUORUM_RATIO)

def create_block(slot, parent=None):
    votes=select_votes({"slot": slot, "parent": parent})
    finalized=compute_finalization(votes)
    block={"slot": slot, "votes": votes, "finalized": finalized, "parent": parent}
    return block

def update_head():
    global head_slot
    with lock:
        # LMD GHOST: we select the last finalized chain
        sorted_slots=sorted(chain.keys(), key=int, reverse=True)
        for slot in sorted_slots:
            for b in chain[slot]:
                if b["finalized"]:
                    head_slot=b["slot"]
                    return
        head_slot=str(current_slot)

# ----------------------
# API
# ----------------------
@app.route("/status")
def status():
    return jsonify({
        "current_slot": current_slot,
        "finalized_slot": finalized_slot,
        "validators": validators,
        "chain": chain,
        "head": head_slot
    })

@app.route("/simulate_slot", methods=["POST"])
def simulate_slot():
    global current_slot, finalized_slot
    current_slot += 1

    # 80% normal block, 20% fork attack
    if random.random()<0.2 and current_slot>1:
        fork_slot=str(random.randint(max(1,current_slot-3),current_slot-1))
        parent=chain[fork_slot][0]["parent"] if chain.get(fork_slot) else str(int(fork_slot)-1)
        block=create_block(current_slot, parent=fork_slot)
        chain.setdefault(str(current_slot),[]).append(block)
    else:
        block=create_block(current_slot, parent=str(current_slot-1))
        chain.setdefault(str(current_slot),[]).append(block)

    # finalization
    for b in chain[str(current_slot)]:
        if b["finalized"]:
            finalized_slot=current_slot

    update_head()
    return jsonify(chain[str(current_slot)])

@app.route("/toggle_fault", methods=["POST"])
def toggle_fault():
    data=request.json
    vid=data.get("id")
    for v in validators:
        if v["id"]==vid:
            v["faulty"]=not v["faulty"]
            break
    return jsonify({"status":"ok","validators":validators})

# ----------------------
# Statics
# ----------------------
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/app.js")
def appjs():
    return send_from_directory(".", "app.js")

# ----------------------
# Launch
# ----------------------
if __name__=="__main__":
    app.run(debug=True)







