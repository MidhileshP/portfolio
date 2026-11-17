/* The terminal overlay. Open with "/" or Cmd/Ctrl+K. Its answers are read from the page itself,
   so editing index.html is enough to keep it up to date. */
(function () {
  'use strict';

  const dlg = document.getElementById('terminal');
  if (!dlg) return;
  const out = dlg.querySelector('.term-out');
  const form = dlg.querySelector('.term-form');
  const input = dlg.querySelector('.term-input');
  const Portfolio = (window.Portfolio = window.Portfolio || {});

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const href = (key) => { const a = $(`[data-contact="${key}"]`); return a ? a.href : ''; };

  const SECTIONS = { top: 'top', work: 'work', projects: 'projects', stack: 'stack', credentials: 'credentials', contact: 'contact' };
  const LINKS = {
    docspace: () => { const a = $('#p-docspace .text-link'); return a && a.href; },
    image: () => { const a = $('#p-image .text-link'); return a && a.href; },
    github: () => href('github'),
    linkedin: () => href('linkedin'),
    resume: () => href('resume'),
  };

  /* ── Output helpers ── */
  function print(content, cls) {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.append(...[].concat(content));
    out.appendChild(p);
    out.scrollTop = out.scrollHeight;
    return p;
  }
  function link(label, url) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = url;
    if (/^https?:/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  /* ── Commands ── */
  const commands = {
    help: {
      about: 'show this list',
      run() {
        const width = Math.max(...Object.values(commands).filter((c) => c.about).map((c) => (c.usage || c.name).length));
        for (const c of Object.values(commands)) {
          if (c.about) print(`  ${(c.usage || c.name).padEnd(width + 2)}${c.about}`);
        }
        print('Tab completes, ↑ ↓ recall history, esc closes.', 'sys');
      },
    },
    whoami: {
      about: 'the short version',
      run() {
        print(text($('.hero h1')), 'head');
        print(text($('.lede')));
        print(text($('.hud-line')).replace(/\s*\/\s*\d\d:\d\d:\d\d IST$/, ''), 'sys');
      },
    },
    work: {
      about: 'experience, stage by stage',
      run() {
        print(text($('.pipe-label')), 'head');
        $$('.pipe-panel').forEach((panel) => {
          print(`[${text($('.pipe-num', panel))}] ${text($('h3', panel))}`, 'ok');
          print('     ' + text($('p', panel)));
        });
        $$('.xp-card').forEach((card) => {
          print(`${text($('h3', card))} (${text($('.xp-when', card))})`, 'head');
          print('     ' + text($('p:not(.xp-when)', card)));
        });
      },
    },
    projects: {
      about: 'things I built',
      run() {
        // Featured projects first, then the plain repository cards under "More on GitHub".
        $$('.project, .repo').forEach((project) => {
          print(`${text($('h3, h4', project))} · ${text($('.project-kicker', project))}`, 'head');
          print('  ' + text($('.project-desc', project)));
          print('  stack: ' + $$('.chips li', project).map(text).join(', '), 'sys');
          $$('.text-link', project).forEach((a) => {
            // "Live demo ↗" → "demo", "Source ↗" → "source"
            const label = text(a).replace(/[^a-z ]/gi, '').trim().split(' ').pop().toLowerCase();
            print([`  ${label.padEnd(8)}`, link(a.href, a.href)]);
          });
        });
      },
    },
    skills: {
      about: 'the stack, by category',
      run() {
        $$('.stack-group').forEach((group) => {
          print([Object.assign(document.createElement('span'), { className: 'ok', textContent: text($('h3', group)).padEnd(14) }), $$('.skill', group).map(text).join(', ')]);
        });
      },
    },
    certs: {
      about: 'certifications',
      run() {
        $$('.cert').forEach((cert) => print(`  ${text($('.cert-code', cert)).padEnd(9)}${text($('.cert-name', cert))}`));
      },
    },
    education: {
      about: 'where I studied',
      run() {
        const edu = $('.edu');
        print(text($('h3', edu)), 'head');
        print('  ' + text($('.edu-copy p:last-child', edu)));
        print(`  ${text($('.cred-kicker', edu))} · CGPA ${text($('.edu-ring strong', edu))} / 10`, 'sys');
      },
    },
    contact: {
      about: 'how to reach me',
      run() {
        const mail = $('[data-contact="email"]');
        print(['  email     ', link(text(mail), mail.href)]);
        print(['  github    ', link(href('github'), href('github'))]);
        print(['  linkedin  ', link(href('linkedin'), href('linkedin'))]);
      },
    },
    resume: {
      about: 'open the résumé (PDF)',
      run() {
        window.open(href('resume'), '_blank', 'noopener');
        print('Opening the résumé in a new tab.', 'ok');
      },
    },
    open: {
      usage: 'open <name>',
      about: Object.keys(LINKS).join(' | '),
      args: Object.keys(LINKS),
      run([name]) {
        const url = LINKS[name] && LINKS[name]();
        if (!url) return print(`open: pick one of ${Object.keys(LINKS).join(', ')}`, 'err');
        window.open(url, '_blank', 'noopener');
        print(['Opening ', link(url, url)], 'ok');
      },
    },
    goto: {
      usage: 'goto <section>',
      about: Object.keys(SECTIONS).join(' | '),
      args: Object.keys(SECTIONS),
      run([name]) {
        const id = SECTIONS[name];
        if (!id) return print(`goto: pick one of ${Object.keys(SECTIONS).join(', ')}`, 'err');
        close();
        document.getElementById(id).scrollIntoView();
      },
    },
    task: {
      usage: 'task <lat> <lon>',
      about: 'drop a capture on the globe, e.g. task 17.4 78.5',
      run([a, b]) {
        const lat = Number(a), lon = Number(b);
        if (a === undefined || b === undefined || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return print('task: needs a latitude (-90 to 90) and a longitude (-180 to 180)', 'err');
        }
        if (!Portfolio.task) return print('task: the globe is not available', 'err');
        print(`Queued ${Portfolio.task(lat, lon)}. Close the terminal and scroll up to watch it.`, 'ok');
      },
    },
    theme: {
      usage: 'theme [dark|light]',
      about: 'switch the colour theme',
      args: ['dark', 'light'],
      run([name]) {
        const next = name === 'dark' || name === 'light' ? name : Portfolio.getTheme() === 'light' ? 'dark' : 'light';
        Portfolio.setTheme(next);
        print(`Theme set to ${next}.`, 'ok');
      },
    },
    clear: { about: 'clear the screen', run() { out.replaceChildren(); } },
    sudo: {
      run(args) {
        if (args[0] !== 'hire') return print('visitor is not in the sudoers file. Try: sudo hire midhilesh', 'err');
        const mail = $('[data-contact="email"]');
        print('Permission granted.', 'ok');
        print(['Next step: ', link(text(mail), mail.href)]);
      },
    },
    ls: { run() { print(Object.keys(SECTIONS).join('  ')); } },
    exit: { run() { close(); } },
  };
  for (const [name, command] of Object.entries(commands)) command.name = name;
  const ALIASES = { '?': 'help', about: 'whoami', experience: 'work', stack: 'skills', certifications: 'certs', edu: 'education', cd: 'goto', quit: 'exit', cls: 'clear' };

  const history = [];
  let historyAt = 0;

  function run(line) {
    line = line.trim();
    if (!line) return;
    history.push(line);
    historyAt = history.length;
    print(line, 'cmd');
    const [word, ...args] = line.toLowerCase().split(/\s+/);
    const command = commands[ALIASES[word] || word];
    if (!command) {
      const guess = Object.keys(commands).find((name) => name.startsWith(word[0]) && commands[name].about);
      return print(`command not found: ${word}.${guess ? ` Did you mean "${guess}"?` : ''} Type "help" for the list.`, 'err');
    }
    command.run(args);
    out.scrollTop = out.scrollHeight;
  }

  function complete() {
    const value = input.value.toLowerCase();
    const parts = value.split(/\s+/);
    if (parts.length === 1) {
      const hits = Object.keys(commands).filter((name) => name.startsWith(parts[0]));
      if (hits.length === 1) input.value = hits[0] + (commands[hits[0]].args ? ' ' : '');
      else if (hits.length > 1) print(hits.join('  '), 'sys');
    } else if (parts.length === 2) {
      const command = commands[ALIASES[parts[0]] || parts[0]];
      const hits = ((command && command.args) || []).filter((arg) => arg.startsWith(parts[1]));
      if (hits.length === 1) input.value = `${parts[0]} ${hits[0]}`;
      else if (hits.length > 1) print(hits.join('  '), 'sys');
    }
  }

  /* ── Open / close ── */
  let lastFocus = null;
  let greeted = false;
  function open() {
    if (!dlg.hidden) return;
    lastFocus = document.activeElement;
    dlg.hidden = false;
    document.body.classList.add('term-open');
    if (!greeted) {
      greeted = true;
      print('Welcome. This terminal knows everything on the page.', 'sys');
      print('Type "help", or try "work", "projects" or "task 17.4 78.5".', 'sys');
    }
    input.focus();
  }
  function close() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    document.body.classList.remove('term-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  Portfolio.openTerminal = open;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = input.value;
    input.value = '';
    run(line);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && input.value.trim()) { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowUp' && historyAt > 0) { e.preventDefault(); input.value = history[--historyAt]; }
    else if (e.key === 'ArrowDown' && historyAt < history.length) { e.preventDefault(); input.value = history[++historyAt] || ''; }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); commands.clear.run(); }
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    const quick = e.target.closest('[data-cmd]');
    if (!quick) return;
    run(quick.dataset.cmd);
    if (!matchMedia('(pointer: coarse)').matches) input.focus(); // don't pop the keyboard on phones
  });
  document.getElementById('open-term').addEventListener('click', open);

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    const typing = el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.hidden ? open() : close(); }
    else if (e.key === 'Escape' && !dlg.hidden) { e.preventDefault(); close(); }
    else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && dlg.hidden) { e.preventDefault(); open(); }
  });
  // Keep keyboard focus inside the dialog while it is open.
  document.addEventListener('focusin', (e) => {
    if (!dlg.hidden && !dlg.contains(e.target)) input.focus();
  });
})();
