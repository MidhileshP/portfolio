/* Hero globe: a dotted Earth on a 2D canvas with satellites, drag-to-rotate and click-to-task. */
(function () {
  'use strict';

  const canvas = document.getElementById('globe');
  const mask = window.LAND_MASK;
  if (!canvas || !mask) return;
  const ctx = canvas.getContext('2d');
  const logEl = document.getElementById('task-log');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEG = Math.PI / 180;
  const HOME = { lat: 17.385, lon: 78.4867, label: 'HYDERABAD' };
  const SPIN = 0.03;           // Earth's rotation, rad/s
  const CAPTURE_EVERY = 3.4;   // seconds between automatic satellite captures
  const CAPTURE_LIFE = 16;     // seconds a footprint stays on the surface
  const ORBIT_STEPS = 96;

  /* ── Geometry. Unit vectors: +y is north, +z points at the viewer before any rotation. ── */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function toVec(lat, lon) {
    const c = Math.cos(lat * DEG);
    return [c * Math.sin(lon * DEG), Math.sin(lat * DEG), c * Math.cos(lon * DEG)];
  }
  // Spin about the polar axis by `yaw`, then tip towards the viewer by `tilt`.
  function rotate(v, yaw, tilt, out) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const x = v[0] * cy + v[2] * sy;
    const z = -v[0] * sy + v[2] * cy;
    out[0] = x;
    out[1] = v[1] * ct - z * st;
    out[2] = v[1] * st + z * ct;
    return out;
  }
  function unrotate(p, yaw, tilt) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const y = p[1] * ct + p[2] * st;
    const z = -p[1] * st + p[2] * ct;
    return [p[0] * cy - z * sy, y, p[0] * sy + z * cy];
  }
  const toLatLon = (v) => ({ lat: Math.asin(clamp(v[1], -1, 1)) / DEG, lon: Math.atan2(v[0], v[2]) / DEG });
  const formatCoord = (lat, lon) =>
    `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

  /* ── Land dots, sampled from the bitmask on rings of roughly equal spacing ── */
  const bits = atob(mask.data);
  function isLand(lat, lon) {
    const x = Math.min(mask.w - 1, Math.floor(((lon + 180) / 360) * mask.w));
    const y = Math.min(mask.h - 1, Math.floor(((90 - lat) / 180) * mask.h));
    const i = y * mask.w + x;
    return (bits.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  }
  const dots = [];
  const DOT_STEP = 1.9;
  for (let lat = -88; lat <= 88; lat += DOT_STEP) {
    const n = Math.max(1, Math.round((360 / DOT_STEP) * Math.cos(lat * DEG)));
    for (let k = 0; k < n; k++) {
      const lon = -180 + ((k + 0.5) * 360) / n;
      if (isLand(lat, lon)) dots.push(toVec(lat, lon));
    }
  }
  const graticule = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const line = [];
    for (let lat = -84; lat <= 84; lat += 4) line.push(toVec(lat, lon));
    graticule.push(line);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += 4) line.push(toVec(lat, lon));
    graticule.push(line);
  }
  const homeVec = toVec(HOME.lat, HOME.lon);

  /* ── Satellites: circular orbits fixed in space while the Earth turns underneath ── */
  const sats = [
    { name: 'SAT-A', kind: 'optical', radius: 1.2, inc: 97.5 * DEG, node: 0.6, period: 17, phase: 0.5 },
    { name: 'SAT-B', kind: 'SAR', radius: 1.3, inc: 62 * DEG, node: 2.5, period: 23, phase: 2.2 },
    { name: 'SAT-C', kind: 'optical', radius: 1.14, inc: 82 * DEG, node: 4.4, period: 14, phase: 4.0 },
  ];
  function orbitPoint(sat, angle) {
    const x = Math.cos(angle);
    const y = -Math.sin(angle) * Math.sin(sat.inc);
    const z = Math.sin(angle) * Math.cos(sat.inc);
    const cn = Math.cos(sat.node), sn = Math.sin(sat.node);
    return [(x * cn + z * sn) * sat.radius, y * sat.radius, (-x * sn + z * cn) * sat.radius];
  }
  for (const sat of sats) {
    sat.path = [];
    for (let i = 0; i < ORBIT_STEPS; i++) sat.path.push(orbitPoint(sat, (i / ORBIT_STEPS) * Math.PI * 2));
  }
  const satPosition = (sat) => orbitPoint(sat, sat.phase + (time / sat.period) * Math.PI * 2);

  /* ── State ── */
  let width = 0, height = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  let camYaw = -(HOME.lon + 20) * DEG; // start with India just left of centre
  let tilt = 20 * DEG;
  let spin = 0;
  let time = 0;
  let velocity = 0;        // drag inertia, rad per 60 fps frame
  let yawTarget = null;    // Earth yaw to ease towards (set by Portfolio.task)
  let captureClock = 1.2;
  let captureTurn = 0;
  let taskCount = 0;
  const captures = [];

  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    const triplet = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(','); };
    colors = {
      dot: v('--globe-dot'), sea: v('--globe-sea'),
      accent: v('--accent'), accent2: v('--accent-2'), accent2Rgb: triplet(v('--accent-2')),
      text: v('--text'), muted: v('--muted'),
    };
  }

  /* ── Captures: little footprints that stick to the surface, then fade ── */
  function addCapture(lat, lon, kind) {
    lat = clamp(lat, -85, 85);
    const dLat = 3.2;
    const dLon = dLat / Math.max(0.25, Math.cos(lat * DEG));
    captures.push({
      kind,
      born: time,
      centre: toVec(lat, lon),
      corners: [toVec(lat + dLat, lon - dLon), toVec(lat + dLat, lon + dLon), toVec(lat - dLat, lon + dLon), toVec(lat - dLat, lon - dLon)],
    });
    if (captures.length > 14) captures.shift();
  }
  function log(tag, body, statusText) {
    if (!logEl) return null;
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = tag;
    const status = document.createElement('i');
    status.textContent = statusText;
    li.append(b, ` ${body} `, status);
    logEl.prepend(li);
    while (logEl.children.length > 3) logEl.lastElementChild.remove();
    return status;
  }
  function task(lat, lon) {
    addCapture(lat, lon, 'task');
    const id = 'TASK-' + String(++taskCount).padStart(4, '0');
    const status = log(id, formatCoord(lat, lon), 'checking…');
    if (status) setTimeout(() => { status.textContent = 'feasible ✓'; }, 800);
    requestDraw();
    return `${id} at ${formatCoord(lat, lon)}`;
  }
  function autoCapture() {
    const sat = sats[captureTurn++ % sats.length];
    const p = satPosition(sat);
    const len = Math.hypot(p[0], p[1], p[2]);
    const below = toLatLon(unrotate([p[0] / len, p[1] / len, p[2] / len], spin, 0));
    addCapture(below.lat, below.lon, 'sat');
    log(sat.name, formatCoord(below.lat, below.lon), sat.kind);
  }

  /* ── Drawing ── */
  const p = [0, 0, 0];
  const sx = () => cx + p[0] * R;
  const sy = () => cy - p[1] * R;

  function drawOrbits(front) {
    ctx.lineWidth = 1;
    for (const sat of sats) {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= ORBIT_STEPS; i++) {
        rotate(sat.path[i % ORBIT_STEPS], camYaw, tilt, p);
        if ((p[2] >= 0) === front) {
          if (pen) ctx.lineTo(sx(), sy()); else { ctx.moveTo(sx(), sy()); pen = true; }
        } else pen = false;
      }
      ctx.strokeStyle = `rgba(${colors.dot},${front ? 0.24 : 0.1})`;
      ctx.stroke();

      rotate(satPosition(sat), camYaw, tilt, p);
      if ((p[2] >= 0) !== front) continue;
      const x = sx(), y = sy();
      if (front) { // beam down to the point directly below
        const len = Math.hypot(p[0], p[1], p[2]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx + (p[0] / len) * R, cy - (p[1] / len) * R);
        ctx.strokeStyle = `rgba(${colors.accent2Rgb},0.5)`;
        ctx.stroke();
      }
      ctx.globalAlpha = front ? 1 : 0.35;
      ctx.fillStyle = colors.text;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
      if (front && width >= 420) {
        ctx.fillStyle = colors.muted;
        ctx.font = '500 9.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(sat.name, x + 9, y - 6);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawSphere() {
    const halo = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.2);
    halo.addColorStop(0, `rgba(${colors.accent2Rgb},0.2)`);
    halo.addColorStop(1, `rgba(${colors.accent2Rgb},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgb(${colors.sea})`;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    const sheen = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R);
    sheen.addColorStop(0, `rgba(${colors.dot},0.1)`);
    sheen.addColorStop(1, `rgba(${colors.dot},0)`);
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.strokeStyle = `rgba(${colors.dot},0.28)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawSurface(yaw) {
    ctx.strokeStyle = `rgba(${colors.dot},0.07)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of graticule) {
      let pen = false;
      for (const v of line) {
        rotate(v, yaw, tilt, p);
        if (p[2] > 0) {
          if (pen) ctx.lineTo(sx(), sy()); else { ctx.moveTo(sx(), sy()); pen = true; }
        } else pen = false;
      }
    }
    ctx.stroke();

    const size = Math.max(1.1, R * 0.0052);
    ctx.fillStyle = `rgb(${colors.dot})`;
    for (const v of dots) {
      rotate(v, yaw, tilt, p);
      if (p[2] <= 0) continue;
      ctx.globalAlpha = 0.16 + 0.84 * p[2];
      ctx.beginPath();
      ctx.arc(sx(), sy(), size * (0.55 + 0.45 * p[2]), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCaptures(yaw) {
    const corner = [[0, 0], [0, 0], [0, 0], [0, 0]];
    for (let i = captures.length - 1; i >= 0; i--) {
      const c = captures[i];
      const age = time - c.born;
      if (!reduceMotion && age > CAPTURE_LIFE) { captures.splice(i, 1); continue; }
      rotate(c.centre, yaw, tilt, p);
      if (p[2] < 0.1) continue;
      const fade = reduceMotion ? 1 : Math.min(1, age / 0.25) * Math.min(1, (CAPTURE_LIFE - age) / 4);
      const alpha = fade * Math.min(1, p[2] * 2.5);
      for (let k = 0; k < 4; k++) {
        rotate(c.corners[k], yaw, tilt, p);
        corner[k][0] = sx(); corner[k][1] = sy();
      }
      const color = c.kind === 'task' ? colors.accent : colors.accent2;
      ctx.beginPath();
      ctx.moveTo(corner[0][0], corner[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(corner[k][0], corner[k][1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = alpha * 0.16;
      ctx.fill();
      ctx.globalAlpha = alpha * 0.95;
      ctx.stroke();
      if (!reduceMotion && age < 1.5) { // scan line sweeping down the footprint
        const f = age / 1.5;
        ctx.beginPath();
        ctx.moveTo(corner[0][0] + (corner[3][0] - corner[0][0]) * f, corner[0][1] + (corner[3][1] - corner[0][1]) * f);
        ctx.lineTo(corner[1][0] + (corner[2][0] - corner[1][0]) * f, corner[1][1] + (corner[2][1] - corner[1][1]) * f);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHome(yaw) {
    rotate(homeVec, yaw, tilt, p);
    if (p[2] <= 0.05) return;
    const x = sx(), y = sy();
    const visible = Math.min(1, p[2] * 3);
    ctx.strokeStyle = colors.accent;
    ctx.fillStyle = colors.accent;
    ctx.lineWidth = 1.4;
    const rings = reduceMotion ? [0.45] : [(time / 2.4) % 1, (time / 2.4 + 0.5) % 1];
    for (const phase of rings) {
      ctx.globalAlpha = visible * (1 - phase) * 0.85;
      ctx.beginPath();
      ctx.arc(x, y, 4 + phase * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = visible;
    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = colors.text;
    ctx.fillText(HOME.label, x + 12, y + 3.5);
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!width) return;
    const yaw = camYaw + spin;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawOrbits(false);
    drawSphere();
    drawSurface(yaw);
    drawCaptures(yaw);
    drawHome(yaw);
    drawOrbits(true);
  }

  /* ── Loop: runs only while the hero is on screen; one frame at a time under reduced motion ── */
  let rafId = 0;
  let last = 0;
  let onScreen = true;
  function frame(now) {
    rafId = 0;
    // rAF timestamps can predate the performance.now() taken in requestDraw, hence the lower bound.
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    if (!reduceMotion) {
      time += dt;
      spin += dt * SPIN;
      if (!dragging) {
        camYaw += velocity * dt * 60;
        velocity *= Math.pow(0.94, dt * 60);
        if (yawTarget !== null) {
          let d = yawTarget - spin - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          camYaw += d * Math.min(1, dt * 4);
          if (Math.abs(d) < 0.003) yawTarget = null;
        }
      }
      captureClock -= dt;
      if (captureClock <= 0) { captureClock = CAPTURE_EVERY; autoCapture(); }
    }
    draw();
    if (!reduceMotion && onScreen && !document.hidden) rafId = requestAnimationFrame(frame);
  }
  function requestDraw() {
    if (rafId) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /* ── Interaction ── */
  let dragging = false;
  let lastX = 0, lastY = 0, travel = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    dragging = true;
    travel = 0;
    velocity = 0;
    yawTarget = null;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    travel += Math.abs(dx) + Math.abs(dy);
    camYaw += dx / R;
    velocity = dx / R;
    // Vertical drags scroll the page on touch, so only the mouse tilts the globe.
    if (e.pointerType === 'mouse') tilt = clamp(tilt + dy / R, -0.9, 1.1);
    requestDraw();
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (e.type !== 'pointerup' || travel > 6) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - cx) / R;
    const y = -(e.clientY - rect.top - cy) / R;
    const d = x * x + y * y;
    if (d >= 1) return; // clicked space, not the surface
    const hit = toLatLon(unrotate([x, y, Math.sqrt(1 - d)], camYaw + spin, tilt));
    task(hit.lat, hit.lon);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* ── Sizing, visibility, theme ── */
  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    R = Math.min(width, height) * 0.36;
    cx = width / 2;
    cy = height / 2;
    draw();
    requestDraw();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; if (onScreen) requestDraw(); }).observe(canvas);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestDraw(); });
  window.addEventListener('themechange', () => { readColors(); requestDraw(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestDraw);

  readColors();
  resize();

  // Used by the terminal's `task <lat> <lon>` command: drop a capture and swing the globe round to it.
  (window.Portfolio = window.Portfolio || {}).task = function (lat, lon) {
    yawTarget = -lon * DEG;
    if (reduceMotion) { camYaw = yawTarget - spin; yawTarget = null; }
    return task(lat, lon);
  };
})();
