/* Page behaviour: theme, clock, scroll effects, the order pipeline, the stack filter. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // Shared hooks for the other scripts (globe.js adds `task`, terminal.js reads these).
  const Portfolio = (window.Portfolio = window.Portfolio || {});

  /* ── Theme ── */
  const themeMeta = $('meta[name="theme-color"]');
  function setTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch (e) { /* private mode: theme just won't persist */ }
    if (themeMeta) themeMeta.content = theme === 'light' ? '#f3efe5' : '#05080c';
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }
  Portfolio.setTheme = setTheme;
  Portfolio.getTheme = () => root.dataset.theme;
  $('#theme-toggle').addEventListener('click', () => setTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
  if (themeMeta && root.dataset.theme === 'light') themeMeta.content = '#f3efe5';

  /* ── Hyderabad clock ── */
  const clock = $('#ist-clock');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const tick = () => { clock.textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 1000);
  }

  /* ── Scroll progress + nav border ── */
  const progress = $('.progress');
  const nav = $('.nav');
  let scrollQueued = false;
  function onScroll() {
    scrollQueued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty('--p', max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0);
    nav.classList.toggle('scrolled', scrollY > 8);
  }
  addEventListener('scroll', () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ── Reveal on scroll ── */
  const revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  /* ── Active nav link ── */
  const navLinks = $$('.nav-links a');
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + entry.target.id));
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main > section[id]').forEach((s) => spy.observe(s));
  }

  /* ── Count-up stats ── */
  const stats = $('.stats');
  if (stats && !reduceMotion && 'IntersectionObserver' in window) {
    const counters = $$('[data-count]', stats);
    const render = (el, value) => {
      const decimals = Number(el.dataset.decimals || 0);
      el.textContent = value.toFixed(decimals) + (el.dataset.suffix || '');
    };
    counters.forEach((el) => render(el, 0));
    new IntersectionObserver((entries, io) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const duration = 1400;
      (function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        counters.forEach((el) => render(el, Number(el.dataset.count) * eased));
        if (t < 1) requestAnimationFrame(frame);
      })(start);
    }, { threshold: 0.4 }).observe(stats);
  }

  /* ── Order pipeline (tabs with auto-advance) ── */
  const pipeline = $('#pipeline');
  if (pipeline) {
    const track = $('.pipe-track', pipeline);
    const tabs = $$('.pipe-node', pipeline);
    const panels = $$('.pipe-panel', pipeline);
    const autoBtn = $('#pipe-auto');
    const STEP_MS = 4500;
    let active = 0;
    let auto = !reduceMotion;
    let inView = false;
    let timer = null;

    function select(index, focus) {
      active = (index + tabs.length) % tabs.length;
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', i === active);
        tab.tabIndex = i === active ? 0 : -1;
        tab.classList.toggle('done', i < active);
      });
      panels.forEach((panel, i) => panel.classList.toggle('is-active', i === active));
      track.style.setProperty('--i', active);
      if (focus) tabs[active].focus();
    }
    function schedule() {
      clearInterval(timer);
      if (auto && inView && !document.hidden) timer = setInterval(() => select(active + 1), STEP_MS);
    }
    function setAuto(on) {
      auto = on;
      autoBtn.setAttribute('aria-pressed', on);
      autoBtn.textContent = 'Auto-advance: ' + (on ? 'on' : 'off');
      schedule();
    }

    tabs.forEach((tab, i) => tab.addEventListener('click', () => { select(i); setAuto(false); }));
    track.addEventListener('keydown', (e) => {
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (move) { e.preventDefault(); select(active + move, true); setAuto(false); }
      else if (e.key === 'Home') { e.preventDefault(); select(0, true); setAuto(false); }
      else if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, true); setAuto(false); }
    });
    autoBtn.addEventListener('click', () => setAuto(!auto));
    document.addEventListener('visibilitychange', schedule);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; schedule(); }, { threshold: 0.35 }).observe(pipeline);
    }
    select(0);
    setAuto(auto);
  }

  /* ── Stack: light up skills by where they were used ── */
  const stack = $('.stack');
  if (stack) {
    const filterBtns = $$('.stack-filter button', stack);
    const skills = $$('[data-skill]', stack);
    const info = $('#stack-info');
    const names = Object.fromEntries(filterBtns.map((b) => [b.dataset.filter, b.textContent.trim()]));
    const usedBy = (skill) => (skill.dataset.used || '').split(' ').filter(Boolean);
    let current = 'all';
    let summary = info.textContent;

    function applyFilter(key) {
      current = key;
      let lit = 0;
      filterBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === key));
      skills.forEach((skill) => {
        const on = key === 'all' || usedBy(skill).includes(key);
        skill.classList.toggle('off', !on);
        if (on) lit++;
      });
      stack.classList.toggle('filtered', key !== 'all');
      summary = key === 'all'
        ? `Showing all ${skills.length} tools.`
        : `${lit} of ${skills.length} tools used on ${names[key]}.`;
      info.textContent = summary;
    }
    filterBtns.forEach((b) => b.addEventListener('click', () => applyFilter(b.dataset.filter)));

    function hint(skill) {
      const used = usedBy(skill);
      filterBtns.forEach((b) => b.classList.toggle('hint', used.includes(b.dataset.filter)));
      info.textContent = used.length
        ? `${skill.textContent} → ${used.map((k) => names[k]).join(', ')}`
        : `${skill.textContent} → part of my general toolkit`;
    }
    function clearHint() {
      filterBtns.forEach((b) => b.classList.remove('hint'));
      info.textContent = summary;
    }
    skills.forEach((skill) => {
      skill.addEventListener('pointerenter', () => hint(skill));
      skill.addEventListener('focus', () => hint(skill));
      skill.addEventListener('pointerleave', clearHint);
      skill.addEventListener('blur', clearHint);
    });
    applyFilter(current);
  }

  /* ── Certificate cards: tilt towards the pointer ── */
  if (!reduceMotion && matchMedia('(hover: hover)').matches) {
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(2) + 'deg');
        card.style.setProperty('--ry', ((x - 0.5) * 12).toFixed(2) + 'deg');
        card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ── Copy email ── */
  const copyBtn = $('#copy-email');
  if (copyBtn) {
    const label = copyBtn.textContent;
    let resetTimer = null;
    copyBtn.addEventListener('click', async () => {
      const email = copyBtn.dataset.email;
      let ok = false;
      try { await navigator.clipboard.writeText(email); ok = true; } catch (e) { /* clipboard blocked (e.g. file://): fall back to mail */ }
      if (!ok) { location.href = 'mailto:' + email; return; }
      copyBtn.textContent = 'Copied ✓';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { copyBtn.textContent = label; }, 1800);
    });
  }

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();
})();
