/* =========================================================
   Agent Orchestration Platform — Frontend
   ========================================================= */

const API = '';  // same-origin; empty string = relative URLs

// ── vis.js graph datasets ──────────────────────────────────
const nodes = new vis.DataSet();
const edges = new vis.DataSet();
let network = null;
let connectMode = false;

// ── Local state ────────────────────────────────────────────
let agentMap = {};       // agent_id → AgentRecord
let connectionMap = {};  // connection_id → Connection
let feedCount = 0;
const MAX_FEED = 200;

// Active run highlights: run_id → { agent_id, nodeOriginalColor }
const activeRuns = {};

// ── Sample inputs per agent type ──────────────────────────
const SAMPLE_INPUTS = {
  calculator: [
    'What is 12 multiplied by 7?',
    'Add 256 and 744',
    'Divide 100 by 4',
    'Subtract 38 from 200',
  ],
  research: [
    'Find information about climate change',
    'Research the history of artificial intelligence',
    'What are the latest advances in quantum computing?',
  ],
};


/* =========================================================
   Polling (replaces WebSocket — works on Vercel serverless)
   ========================================================= */
let lastSeq = 0;
let pollTimer = null;
let pollFailCount = 0;

async function startPolling() {
  updateWSStatus('connecting');
  try {
    // Load initial state via REST then sync the event cursor
    const [agentsRes, connsRes] = await Promise.all([
      apiFetch('/api/agents'),
      apiFetch('/api/workflows/connections'),
    ]);
    handleEvent({ type: 'snapshot', agents: agentsRes.agents, connections: connsRes.connections });
    // Advance cursor so we only get NEW events from now on
    const cur = await apiFetch('/api/events?after=999999');
    lastSeq = cur.current_seq || 0;
    updateWSStatus('connected');
    pollFailCount = 0;
  } catch (err) {
    console.error('Initial load failed', err);
    updateWSStatus('error');
    setTimeout(startPolling, 3000);
    return;
  }
  schedulePoll();
}

function schedulePoll() {
  pollTimer = setTimeout(poll, 500);
}

async function poll() {
  try {
    const res = await apiFetch(`/api/events?after=${lastSeq}`);
    if (res.events && res.events.length) {
      res.events.forEach(ev => {
        lastSeq = Math.max(lastSeq, ev.seq || 0);
        handleEvent(ev);
      });
    }
    pollFailCount = 0;
    updateWSStatus('connected');
  } catch (err) {
    pollFailCount++;
    if (pollFailCount >= 3) updateWSStatus('error');
  }
  schedulePoll();
}

function updateWSStatus(s) {
  const el = document.getElementById('ws-status');
  const labels = { connecting: '● Connecting…', connected: '● Live', error: '● Disconnected' };
  el.textContent = labels[s] || s;
  el.className = 'ws-status ' + (s === 'connected' ? 'connected' : s === 'error' ? 'error' : '');
}


/* =========================================================
   Event dispatcher
   ========================================================= */
const handlers = {
  snapshot:            handleSnapshot,
  agent_registered:    handleAgentRegistered,
  agent_unregistered:  handleAgentUnregistered,
  connection_added:    handleConnectionAdded,
  connection_removed:  handleConnectionRemoved,
  run_started:         handleRunStarted,
  llm_thought:         handleLlmThought,
  tool_called:         handleToolCalled,
  tool_result:         handleToolResult,
  agent_message:       handleAgentMessage,
  run_completed:       handleRunCompleted,
  run_error:           handleRunError,
};

function handleEvent(ev) {
  const fn = handlers[ev.type];
  if (fn) fn(ev);
  addFeedEntry(ev);
}


/* =========================================================
   Snapshot (initial state sync)
   ========================================================= */
function handleSnapshot(ev) {
  nodes.clear(); edges.clear();
  agentMap = {}; connectionMap = {};

  (ev.agents || []).forEach(a => _addAgent(a));
  (ev.connections || []).forEach(c => _addConnection(c));
  updateAgentCount();
  updateRunSelect();
}


/* =========================================================
   Agent events
   ========================================================= */
function handleAgentRegistered(ev) {
  _addAgent(ev.agent);
  updateAgentCount();
  updateRunSelect();
}

function handleAgentUnregistered(ev) {
  _removeAgent(ev.agent_id);
  updateAgentCount();
  updateRunSelect();
}

function _addAgent(a) {
  agentMap[a.agent_id] = a;
  nodes.add({
    id: a.agent_id,
    label: a.display_name,
    title: `${a.agent_type}\n${a.description}`,
    color: {
      background: a.color || '#4A90D9',
      border: lighten(a.color || '#4A90D9', 30),
      highlight: { background: lighten(a.color || '#4A90D9', 20), border: '#fff' },
      hover: { background: lighten(a.color || '#4A90D9', 15), border: '#fff' },
    },
    font: { color: '#fff', size: 13, bold: true },
    shape: 'dot',
    size: 22,
    x: a.x,
    y: a.y,
    physics: false,
  });
}

function _removeAgent(agent_id) {
  delete agentMap[agent_id];
  // Remove connected edges first
  const toRemove = edges.get({ filter: e => e.from === agent_id || e.to === agent_id });
  edges.remove(toRemove.map(e => e.id));
  nodes.remove(agent_id);
}


/* =========================================================
   Connection events
   ========================================================= */
function handleConnectionAdded(ev) {
  _addConnection(ev.connection);
}

function handleConnectionRemoved(ev) {
  edges.remove(ev.connection_id);
  delete connectionMap[ev.connection_id];
}

function _addConnection(c) {
  connectionMap[c.connection_id] = c;
  edges.add({
    id: c.connection_id,
    from: c.from_agent_id,
    to: c.to_agent_id,
    label: c.label || '',
    arrows: { to: { enabled: true, scaleFactor: 0.7 } },
    color: { color: '#2c3148', highlight: '#5b7fff', hover: '#5b7fff' },
    font: { color: '#7a8099', size: 10 },
    smooth: { type: 'curvedCW', roundness: 0.2 },
  });
}


/* =========================================================
   Run events — graph animations
   ========================================================= */
function handleRunStarted(ev) {
  pulseNode(ev.agent_id, '#5b7fff');
  activeRuns[ev.run_id] = { agent_id: ev.agent_id };
}

function handleLlmThought(ev) {
  // Brief yellow glow for thinking
  flashNode(ev.agent_id, '#f5c842', 600);
}

function handleToolCalled(ev) {
  flashNode(ev.agent_id, '#f5c842', 800);
}

function handleToolResult(ev) {
  flashNode(ev.agent_id, '#42d4f5', 600);
}

function handleAgentMessage(ev) {
  // Flash the edge between the two agents
  flashEdgeBetween(ev.from_agent_id, ev.to_agent_id);
  pulseNode(ev.to_agent_id, '#f5a742');
}

function handleRunCompleted(ev) {
  stopPulseNode(ev.agent_id, agentMap[ev.agent_id]?.color || '#4A90D9');
  delete activeRuns[ev.run_id];
  showToast('Run complete', `${ev.agent_id}: ${ev.result?.slice(0, 120) || ''}`);
}

function handleRunError(ev) {
  stopPulseNode(ev.agent_id, agentMap[ev.agent_id]?.color || '#4A90D9');
  delete activeRuns[ev.run_id];
  showToast('Run error', `${ev.agent_id}: ${ev.error}`, true);
}


/* =========================================================
   Graph animations helpers
   ========================================================= */
function pulseNode(agent_id, color) {
  if (!nodes.get(agent_id)) return;
  nodes.update({ id: agent_id, color: { background: color, border: '#fff' }, size: 28 });
}

function stopPulseNode(agent_id, originalColor) {
  if (!nodes.get(agent_id)) return;
  nodes.update({
    id: agent_id,
    color: {
      background: originalColor,
      border: lighten(originalColor, 30),
      highlight: { background: lighten(originalColor, 20), border: '#fff' },
    },
    size: 22,
  });
}

function flashNode(agent_id, color, duration) {
  if (!nodes.get(agent_id)) return;
  const orig = agentMap[agent_id]?.color || '#4A90D9';
  nodes.update({ id: agent_id, color: { background: color, border: '#fff' } });
  setTimeout(() => {
    if (nodes.get(agent_id)) {
      // Restore to running colour if still active, else original
      const running = Object.values(activeRuns).some(r => r.agent_id === agent_id);
      nodes.update({ id: agent_id, color: { background: running ? '#5b7fff' : orig, border: running ? '#fff' : lighten(orig, 30) } });
    }
  }, duration);
}

function flashEdgeBetween(fromId, toId) {
  const edge = edges.get({
    filter: e => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId),
  })[0];
  if (!edge) return;
  edges.update({ id: edge.id, color: { color: '#f5a742' }, width: 3 });
  setTimeout(() => {
    edges.update({ id: edge.id, color: { color: '#2c3148' }, width: 1 });
  }, 1200);
}

function lighten(hex, amount) {
  // Simple hex lightener
  try {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (n >> 16) + amount);
    const g = Math.min(255, ((n >> 8) & 0xff) + amount);
    const b = Math.min(255, (n & 0xff) + amount);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  } catch { return hex; }
}


/* =========================================================
   Event feed
   ========================================================= */
const FEED_META = {
  run_started:         { icon: '▶', label: 'Run Started' },
  run_completed:       { icon: '✓', label: 'Completed' },
  run_error:           { icon: '✕', label: 'Error' },
  tool_called:         { icon: '⚙', label: 'Tool Called' },
  tool_result:         { icon: '↩', label: 'Tool Result' },
  llm_thought:         { icon: '💭', label: 'Thought' },
  agent_message:       { icon: '→', label: 'Agent→Agent' },
  agent_registered:    { icon: '+', label: 'Registered' },
  agent_unregistered:  { icon: '−', label: 'Unregistered' },
  connection_added:    { icon: '⟷', label: 'Connected' },
  connection_removed:  { icon: '✕', label: 'Disconnected' },
  snapshot:            { icon: '⊡', label: 'Snapshot' },
};

function addFeedEntry(ev) {
  const feed = document.getElementById('event-feed');

  // Remove empty placeholder
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  const meta = FEED_META[ev.type] || { icon: '●', label: ev.type };
  const text = summariseEvent(ev);
  const ts = ev.ts ? new Date(ev.ts).toLocaleTimeString() : '';

  const entry = document.createElement('div');
  entry.className = `feed-entry fe-${ev.type}`;
  entry.innerHTML = `
    <span class="fe-icon">${meta.icon}</span>
    <div class="fe-body">
      <div class="fe-type">${meta.label}</div>
      <div class="fe-text">${escHtml(text)}</div>
    </div>
    <span class="fe-ts">${ts}</span>
  `;

  feed.insertBefore(entry, feed.firstChild);
  feedCount++;

  // Trim old entries
  while (feedCount > MAX_FEED) {
    feed.removeChild(feed.lastChild);
    feedCount--;
  }
}

function summariseEvent(ev) {
  switch (ev.type) {
    case 'run_started':       return `[${ev.agent_id}] Input: "${(ev.input || '').slice(0, 60)}"`;
    case 'run_completed':     return `[${ev.agent_id}] Result: "${(ev.result || '').slice(0, 80)}"`;
    case 'run_error':         return `[${ev.agent_id}] ${ev.error}`;
    case 'tool_called':       return `[${ev.agent_id}] ${ev.tool}(${JSON.stringify(ev.input || {})})`;
    case 'tool_result':       return `[${ev.agent_id}] ${ev.tool} → ${(ev.output || '').slice(0, 60)}`;
    case 'llm_thought':       return `[${ev.agent_id}] ${(ev.thought || '').slice(0, 80)}`;
    case 'agent_message':     return `${ev.from_agent_id} → ${ev.to_agent_id}: "${(ev.content || '').slice(0, 60)}"`;
    case 'agent_registered':  return `"${ev.agent?.display_name}" (${ev.agent?.agent_type})`;
    case 'agent_unregistered':return `${ev.agent_id} removed`;
    case 'connection_added':  return `${ev.connection?.from_agent_id} → ${ev.connection?.to_agent_id}`;
    case 'connection_removed':return `Connection removed`;
    case 'snapshot':          return `${(ev.agents || []).length} agents, ${(ev.connections || []).length} connections`;
    default:                  return JSON.stringify(ev).slice(0, 80);
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


/* =========================================================
   Toast
   ========================================================= */
let toastTimer = null;

function showToast(title, msg, isError = false) {
  const toast = document.getElementById('result-toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-msg').textContent = msg;
  toast.style.borderLeftColor = isError ? '#f56565' : '#3ecf8e';
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 6000);
}


/* =========================================================
   vis.js Network initialisation
   ========================================================= */
function initGraph() {
  const container = document.getElementById('graph-canvas');
  network = new vis.Network(
    container,
    { nodes, edges },
    {
      autoResize: true,
      physics: false,
      interaction: {
        hover: true,
        multiselect: false,
        dragNodes: true,
        dragView: true,
        zoomView: true,
        tooltipDelay: 200,
      },
      nodes: {
        borderWidth: 2,
        shadow: { enabled: true, color: 'rgba(0,0,0,0.5)', size: 10, x: 0, y: 4 },
      },
      edges: {
        width: 1.5,
        selectionWidth: 3,
      },
      manipulation: {
        enabled: false,
        addEdge: async (edgeData, callback) => {
          if (edgeData.from === edgeData.to) { callback(null); return; }
          try {
            const res = await apiFetch('/api/workflows/connections', 'POST', {
              from_agent_id: edgeData.from,
              to_agent_id: edgeData.to,
            });
            // The WS event will add the edge — don't double-add via callback
            callback(null);
          } catch (err) {
            console.error('Edge creation failed', err);
            callback(null);
          }
        },
      },
    }
  );

  // Right-click node → delete agent
  network.on('oncontext', (params) => {
    params.event.preventDefault();
    const nodeId = network.getNodeAt(params.pointer.DOM);
    if (!nodeId) return;
    if (confirm(`Delete agent "${nodeId}"?`)) {
      apiFetch(`/api/agents/${nodeId}`, 'DELETE').catch(console.error);
    }
  });

  // Fit button
  document.getElementById('btn-fit').addEventListener('click', () => network.fit({ animation: true }));
}


/* =========================================================
   Connect mode toggle
   ========================================================= */
function setConnectMode(on) {
  connectMode = on;
  const btn = document.getElementById('btn-connect-mode');
  btn.classList.toggle('active', on);
  if (network) {
    network.setOptions({ manipulation: { enabled: on } });
    document.getElementById('graph-hint').textContent = on
      ? 'Drag from one agent to another to create a connection. Click "Connect" again to stop.'
      : 'Drag nodes to rearrange • Click Connect to draw edges • Right-click node to delete';
  }
}

document.getElementById('btn-connect-mode').addEventListener('click', () => {
  setConnectMode(!connectMode);
});


/* =========================================================
   Modals
   ========================================================= */
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.getElementById('btn-register').addEventListener('click', () => openModal('modal-register'));

document.getElementById('btn-run').addEventListener('click', () => {
  updateRunSelect();
  openModal('modal-run');
});


/* =========================================================
   Register Agent form
   ========================================================= */
document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    agent_id:     document.getElementById('reg-id').value.trim(),
    display_name: document.getElementById('reg-name').value.trim(),
    agent_type:   document.getElementById('reg-type').value,
    description:  document.getElementById('reg-desc').value.trim(),
    color:        document.getElementById('reg-color').value,
  };
  try {
    const res = await apiFetch('/api/agents/register', 'POST', payload);
    closeModal('modal-register');
    e.target.reset();
    document.getElementById('reg-color').value = '#4A90D9';
  } catch (err) {
    alert(`Registration failed: ${err.message}`);
  }
});


/* =========================================================
   Run Agent form
   ========================================================= */
function updateRunSelect() {
  const sel = document.getElementById('run-agent-select');
  const prev = sel.value;
  sel.innerHTML = '';
  Object.values(agentMap).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.agent_id;
    opt.textContent = `${a.display_name} (${a.agent_type})`;
    sel.appendChild(opt);
  });
  if (prev && agentMap[prev]) sel.value = prev;
  updateSampleChips();
}

document.getElementById('run-agent-select').addEventListener('change', updateSampleChips);

function updateSampleChips() {
  const agentId = document.getElementById('run-agent-select').value;
  const agent = agentMap[agentId];
  const chips = document.getElementById('sample-chips');
  chips.innerHTML = '';
  const samples = SAMPLE_INPUTS[agent?.agent_type] || [];
  samples.forEach(s => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      document.getElementById('run-input').value = s;
    });
    chips.appendChild(chip);
  });
}

document.getElementById('form-run').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    agent_id: document.getElementById('run-agent-select').value,
    input:    document.getElementById('run-input').value.trim(),
  };
  if (!payload.input) return;
  try {
    await apiFetch('/api/agents/run', 'POST', payload);
    closeModal('modal-run');
    e.target.reset();
  } catch (err) {
    alert(`Run failed: ${err.message}`);
  }
});


/* =========================================================
   Agent count badge
   ========================================================= */
function updateAgentCount() {
  const n = Object.keys(agentMap).length;
  document.getElementById('agent-count').textContent = `${n} agent${n === 1 ? '' : 's'}`;
}


/* =========================================================
   Clear feed
   ========================================================= */
document.getElementById('btn-clear-feed').addEventListener('click', () => {
  const feed = document.getElementById('event-feed');
  feed.innerHTML = '<div class="feed-empty">Events will appear here when agents run.</div>';
  feedCount = 0;
});


/* =========================================================
   Toast close
   ========================================================= */
document.getElementById('toast-close').addEventListener('click', () => {
  document.getElementById('result-toast').classList.add('hidden');
});


/* =========================================================
   API helpers
   ========================================================= */
async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.detail || `HTTP ${res.status}`);
  }
  return res.json();
}


/* =========================================================
   Boot
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  initGraph();
  startPolling();
});
