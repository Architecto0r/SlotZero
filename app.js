// app.js — simplified visualizer 
// Works with server endpoints (server2.py):
//  GET /status
//  POST /simulate_slot  ( {attack: bool} )
//  POST /toggle_fault   ( {id} )
//  POST /config         ( { max_delay_slots, fork_attack_prob, quorum_ratio } )
//  POST /simulate_attack ( { slots } )
//  POST /reset
//
// Author: restored for Architecto0r

const API = "http://localhost:5000";

///// DOM bootstrapping: ensure essential UI exists /////
function ensureDOM() {
  if (!document.getElementById("controls")) {
    const controls = document.createElement("div");
    controls.id = "controls";
    controls.style.textAlign = "center";
    controls.style.padding = "10px";
    document.body.prepend(controls);
  }
  if (!document.getElementById("validators")) {
    const div = document.createElement("div");
    div.id = "validators";
    div.style.textAlign = "center";
    div.style.margin = "8px 0";
    document.getElementById("controls").after(div);
  }
  if (!document.getElementById("treeCanvas")) {
    const wrapper = document.createElement("div");
    wrapper.style.overflowX = "auto";
    wrapper.style.padding = "8px";
    const canvas = document.createElement("canvas");
    canvas.id = "treeCanvas";
    canvas.width = 1600;
    canvas.height = 600;
    wrapper.appendChild(canvas);
    document.getElementById("validators").after(wrapper);
  }
  if (!document.getElementById("tooltip")) {
    const t = document.createElement("div");
    t.id = "tooltip";
    t.style.position = "absolute";
    t.style.display = "none";
    t.style.pointerEvents = "none";
    t.style.background = "rgba(0,0,0,0.8)";
    t.style.color = "#fff";
    t.style.padding = "6px 8px";
    t.style.borderRadius = "6px";
    t.style.fontSize = "12px";
    document.body.appendChild(t);
  }
  if (!document.getElementById("charts")) {
    const c = document.createElement("div");
    c.id = "charts";
    c.style.display = "flex";
    c.style.gap = "12px";
    c.style.justifyContent = "center";
    c.style.marginTop = "12px";
    document.getElementById("treeCanvas").parentElement.after(c);
  }
}
ensureDOM();

///// Elements /////
const canvas = document.getElementById("treeCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const validatorsDiv = document.getElementById("validators");
const controls = document.getElementById("controls");
const chartsDiv = document.getElementById("charts");

// style canvas hi-dpi
function fixHiDPI() {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) {
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}
fixHiDPI();
window.addEventListener("resize", () => { fixHiDPI(); renderBaseTree(); });

///// State /////
let serverState = {}; // full /status response
let treeLayout = {}; // mapping block_id -> {x,y}
let animNodes = {}; // current animated positions for blocks and packets
let packetPool = []; // pending vote packets to animate
let headId = null;
let configUI = { maxDelay: 2, forkProb: 0.12, quorumRatio: 2/3 };

///// UI: controls & sliders /////
function buildControls() {
  controls.innerHTML = "";

  const simBtn = document.createElement("button");
  simBtn.textContent = "Simulate Slot";
  simBtn.onclick = async () => {
    try {
      await fetch(`${API}/simulate_slot`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({attack: false})});
      await fetchStatus();
    } catch(e) { console.error(e); }
  };

  const attackBtn = document.createElement("button");
  attackBtn.textContent = "Simulate Slot (Attack)";
  attackBtn.onclick = async () => {
    try {
      await fetch(`${API}/simulate_slot`, { method: "POST", headers:{'content-type':'application/json'}, body: JSON.stringify({attack: true})});
      await fetchStatus();
    } catch(e) { console.error(e); }
  };

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.onclick = async () => {
    try {
      await fetch(`${API}/reset`, { method: "POST" });
      await fetchStatus();
    } catch(e){ console.error(e); }
  };

  // sliders: max_delay_slots, fork_attack_prob, quorum_ratio
  const slidersWrap = document.createElement("div");
  slidersWrap.style.display = "flex";
  slidersWrap.style.justifyContent = "center";
  slidersWrap.style.gap = "12px";
  slidersWrap.style.marginTop = "8px";

  // helper to create slider
  function createSlider(labelText, min, max, step, initial, onChange) {
    const box = document.createElement("div");
    box.style.textAlign = "center";
    const label = document.createElement("div");
    label.style.color = "#fff";
    label.style.marginBottom = "4px";
    label.innerHTML = `<strong>${labelText}</strong> <span id="${labelText}-val" style="margin-left:6px">${initial}</span>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = initial;
    input.oninput = async (e) => {
      document.getElementById(`${labelText}-val`).textContent = e.target.value;
    };
    input.onchange = async (e) => {
      await onChange(e.target.value);
    };
    box.appendChild(label);
    box.appendChild(input);
    return box;
  }

  const delaySlider = createSlider("MAX_DELAY_SLOTS", 0, 8, 1, configUI.maxDelay, async (v) => {
    configUI.maxDelay = Number(v);
    try {
      await fetch(`${API}/config`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ max_delay_slots: Number(v) })});
      await fetchStatus();
    } catch(e){ console.error(e); }
  });
  const forkSlider = createSlider("FORK_ATTACK_PROB", 0, 0.6, 0.01, configUI.forkProb, async (v) => {
    configUI.forkProb = Number(v);
    try {
      await fetch(`${API}/config`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ fork_attack_prob: Number(v) })});
      await fetchStatus();
    } catch(e){ console.error(e); }
  });
  const quorumSlider = createSlider("QUORUM_RATIO", 0.5, 0.9, 0.01, configUI.quorumRatio, async (v) => {
    configUI.quorumRatio = Number(v);
    try {
      await fetch(`${API}/config`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ quorum_ratio: Number(v) })});
      await fetchStatus();
    } catch(e){ console.error(e); }
  });

  // faulty fraction control
  const faultBox = document.createElement("div");
  faultBox.style.textAlign = "center";
  faultBox.innerHTML = `<div style="color:#fff"><strong>Faulty fraction</strong> <span id="fault-val">0</span></div>`;
  const faultInput = document.createElement("input");
  faultInput.type = "range";
  faultInput.min = 0;
  faultInput.max = 1;
  faultInput.step = 0.05;
  faultInput.value = 0;
  faultInput.oninput = (e) => { document.getElementById("fault-val").textContent = e.target.value; };
  const applyFaultsBtn = document.createElement("button");
  applyFaultsBtn.textContent = "Apply Faulty Fraction";
  applyFaultsBtn.onclick = async () => {
    try {
      const frac = Number(faultInput.value);
      await applyFaultFraction(frac);
      await fetchStatus();
    } catch(e) { console.error(e); }
  };
  faultBox.appendChild(faultInput);
  faultBox.appendChild(document.createElement("br"));
  faultBox.appendChild(applyFaultsBtn);

  // sweep UI
  const sweepBox = document.createElement("div");
  sweepBox.style.textAlign = "center";
  sweepBox.style.marginLeft = "12px";
  sweepBox.innerHTML = `<div style="color:#fff"><strong>Run sweep</strong></div>`;
  const sweepBtn = document.createElement("button");
  sweepBtn.textContent = "Run Sweep";
  const sweepNote = document.createElement("div");
  sweepNote.style.color = "#ddd";
  sweepNote.style.fontSize = "12px";
  sweepNote.style.marginTop = "6px";
  sweepNote.textContent = "Sweeps over fault_fraction and max_delay. This may take time.";
  sweepBtn.onclick = async () => {
    sweepBtn.disabled = true;
    sweepNote.textContent = "Running sweep...";
    try {
      await runSweep();
    } catch(e) { console.error(e); }
    sweepBtn.disabled = false;
    sweepNote.textContent = "Sweep finished.";
  };
  sweepBox.appendChild(sweepBtn);
  sweepBox.appendChild(sweepNote);

  slidersWrap.appendChild(delaySlider);
  slidersWrap.appendChild(forkSlider);
  slidersWrap.appendChild(quorumSlider);
  slidersWrap.appendChild(faultBox);
  slidersWrap.appendChild(sweepBox);

  controls.appendChild(simBtn);
  controls.appendChild(attackBtn);
  controls.appendChild(resetBtn);
  controls.appendChild(slidersWrap);
}
buildControls();

///// Helpers: server interactions /////
async function fetchStatus() {
  try {
    const res = await fetch(`${API}/status`);
    if (!res.ok) throw new Error("Status fetch failed");
    serverState = await res.json();
    headId = serverState.head;
    renderValidators();
    buildTreeLayout();
    createPacketsFromPending(serverState.pending_votes || []);
    renderBaseTree();
  } catch (e) {
    console.error("fetchStatus error", e);
  }
}

async function applyFaultFraction(frac) {
  // reset to clean state and toggle first k validators faulty
  try {
    await fetch(`${API}/reset`, { method: "POST" });
    await fetchStatus();
    const total = serverState.validators.length;
    const k = Math.floor(total * frac);
    for (let i = 0; i < k; i++) {
      // ensure validator i is faulty (toggle if not)
      if (!serverState.validators[i].faulty) {
        await fetch(`${API}/toggle_fault`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({ id: i }) });
      }
    }
    // if some later ones are faulty (because previous state), turn them off
    for (let i = k; i < total; i++) {
      if (serverState.validators[i].faulty) {
        await fetch(`${API}/toggle_fault`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({ id: i }) });
      }
    }
    await fetchStatus();
  } catch (e) {
    console.error("applyFaultFraction error", e);
  }
}

///// Render validators list /////
function renderValidators() {
  validatorsDiv.innerHTML = "";
  const vs = serverState.validators || [];
  vs.forEach(v => {
    const el = document.createElement("span");
    el.className = "validator";
    el.style.display = "inline-block";
    el.style.margin = "4px";
    el.style.padding = "4px 8px";
    el.style.borderRadius = "6px";
    el.style.background = v.faulty ? "#8b2d2d" : "#214f21";
    el.style.color = "#fff";
    el.textContent = `V#${v.id}${v.slashed ? " (slashed)" : ""}`;
    // clicking toggles
    el.onclick = async () => {
      try {
        await fetch(`${API}/toggle_fault`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({ id: v.id }) });
        await fetchStatus();
      } catch(e) { console.error(e); }
    };
    validatorsDiv.appendChild(el);
  });
}

///// Layout tree: multi-block slots /////
function buildTreeLayout() {
  treeLayout = {};
  const blocks_in_slot = serverState.blocks_in_slot || {};
  const slotKeys = Object.keys(blocks_in_slot).map(s => parseInt(s)).sort((a,b)=>a-b);
  const xStep = 140;
  const yStep = 72;
  const xStart = 120;
  // compute how many blocks per slot to set canvas height
  let maxDepth = 1;
  for (const s of slotKeys) {
    const count = (blocks_in_slot[s] || []).length;
    if (count > maxDepth) maxDepth = count;
  }
  const minCanvasH = Math.max(600, 120 + maxDepth * yStep);
  canvas.height = minCanvasH;
  // compute width
  const maxSlot = slotKeys.length ? Math.max(...slotKeys) : 10;
  const minCanvasW = Math.max(1600, xStart + (maxSlot + 2) * xStep);
  canvas.width = minCanvasW;
  fixHiDPI();

  // layout: for each slot, each block gets its own row index (stacked down)
  for (const s of slotKeys) {
    const blockIds = blocks_in_slot[s].slice(); // array of ids (strings)
    for (let i = 0; i < blockIds.length; i++) {
      const bid = blockIds[i];
      const x = xStart + s * xStep;
      const y = 60 + i * yStep; // forks stack downward
      treeLayout[bid] = { x, y };
      // initialize animNodes for block if missing
      if (!animNodes[bid]) animNodes[bid] = { x, y: 0, size: 0 };
    }
  }
}

///// Create packets from pending vote_events (server returns pending_votes) /////
function createPacketsFromPending(pending_votes) {
  // pending_votes: array of {deliver_slot, validator, block_id}
  // For each event create a packet if not already exist (by unique key)
  if (!pending_votes) return;
  for (const ev of pending_votes) {
    const key = `${ev.validator}->${ev.block_id}@${ev.deliver_slot}`;
    if (packetPool.find(p => p.key === key)) continue;
    // starting position: approximate validator badge at top area
    const validatorIdx = ev.validator;
    const totalValidators = serverState.validators ? serverState.validators.length : 0;
    const startX = 40 + (validatorIdx % 10) * 22; // row of small icons
    const startY = 20 + Math.floor(validatorIdx / 10) * 18;
    // end position: block coordinate if known
    const targetBlock = treeLayout[ev.block_id];
    const endX = targetBlock ? targetBlock.x : canvas.width - 100;
    const endY = targetBlock ? targetBlock.y : 40;
    // travel duration in frames: proportional to (deliver_slot - current_slot) but min 30
    const slotGap = Math.max(1, (ev.deliver_slot - (serverState.current_slot || 0)));
    const frames = Math.max(40, slotGap * 30);
    packetPool.push({
      key,
      validator: ev.validator,
      block_id: ev.block_id,
      deliver_slot: ev.deliver_slot,
      sx: startX, sy: startY,
      ex: endX, ey: endY,
      t: 0,
      frames,
      color: "#ffcc00"
    });
  }
}

///// Animation loop: draw lines, blocks, packets, tooltips /////
let lastFrameTime = 0;
function animateLoop(ts) {
  requestAnimationFrame(animateLoop);
  // basic throttling by delta
  if (!lastFrameTime) lastFrameTime = ts;
  const dt = ts - lastFrameTime;
  if (dt < 16) return; // ~60fps cap
  lastFrameTime = ts;

  renderBaseTree();
  // animate packets
  for (let i = packetPool.length - 1; i >= 0; i--) {
    const p = packetPool[i];
    p.t++;
    const frac = Math.min(1, p.t / p.frames);
    const ease = frac < 0.5 ? (2 * frac * frac) : (1 - Math.pow(-2 * frac + 2, 2) / 2);
    const x = p.sx + (p.ex - p.sx) * ease;
    const y = p.sy + (p.ey - p.sy) * ease;
    // draw packet (small circle)
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.95;
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // if reached end (deliver), remove and trigger small flash on target
    if (p.t >= p.frames) {
      // small spark
      flashAt(p.ex, p.ey, p.color);
      packetPool.splice(i, 1);
    }
  }

  // animate block growth (size easing)
  for (const bid in animNodes) {
    const anim = animNodes[bid];
    const target = treeLayout[bid];
    if (!target) continue;
    // move towards target x,y
    anim.x += (target.x - anim.x) * 0.12;
    anim.y += (target.y - anim.y) * 0.12;
    // grow size to 44
    anim.size += (44 - (anim.size || 0)) * 0.12;
    // draw block rectangle (overlaid on base since base drew static blocks)
    const b = serverState.chain ? serverState.chain[bid] : null;
    if (!b) continue;
    let color = `hsl(${(b.slot * 40 + (parseInt(b.id.split(":")[1]||0)*25)) % 360}, 70%, 50%)`;
    if (b.finalized) color = "#1a7f37";
    if (headId && bid === headId) color = "#FFD700";
    ctx.fillStyle = color;
    ctx.fillRect(anim.x - anim.size/2, anim.y - anim.size/2, anim.size, anim.size);
    // draw text
    ctx.fillStyle = "#fff";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.slot, anim.x, anim.y);
  }
}
requestAnimationFrame(animateLoop);

//// small flash effect
let flashes = [];
function flashAt(x,y,color) {
  flashes.push({x,y,r:2,c:color,life:30});
}
function renderFlashes() {
  for (let i = flashes.length -1; i>=0; i--) {
    const f = flashes[i];
    ctx.beginPath();
    ctx.globalAlpha = f.life/30;
    ctx.fillStyle = f.c;
    ctx.arc(f.x, f.y, f.r + (30 - f.life)/4, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
    f.life--;
    if (f.life <= 0) flashes.splice(i,1);
  }
}

///// Base rendering: lines + static blocks + highlights /////
function renderBaseTree() {
  // clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // background grid
  drawGrid();

  // draw parent->child lines (for all blocks; use small alpha)
  ctx.lineWidth = 2;
  for (const bid in serverState.chain || {}) {
    const b = serverState.chain[bid];
    if (!b || !b.parent) continue;
    const ppos = treeLayout[b.parent];
    const cpos = treeLayout[bid];
    if (!ppos || !cpos) continue;
    // base line
    ctx.beginPath();
    ctx.strokeStyle = "rgba(170,170,170,0.25)";
    ctx.moveTo(ppos.x, ppos.y);
    ctx.lineTo(cpos.x, cpos.y);
    ctx.stroke();
  }

  // static draw of blocks behind animation (slightly dim)
  for (const bid in serverState.chain || {}) {
    const b = serverState.chain[bid];
    const layout = treeLayout[bid];
    if (!layout) continue;
    // small dim block as background
    ctx.fillStyle = b.finalized ? "rgba(26,127,55,0.45)" : "rgba(255,174,0,0.18)";
    if (headId && bid === headId) ctx.fillStyle = "rgba(255,215,0,0.6)";
    ctx.fillRect(layout.x - 20, layout.y - 20, 40, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.slot, layout.x, layout.y);
    // votes count
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px Arial";
    ctx.fillText(`${b.votes_count} votes`, layout.x, layout.y + 26);
  }

  // render package flashes
  renderFlashes();
}

function drawGrid() {
  // subtle grid
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "rgba(10,10,20,0.9)";
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(255,255,255,0.02)";
  ctx.lineWidth = 1;
  const step = 40;
  for (let x=0; x<w; x+=step) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for (let y=0; y<h; y+=step) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }
}

///// Tooltip & parent-chain highlight on mousemove /////
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let foundKey = null;
  // check animated nodes first (current positions)
  for (const key in animNodes) {
    const n = animNodes[key];
    const size = n.size || 44;
    if (mx >= n.x - size/2 && mx <= n.x + size/2 && my >= n.y - size/2 && my <= n.y + size/2) {
      foundKey = key;
      break;
    }
  }
  if (!foundKey) {
    // check static layout fallback
    for (const bid in treeLayout) {
      const p = treeLayout[bid];
      if (!p) continue;
      if (mx >= p.x - 20 && mx <= p.x + 20 && my >= p.y - 20 && my <= p.y + 20) {
        foundKey = bid;
        break;
      }
    }
  }
  if (foundKey) {
    const b = serverState.chain[foundKey];
    // tooltip content
    const votesText = b ? `${b.votes_count} votes` : "";
    tooltip.style.left = (e.pageX + 12) + "px";
    tooltip.style.top = (e.pageY + 12) + "px";
    tooltip.innerHTML = `<strong>Block:</strong> ${foundKey}<br/>
                         <strong>Slot:</strong> ${b ? b.slot : "?"}<br/>
                         <strong>Finalized:</strong> ${b ? b.finalized : "?"}<br/>
                         <strong>${votesText}</strong>`;
    tooltip.style.display = "block";

    // highlight parent chain
    highlightParentChain(foundKey);
  } else {
    tooltip.style.display = "none";
    // re-render base to remove highlights
    renderBaseTree();
  }
});

canvas.addEventListener("mouseleave", ()=> { tooltip.style.display = "none"; renderBaseTree(); });

function highlightParentChain(blockId) {
  drawGrid();
  // draw base lines lightly, then overlay highlight
  for (const bid in serverState.chain || {}) {
    const b = serverState.chain[bid];
    if (!b || !b.parent) continue;
    const ppos = treeLayout[b.parent];
    const cpos = treeLayout[bid];
    if (!ppos || !cpos) continue;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(170,170,170,0.12)";
    ctx.lineWidth = 1.5;
    ctx.moveTo(ppos.x, ppos.y);
    ctx.lineTo(cpos.x, cpos.y);
    ctx.stroke();
  }
  // highlight chain from blockId up to genesis
  let cur = blockId;
  ctx.strokeStyle = "#00FFFF";
  ctx.lineWidth = 3;
  while (cur) {
    const b = serverState.chain[cur];
    if (!b || !b.parent) break;
    const p = treeLayout[b.parent];
    const c = treeLayout[cur];
    if (!p || !c) break;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    cur = b.parent;
  }
  // draw blocks overlay
  for (const bid in serverState.chain || {}) {
    const b = serverState.chain[bid];
    const l = treeLayout[bid];
    if (!l) continue;
    ctx.fillStyle = b.finalized ? "rgba(26,127,55,0.6)" : "rgba(255,174,0,0.25)";
    if (bid === headId) ctx.fillStyle = "rgba(255,215,0,0.8)";
    ctx.fillRect(l.x - 20, l.y - 20, 40, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "11px Arial";
    ctx.fillText(b.slot, l.x, l.y);
  }
}

///// Sweep runner — runs experiments sweeping fault_fraction & max_delay
async function runSweep() {
  // parameters for sweep (small grid to keep runtime reasonable)
  const faultFractions = [0.0, 0.1, 0.2, 0.3, 0.4]; // fraction of validators faulty
  const maxDelays = [0, 1, 2, 3]; // MAX_DELAY_SLOTS
  const slotsPerRun = 80; // run this many slots each experiment

  const results = []; // {fault, delay, metrics}

  // create placeholders for charts
  chartsDiv.innerHTML = "";
  const canvasA = document.createElement("canvas"); canvasA.width = 420; canvasA.height = 240;
  const canvasB = document.createElement("canvas"); canvasB.width = 420; canvasB.height = 240;
  const canvasC = document.createElement("canvas"); canvasC.width = 420; canvasC.height = 240;
  chartsDiv.appendChild(canvasA); chartsDiv.appendChild(canvasB); chartsDiv.appendChild(canvasC);

  for (const frac of faultFractions) {
    for (const maxd of maxDelays) {
      try {
        // reset server
        await fetch(`${API}/reset`, { method: "POST" });
        // set config
        await fetch(`${API}/config`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({ max_delay_slots: maxd, fork_attack_prob: configUI.forkProb, quorum_ratio: configUI.quorumRatio }) });
        // apply faults: toggle first k validators faulty
        await fetchStatus();
        const total = serverState.validators.length;
        const k = Math.floor(total * frac);
        for (let i=0;i<k;i++){
          await fetch(`${API}/toggle_fault`, { method: "POST", headers: {'content-type':'application/json'}, body: JSON.stringify({ id: i }) });
        }
        // run attack-mode simulation for slotsPerRun (simulate_attack allows N slots)
        await fetch(`${API}/simulate_attack`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ slots: slotsPerRun }) });
        // read metrics from server metrics endpoint for sweep summary (server returns totals)
        await fetchStatus();
        const mRes = await fetch(`${API}/metrics`);
        const metricsObj = await mRes.json();
        // compute derived metrics
        const fraction_finalized = (metricsObj.total_finalized || 0) / (metricsObj.total_blocks || 1);
        const avg_time_to_finality = (metricsObj.total_finalizations > 0) ? (metricsObj.total_slots_simulated / metricsObj.total_finalizations) : null;
        const reorg_rate = (metricsObj.total_slots_simulated || 1) ? (metricsObj.total_forks / metricsObj.total_slots_simulated) : 0;
        results.push({ fault: frac, delay: maxd, metrics: metricsObj, fraction_finalized, avg_time_to_finality, reorg_rate });
      } catch (e) {
        console.error("runSweep step failed", e);
      }
    }
  }

  drawSweepCharts(results, canvasA, canvasB, canvasC);
}

function drawSweepCharts(results, c1, c2, c3) {
  // results: array of records across grid fault x delay
  // We'll aggregate into series for each delay across faults
  const faults = [...new Set(results.map(r=>r.fault))].sort((a,b)=>a-b);
  const delays = [...new Set(results.map(r=>r.delay))].sort((a,b)=>a-b);

  // prepare data matrices
  const byDelay = {};
  for (const d of delays) byDelay[d] = results.filter(r=>r.delay===d).sort((a,b)=>a.fault-b.fault);

  // Chart 1: fraction_finalized vs fault (multiple lines for each delay)
  simpleLineChart(c1, {
    title: "fraction_finalized",
    xLabels: faults.map(f=>f.toFixed(2)),
    series: delays.map(d=>({ name: `delay=${d}`, data: byDelay[d].map(r=>r.fraction_finalized) }))
  });

  // Chart 2: avg_time_to_finality
  simpleLineChart(c2, {
    title: "avg_time_to_finality",
    xLabels: faults.map(f=>f.toFixed(2)),
    series: delays.map(d=>({ name: `delay=${d}`, data: byDelay[d].map(r=>r.avg_time_to_finality || 0) }))
  });

  // Chart 3: reorg_rate
  simpleLineChart(c3, {
    title: "reorg_rate (forks/slot)",
    xLabels: faults.map(f=>f.toFixed(2)),
    series: delays.map(d=>({ name: `delay=${d}`, data: byDelay[d].map(r=>r.reorg_rate) }))
  });
}

// very small lightweight line chart on canvas (no libs)
function simpleLineChart(canvasEl, { title, xLabels, series }) {
  const ctxc = canvasEl.getContext("2d");
  const W = canvasEl.width;
  const H = canvasEl.height;
  ctxc.clearRect(0,0,W,H);
  ctxc.fillStyle = "#111"; ctxc.fillRect(0,0,W,H);

  // margins
  const m = {l:40,r:14,t:24,b:30};
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;

  // determine y range across all series
  let ymin = Infinity, ymax = -Infinity;
  for (const s of series) {
    for (const v of s.data) {
      if (v === null || v === undefined) continue;
      ymin = Math.min(ymin, v);
      ymax = Math.max(ymax, v);
    }
  }
  if (ymin === Infinity) { ymin = 0; ymax = 1; }
  if (ymin === ymax) { ymax = ymin + 1; }

  // draw axes
  ctxc.strokeStyle = "#666";
  ctxc.fillStyle = "#ddd";
  ctxc.lineWidth = 1;
  ctxc.font = "12px Arial";
  ctxc.textAlign = "center";
  ctxc.fillText(title, W/2, 14);

  // x axis labels
  for (let i=0;i<xLabels.length;i++){
    const x = m.l + (i/(xLabels.length-1||1))*plotW;
    ctxc.fillStyle = "#aaa";
    ctxc.fillText(xLabels[i], x, H - 8);
  }

  // y ticks
  const yTicks = 4;
  ctxc.textAlign = "right";
  for (let i=0;i<=yTicks;i++){
    const y = m.t + (i/yTicks)*plotH;
    const v = ymax - (i/yTicks)*(ymax-ymin);
    ctxc.fillStyle = "#bbb";
    ctxc.fillText(v.toFixed(2), m.l-6, y+4);
    // grid
    ctxc.strokeStyle = "rgba(255,255,255,0.03)";
    ctxc.beginPath(); ctxc.moveTo(m.l, y); ctxc.lineTo(m.l+plotW, y); ctxc.stroke();
  }

  // plot each series
  const colors = ["#ff8c00","#1e90ff","#ff69b4","#7fff00","#ffd700","#00ffff"];
  for (let si=0; si<series.length; si++){
    const s = series[si];
    ctxc.strokeStyle = colors[si % colors.length];
    ctxc.lineWidth = 2;
    ctxc.beginPath();
    for (let i=0;i<s.data.length;i++){
      const val = s.data[i] == null ? ymin : s.data[i];
      const x = m.l + (i/(s.data.length-1||1))*plotW;
      const y = m.t + ((ymax - val) / (ymax-ymin)) * plotH;
      if (i===0) ctxc.moveTo(x,y); else ctxc.lineTo(x,y);
      // point
      ctxc.fillStyle = colors[si % colors.length];
      ctxc.beginPath(); ctxc.arc(x,y,3,0,Math.PI*2); ctxc.fill();
    }
    ctxc.stroke();

    // legend
    ctxc.fillStyle = colors[si % colors.length];
    ctxc.fillRect(W - m.r - 110, m.t + 12 + si*14, 10, 8);
    ctxc.fillStyle = "#ddd";
    ctxc.textAlign = "left";
    ctxc.fillText(s.name, W - m.r - 94, m.t + 20 + si*14);
  }
}

///// Initialization: periodic polling /////
async function init() {
  await fetchStatus();
  setInterval(fetchStatus, 1500); // poll status
}
init();

///// Extra: enable manual simulate attack button in controls (smaller UI tweak) /////
(function addAttackUI(){
  const b = document.createElement("button");
  b.textContent = "Run Attack (5 slots)";
  b.onclick = async () => {
    try {
      await fetch(`${API}/simulate_attack`, { method:'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ slots: 5 }) });
      await fetchStatus();
    } catch(e) { console.error(e); }
  };
  controls.appendChild(b);
})();

