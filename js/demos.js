/* The three project toys: a tiny sequence CRDT, an image filter bench and a meme press. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Draw `img` so it fills the canvas, cropping the overflow (like CSS object-fit: cover).
  function cover(ctx, img, W, H) {
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }
  function loadImageFile(input, onLoad) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { onLoad(img); URL.revokeObjectURL(url); };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
      input.value = '';
    });
  }

  /* ───────────── DocSpace toy: two replicas of one document ─────────────
     An RGA-style sequence CRDT. Every character has a unique [clock, site] id and
     remembers which character it was typed after; deletes leave a tombstone. Applying
     the same set of operations in any order gives both replicas the same text. */
  (function crdtToy() {
    const areaA = $('#crdt-a'), areaB = $('#crdt-b');
    if (!areaA || !areaB) return;
    const wire = $('#crdt-wire'), queueLabel = $('#crdt-q'), status = $('#crdt-status');
    const linkBtn = $('#crdt-link'), demoBtn = $('#crdt-demo');
    const LATENCY = 420;
    const SEED = 'CRDTs let two people edit the same text.';

    const sameId = (a, b) => a[0] === b[0] && a[1] === b[1];
    const isNewer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

    class Replica {
      constructor(site) { this.site = site; this.clock = 0; this.items = []; }
      text() { let s = ''; for (const it of this.items) if (!it.gone) s += it.ch; return s; }
      find(id) { return this.items.findIndex((it) => sameId(it.id, id)); }
      nthVisible(n) { for (const it of this.items) if (!it.gone && n-- === 0) return it; return null; }

      // Local edits return the operation to send to the other replica.
      insert(pos, ch) {
        const left = pos > 0 ? this.nthVisible(pos - 1) : null;
        const op = { type: 'ins', id: [++this.clock, this.site], ch, after: left ? left.id : null };
        this.apply(op);
        return op;
      }
      remove(pos) {
        const op = { type: 'del', id: this.nthVisible(pos).id };
        this.apply(op);
        return op;
      }
      apply(op) {
        if (op.type === 'del') {
          const i = this.find(op.id);
          if (i !== -1) this.items[i].gone = true;
          return;
        }
        this.clock = Math.max(this.clock, op.id[0]);
        if (this.find(op.id) !== -1) return;
        // Go right after the character it was typed after, then step past any
        // concurrent inserts with a newer id so every replica picks the same order.
        let i = op.after ? this.find(op.after) + 1 : 0;
        while (i < this.items.length && isNewer(this.items[i].id, op.id)) i++;
        this.items.splice(i, 0, { id: op.id, ch: op.ch, gone: false });
      }

      // Caret bookkeeping: remember the character left of the caret, find it again after a merge.
      anchor(pos) { const it = pos > 0 ? this.nthVisible(pos - 1) : null; return it ? it.id : null; }
      position(anchorId) {
        if (!anchorId) return 0;
        let n = 0;
        for (const it of this.items) {
          if (!it.gone) n++;
          if (sameId(it.id, anchorId)) break;
        }
        return n;
      }
    }

    const peers = {
      A: { replica: new Replica('A'), area: areaA, outbox: [], other: 'B', dir: 'ab' },
      B: { replica: new Replica('B'), area: areaB, outbox: [], other: 'A', dir: 'ba' },
    };
    let online = true;
    let inFlight = 0;
    let merged = false;
    let demoRunning = false;

    function setStatus(cls, text) {
      status.className = 'toy-status' + (cls ? ' ' + cls : '');
      if (status.textContent !== text) status.textContent = text;
    }
    function refresh() {
      const queued = peers.A.outbox.length + peers.B.outbox.length;
      const synced = peers.A.replica.text() === peers.B.replica.text();
      wire.classList.toggle('offline', !online);
      queueLabel.textContent = online ? '' : queued ? `${queued} queued` : 'offline';
      linkBtn.setAttribute('aria-pressed', !online);
      linkBtn.textContent = online ? 'Go offline' : 'Reconnect';
      if (!online) setStatus('offline', queued ? `Offline. ${queued} edit${queued === 1 ? '' : 's'} waiting to sync.` : 'Offline. Edit both sides, then reconnect.');
      else if (inFlight || !synced) setStatus('pending', 'Syncing…');
      else setStatus('', merged ? 'Merged. Both replicas are identical.' : 'Replicas in sync.');
    }

    function receive(name, ops) {
      const { replica, area } = peers[name];
      const focused = document.activeElement === area;
      const start = replica.anchor(area.selectionStart), end = replica.anchor(area.selectionEnd);
      ops.forEach((op) => replica.apply(op));
      area.value = replica.text();
      if (focused) area.setSelectionRange(replica.position(start), replica.position(end));
    }
    function transmit(from, ops) {
      const peer = peers[from];
      inFlight++;
      const dot = document.createElement('span');
      dot.className = 'pkt ' + peer.dir;
      dot.style.setProperty('--d', LATENCY + 'ms');
      wire.appendChild(dot);
      setTimeout(() => {
        dot.remove();
        receive(peer.other, ops);
        inFlight--;
        refresh();
      }, LATENCY);
    }
    function send(from, ops) {
      if (!ops.length) return;
      if (online) transmit(from, ops);
      else peers[from].outbox.push(...ops);
      refresh();
    }
    function setOnline(next) {
      online = next;
      if (online) {
        for (const name of ['A', 'B']) {
          const queued = peers[name].outbox.splice(0);
          if (queued.length) { merged = true; transmit(name, queued); }
        }
      } else merged = false;
      refresh();
    }

    // Turn whatever the textarea now contains into delete + insert operations.
    function onInput(name) {
      const { replica, area } = peers[name];
      const before = replica.text(), after = area.value;
      let start = 0;
      const max = Math.min(before.length, after.length);
      while (start < max && before[start] === after[start]) start++;
      let endBefore = before.length, endAfter = after.length;
      while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
      const ops = [];
      for (let i = start; i < endBefore; i++) ops.push(replica.remove(start));
      for (let i = start; i < endAfter; i++) ops.push(replica.insert(i, after[i]));
      if (online) merged = false;
      send(name, ops);
    }

    for (const ch of SEED) peers.B.replica.apply(peers.A.replica.insert(peers.A.replica.items.length, ch));
    for (const name of ['A', 'B']) {
      const peer = peers[name];
      peer.area.maxLength = 400;
      peer.area.value = peer.replica.text();
      peer.area.addEventListener('input', () => onInput(name));
    }
    linkBtn.addEventListener('click', () => { if (!demoRunning) setOnline(!online); });

    // Scripted demo: both peers type at the end of the document while disconnected.
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function type(name, ch) {
      const { area } = peers[name];
      if (area.value.length >= area.maxLength) return;
      area.value += ch;
      onInput(name);
    }
    demoBtn.addEventListener('click', async () => {
      if (demoRunning) return;
      demoRunning = true;
      demoBtn.disabled = linkBtn.disabled = true;
      if (!online) { setOnline(true); await wait(LATENCY + 250); }
      setOnline(false);
      await wait(350);
      const lines = { A: ' Even offline.', B: ' No locks needed.' };
      for (let i = 0; i < Math.max(lines.A.length, lines.B.length); i++) {
        if (lines.A[i]) type('A', lines.A[i]);
        if (lines.B[i]) type('B', lines.B[i]);
        await wait(55);
      }
      await wait(1100);
      setOnline(true);
      await wait(LATENCY + 200);
      demoRunning = false;
      demoBtn.disabled = linkBtn.disabled = false;
    });

    refresh();
  })();

  /* ───────────── Image editor toy: live filters over generated terrain ───────────── */
  (function imageToy() {
    const canvas = $('#img-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sliders = $$('.imgtoy [data-filter]');
    const presetBtns = $$('.imgtoy [data-preset]');
    const UNITS = { brightness: '%', contrast: '%', saturate: '%', hue: '°', blur: 'px' };
    const PRESETS = {
      original: { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0 },
      mono: { brightness: 105, contrast: 130, saturate: 0, hue: 0, blur: 0 },
      'false-colour': { brightness: 105, contrast: 120, saturate: 190, hue: 265, blur: 0 },
      haze: { brightness: 120, contrast: 76, saturate: 70, hue: 0, blur: 1.5 },
    };
    // Height → colour, from deep water up to snow.
    const RAMP = [
      [0.00, [7, 28, 58]], [0.38, [13, 60, 104]], [0.468, [38, 122, 152]], [0.475, [198, 184, 136]],
      [0.50, [164, 162, 106]], [0.53, [98, 138, 70]], [0.64, [50, 98, 52]], [0.74, [92, 94, 72]],
      [0.83, [132, 124, 112]], [0.90, [236, 240, 242]], [1.00, [255, 255, 255]],
    ];
    const SEA_LEVEL = 0.475;

    function mulberry32(seed) {
      return function () {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function terrain(seed) {
      const W = canvas.width, H = canvas.height;
      const rand = mulberry32(seed);
      const G = 64;
      const grid = new Float32Array(G * G);
      for (let i = 0; i < grid.length; i++) grid[i] = rand();
      const at = (x, y) => grid[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
      const smooth = (t) => t * t * (3 - 2 * t);
      const noise = (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const fx = smooth(x - xi), fy = smooth(y - yi);
        const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
        const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
        return top + (bottom - top) * fy;
      };

      const heights = new Float32Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let h = 0, amp = 0.5, freq = 1 / 120;
          for (let octave = 0; octave < 6; octave++) {
            h += amp * noise(x * freq + octave * 17.3, y * freq + octave * 9.1);
            amp *= 0.5;
            freq *= 2.03;
          }
          heights[y * W + x] = Math.min(1, Math.max(0, (h / 0.984 - 0.5) * 2.1 + 0.5));
        }
      }

      const image = ctx.createImageData(W, H);
      const px = image.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const h = heights[y * W + x];
          let k = 1;
          while (k < RAMP.length - 1 && RAMP[k][0] < h) k++;
          const [h0, c0] = RAMP[k - 1], [h1, c1] = RAMP[k];
          const f = (h - h0) / (h1 - h0);
          // Hillshade: light from the north-west, land only.
          let shade = 1;
          if (h > SEA_LEVEL && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
            const slope = heights[(y + 1) * W + x + 1] - heights[(y - 1) * W + x - 1];
            shade = 1 + Math.min(0.4, Math.max(-0.4, slope * 16));
          }
          const o = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) px[o + c] = Math.min(255, (c0[c] + (c1[c] - c0[c]) * f) * shade);
          px[o + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }

    function applyFilters() {
      const v = {};
      sliders.forEach((s) => {
        v[s.dataset.filter] = Number(s.value);
        s.parentElement.querySelector('output').textContent = s.value + UNITS[s.dataset.filter];
      });
      canvas.style.filter = `brightness(${v.brightness}%) contrast(${v.contrast}%) saturate(${v.saturate}%) hue-rotate(${v.hue}deg) blur(${v.blur}px)`;
    }
    function markPreset(name) {
      presetBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.preset === name));
    }
    sliders.forEach((s) => s.addEventListener('input', () => { markPreset(null); applyFilters(); }));
    presetBtns.forEach((b) => b.addEventListener('click', () => {
      const preset = PRESETS[b.dataset.preset];
      sliders.forEach((s) => { s.value = preset[s.dataset.filter]; });
      markPreset(b.dataset.preset);
      applyFilters();
    }));

    let seed = 7;
    $('#img-new').addEventListener('click', () => terrain(++seed * 7919));
    loadImageFile($('#img-file'), (img) => cover(ctx, img, canvas.width, canvas.height));

    terrain(seed * 7919);
    applyFilters();
  })();

  /* ───────────── Meme toy: captions on a canvas ───────────── */
  (function memeToy() {
    const canvas = $('#meme-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const top = $('#meme-top'), bottom = $('#meme-bottom');
    const W = canvas.width, H = canvas.height;
    const TEMPLATES = [
      { emoji: '🛰️', from: '#0b1c33', to: '#2a5a86' },
      { emoji: '🐛', from: '#1c3a1a', to: '#6ea04f' },
      { emoji: '🔥', from: '#4a1404', to: '#e2761b' },
      { emoji: '🐇', from: '#35173f', to: '#c2577e' },
    ];
    const fontOf = (size) => `900 ${size}px Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif`;
    let template = 0;
    let photo = null;

    function caption(text, edge) {
      text = text.trim().toUpperCase();
      if (!text) return;
      let size = 52;
      ctx.font = fontOf(size);
      while (size > 18 && ctx.measureText(text).width > W - 40) ctx.font = fontOf((size -= 2));
      ctx.textAlign = 'center';
      ctx.textBaseline = edge === 'top' ? 'top' : 'bottom';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size / 7);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#fff';
      const y = edge === 'top' ? 18 : H - 16;
      ctx.strokeText(text, W / 2, y);
      ctx.fillText(text, W / 2, y);
    }
    function draw() {
      if (photo) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        cover(ctx, photo, W, H);
      } else {
        const t = TEMPLATES[template];
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, t.from);
        bg.addColorStop(1, t.to);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.font = '168px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(t.emoji, W / 2, H / 2 + 10);
      }
      caption(top.value, 'top');
      caption(bottom.value, 'bottom');
    }

    top.addEventListener('input', draw);
    bottom.addEventListener('input', draw);
    $('#meme-next').addEventListener('click', () => {
      photo = null;
      template = (template + 1) % TEMPLATES.length;
      draw();
    });
    loadImageFile($('#meme-file'), (img) => { photo = img; draw(); });
    $('#meme-save').addEventListener('click', () => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'meme.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    });

    draw();
  })();
})();
