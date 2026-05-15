'use strict';
/* global window, document, requestAnimationFrame, cancelAnimationFrame */

// ── Constants ───────────────────────────────────────────────────────────────

const REPULSION      = 4000;   // Coulomb repulsion between all pairs
const SPRING_LEN     = 160;    // Ideal edge length (px)
const SPRING_K       = 0.04;   // Spring stiffness
const GRAVITY        = 0.008;  // Pull toward canvas centre
const DAMPING        = 0.82;   // Velocity damping per tick
const MIN_RADIUS     = 14;
const MAX_RADIUS     = 44;
const TICK_THRESHOLD = 0.15;   // Stop simulation when max velocity < this
const MAX_TICKS      = 600;    // Hard cap to prevent infinite loops

// ── Colour palette (brand-aligned) ─────────────────────────────────────────

const PALETTE = [
  '#2AA6A1', '#5FD4E6', '#6A8FA8', '#4DB6AC', '#80CBC4',
  '#26A69A', '#4DD0E1', '#4FC3F7', '#29B6F6', '#26C6DA',
  '#80DEEA', '#4CAF50', '#81C784', '#AED581', '#DCE775',
  '#FFD54F', '#FFB74D', '#FF8A65', '#A1887F', '#90A4AE',
];

function paletteColor(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h) ^ id.charCodeAt(i);
    h = h & 0x7fffffff;
  }
  return PALETTE[h % PALETTE.length];
}

// ── Graph state ─────────────────────────────────────────────────────────────

let _canvas    = null;
let _ctx       = null;
let _nodes     = [];   // { id, label, entryCount, x, y, vx, vy, r, color }
let _edges     = [];   // { sourceIdx, targetIdx, weight, alpha }
let _rafId     = null;
let _tickCount = 0;

// Viewport transform
let _scale  = 1;
let _tx     = 0;   // translation x
let _ty     = 0;   // translation y

// Interaction state
let _draggingNode = null;
let _draggingBg   = false;
let _dragStart    = { x: 0, y: 0 };
let _tooltip      = null;

// Navigation callback — called with theme id when user clicks a node
let _onNavigate = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the graph inside `container`.
 * @param {HTMLElement} container
 * @param {Function}    onNavigate  (themeId) => void
 */
function graphInit(container, onNavigate) {
  _onNavigate = onNavigate;

  // Create canvas
  _canvas = document.createElement('canvas');
  _canvas.className = 'graph-canvas';
  container.appendChild(_canvas);

  // Create tooltip element
  _tooltip = document.createElement('div');
  _tooltip.className = 'graph-tooltip hidden';
  container.appendChild(_tooltip);

  _ctx = _canvas.getContext('2d');

  _bindEvents();
  _resizeCanvas();
  window.addEventListener('resize', _resizeCanvas);
}

/**
 * Load graph data and start the simulation.
 * @param {{ nodes: object[], edges: object[] }} data
 */
function graphLoad(data) {
  _stopSim();
  _initNodes(data.nodes);
  _initEdges(data.edges);
  _resetViewport();
  _startSim();
}

/** Clean up — call when the view is unmounted. */
function graphDestroy() {
  _stopSim();
  window.removeEventListener('resize', _resizeCanvas);
  if (_canvas) {
    _unbindEvents();
    _canvas.remove();
    _canvas = null;
  }
  if (_tooltip) {
    _tooltip.remove();
    _tooltip = null;
  }
  _nodes = [];
  _edges = [];
  _onNavigate = null;
}

// ── Initialisation helpers ───────────────────────────────────────────────────

function _initNodes(rawNodes) {
  if (!rawNodes || rawNodes.length === 0) { _nodes = []; return; }

  const maxCount = Math.max(...rawNodes.map((n) => n.entryCount || 0), 1);
  const W = _canvas ? _canvas.width  : 800;
  const H = _canvas ? _canvas.height : 600;

  _nodes = rawNodes.map((n) => {
    const t = Math.sqrt((n.entryCount || 0) / maxCount);
    const r = MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
    return {
      id:         n.id,
      label:      n.label,
      entryCount: n.entryCount || 0,
      x:          W / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.5,
      y:          H / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.5,
      vx:         0,
      vy:         0,
      r,
      color:      paletteColor(n.id),
    };
  });
}

function _initEdges(rawEdges) {
  if (!rawEdges || rawEdges.length === 0) { _edges = []; return; }

  const idxMap = Object.create(null);
  _nodes.forEach((n, i) => { idxMap[n.id] = i; });

  const maxW = Math.max(...rawEdges.map((e) => e.weight || 1), 1);

  _edges = rawEdges
    .filter((e) => idxMap[e.source] !== undefined && idxMap[e.target] !== undefined)
    .map((e) => ({
      sourceIdx: idxMap[e.source],
      targetIdx: idxMap[e.target],
      weight:    e.weight || 1,
      alpha:     0.2 + 0.6 * ((e.weight || 1) / maxW),
    }));
}

// ── Viewport ─────────────────────────────────────────────────────────────────

function _resetViewport() {
  _scale = 1;
  if (_canvas) {
    _tx = _canvas.width  / 2;
    _ty = _canvas.height / 2;
  }
}

function _resizeCanvas() {
  if (!_canvas) return;
  const parent = _canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  _canvas.width  = rect.width  || 800;
  _canvas.height = rect.height || 600;
  _render();
}

// ── Simulation ───────────────────────────────────────────────────────────────

function _startSim() {
  _tickCount = 0;
  function loop() {
    _tick();
    _render();
    _tickCount++;
    const maxV = _nodes.reduce((m, n) => Math.max(m, Math.abs(n.vx), Math.abs(n.vy)), 0);
    if (maxV > TICK_THRESHOLD && _tickCount < MAX_TICKS) {
      _rafId = requestAnimationFrame(loop);
    } else {
      _rafId = null;
      _render(); // final render
    }
  }
  _rafId = requestAnimationFrame(loop);
}

function _stopSim() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

function _resumeSim() {
  if (_rafId !== null) return; // already running
  _tickCount = 0;
  _startSim();
}

function _tick() {
  const n = _nodes;
  if (n.length === 0) return;

  const W = _canvas.width  / _scale;
  const H = _canvas.height / _scale;

  // Centre of mass in graph space (approximate gravity target)
  const cx = -_tx / _scale + _canvas.width  / 2 / _scale;
  const cy = -_ty / _scale + _canvas.height / 2 / _scale;

  // Zero forces
  const fx = new Float64Array(n.length);
  const fy = new Float64Array(n.length);

  // Repulsion (pairwise)
  for (let i = 0; i < n.length; i++) {
    for (let j = i + 1; j < n.length; j++) {
      const dx = n[j].x - n[i].x;
      const dy = n[j].y - n[i].y;
      const d2 = dx * dx + dy * dy + 1;
      const f  = REPULSION / d2;
      const nx = dx / Math.sqrt(d2);
      const ny = dy / Math.sqrt(d2);
      fx[i] -= f * nx;
      fy[i] -= f * ny;
      fx[j] += f * nx;
      fy[j] += f * ny;
    }
  }

  // Spring attraction along edges
  _edges.forEach(({ sourceIdx, targetIdx }) => {
    const a = n[sourceIdx];
    const b = n[targetIdx];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const stretch = dist - SPRING_LEN;
    const f = SPRING_K * stretch;
    fx[sourceIdx] += f * (dx / dist);
    fy[sourceIdx] += f * (dy / dist);
    fx[targetIdx] -= f * (dx / dist);
    fy[targetIdx] -= f * (dy / dist);
  });

  // Gravity toward canvas centre
  n.forEach((node, i) => {
    fx[i] += GRAVITY * (cx - node.x);
    fy[i] += GRAVITY * (cy - node.y);
  });

  // Integrate + damp
  n.forEach((node, i) => {
    if (node === _draggingNode) return; // frozen during drag
    node.vx = (node.vx + fx[i]) * DAMPING;
    node.vy = (node.vy + fy[i]) * DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  if (!_ctx || !_canvas) return;
  const ctx = _ctx;
  const W = _canvas.width;
  const H = _canvas.height;

  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(_tx, _ty);
  ctx.scale(_scale, _scale);

  // Edges
  _edges.forEach(({ sourceIdx, targetIdx, alpha, weight }) => {
    const a = _nodes[sourceIdx];
    const b = _nodes[targetIdx];
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    const isDark = document.body.classList.contains('theme-light') ? false : true;
    ctx.strokeStyle = isDark
      ? `rgba(95, 212, 230, ${alpha * 0.6})`
      : `rgba(28, 42, 58, ${alpha * 0.5})`;
    ctx.lineWidth = Math.max(0.5, Math.min(4, weight * 0.4)) / _scale;
    ctx.stroke();
  });

  // Nodes
  _nodes.forEach((node) => {
    // Shadow glow
    ctx.shadowBlur  = node === _draggingNode ? 18 : 8;
    ctx.shadowColor = node.color;

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fillStyle = node.color;
    ctx.fill();

    ctx.shadowBlur = 0;

    // Border
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    const isDark = !document.body.classList.contains('theme-light');
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1.5 / _scale;
    ctx.stroke();

    // Label (always shown for nodes with r >= 20; small nodes only on hover)
    const showLabel = node.r * _scale >= 20;
    if (showLabel) {
      const fontSize = Math.max(9, Math.min(13, node.r * 0.55));
      ctx.font      = `500 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur   = 3;
      ctx.shadowColor  = 'rgba(0,0,0,0.7)';

      // Truncate label to fit inside node
      const maxW = node.r * 1.6;
      let text = node.label;
      while (ctx.measureText(text).width > maxW && text.length > 3) {
        text = text.slice(0, -1);
      }
      if (text !== node.label) text = text.trim() + '…';
      ctx.fillText(text, node.x, node.y);
      ctx.shadowBlur = 0;
    }
  });

  ctx.restore();

  // Empty-state message
  if (_nodes.length === 0) {
    ctx.font      = '16px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(128,128,128,0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No themes yet — capture some thoughts and run clustering', W / 2, H / 2);
  }
}

// ── Event binding ────────────────────────────────────────────────────────────

function _bindEvents() {
  _canvas.addEventListener('mousedown',  _onMouseDown);
  _canvas.addEventListener('mousemove',  _onMouseMove);
  _canvas.addEventListener('mouseup',    _onMouseUp);
  _canvas.addEventListener('mouseleave', _onMouseLeave);
  _canvas.addEventListener('wheel',      _onWheel,      { passive: false });
  _canvas.addEventListener('click',      _onClick);
  _canvas.addEventListener('dblclick',   _onDblClick);
}

function _unbindEvents() {
  if (!_canvas) return;
  _canvas.removeEventListener('mousedown',  _onMouseDown);
  _canvas.removeEventListener('mousemove',  _onMouseMove);
  _canvas.removeEventListener('mouseup',    _onMouseUp);
  _canvas.removeEventListener('mouseleave', _onMouseLeave);
  _canvas.removeEventListener('wheel',      _onWheel);
  _canvas.removeEventListener('click',      _onClick);
  _canvas.removeEventListener('dblclick',   _onDblClick);
}

// Convert canvas pixel coords to graph coords
function _toGraph(px, py) {
  return {
    x: (px - _tx) / _scale,
    y: (py - _ty) / _scale,
  };
}

function _hitNode(px, py) {
  const g = _toGraph(px, py);
  for (let i = _nodes.length - 1; i >= 0; i--) {
    const n = _nodes[i];
    const dx = g.x - n.x;
    const dy = g.y - n.y;
    if (dx * dx + dy * dy <= n.r * n.r) return n;
  }
  return null;
}

function _onMouseDown(e) {
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = _hitNode(px, py);
  if (hit) {
    _draggingNode = hit;
    _canvas.style.cursor = 'grabbing';
    _resumeSim();
  } else {
    _draggingBg = true;
    _dragStart  = { x: e.clientX - _tx, y: e.clientY - _ty };
    _canvas.style.cursor = 'grabbing';
  }
}

function _onMouseMove(e) {
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  if (_draggingNode) {
    const g = _toGraph(px, py);
    _draggingNode.x  = g.x;
    _draggingNode.y  = g.y;
    _draggingNode.vx = 0;
    _draggingNode.vy = 0;
    _render();
    _hideTooltip();
    return;
  }

  if (_draggingBg) {
    _tx = e.clientX - _dragStart.x;
    _ty = e.clientY - _dragStart.y;
    _render();
    return;
  }

  // Hover tooltip
  const hit = _hitNode(px, py);
  if (hit) {
    _canvas.style.cursor = 'pointer';
    _showTooltip(hit, e.clientX, e.clientY);
  } else {
    _canvas.style.cursor = '';
    _hideTooltip();
  }
}

function _onMouseUp() {
  if (_draggingNode) {
    _draggingNode.vx = 0;
    _draggingNode.vy = 0;
    _draggingNode = null;
  }
  _draggingBg = false;
  _canvas.style.cursor = '';
}

function _onMouseLeave() {
  _onMouseUp();
  _hideTooltip();
}

function _onWheel(e) {
  e.preventDefault();
  const rect  = _canvas.getBoundingClientRect();
  const px    = e.clientX - rect.left;
  const py    = e.clientY - rect.top;
  const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.min(4, Math.max(0.2, _scale * delta));
  // Zoom toward cursor
  _tx = px - (px - _tx) * (newScale / _scale);
  _ty = py - (py - _ty) * (newScale / _scale);
  _scale = newScale;
  _render();
}

// Single click — navigate to themes view for this node
function _onClick(e) {
  if (_draggingBg) return; // was a pan
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = _hitNode(px, py);
  if (hit && _onNavigate) _onNavigate(hit.id);
}

// Double-click background — reset zoom
function _onDblClick(e) {
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  if (!_hitNode(px, py)) {
    _resetViewport();
    _render();
  }
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function _showTooltip(node, cx, cy) {
  if (!_tooltip) return;
  _tooltip.innerHTML =
    `<strong>${_escHtml(node.label)}</strong>` +
    `<span class="graph-tooltip-count">${node.entryCount} entr${node.entryCount === 1 ? 'y' : 'ies'}</span>` +
    `<span class="graph-tooltip-hint">Click to open in Themes</span>`;

  const rect   = _canvas.getBoundingClientRect();
  const left   = cx - rect.left + 12;
  const top    = cy - rect.top  - 8;
  _tooltip.style.left = `${left}px`;
  _tooltip.style.top  = `${top}px`;
  _tooltip.classList.remove('hidden');
}

function _hideTooltip() {
  if (_tooltip) _tooltip.classList.add('hidden');
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Export ───────────────────────────────────────────────────────────────────

window.graphView = { graphInit, graphLoad, graphDestroy };
