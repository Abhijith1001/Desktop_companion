// Desktop Buddy admin panel. Plain DOM, no build step. Everything users send
// (feedback, crash text, emails) is inserted with textContent, never as HTML.
(() => {
  const KEY = 'buddy-admin-token';
  let token = sessionStorage.getItem(KEY) || '';
  let tab = 'overview';
  const main = document.getElementById('main');

  // ---------- helpers
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const when = (d) => (d ? new Date(d).toLocaleString() : '—');
  const ago = (d) => {
    if (!d) return '—';
    const s = (Date.now() - Date.parse(d)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  function toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function call(method, path, body) {
    const res = await fetch(`/api/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { signOut('Your token was not accepted.'); throw new Error('unauthorized'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { if (e.message !== 'unauthorized') toast(e.message); } };

  // ---------- auth
  function signOut(message = '') {
    token = '';
    sessionStorage.removeItem(KEY);
    document.getElementById('app').hidden = true;
    document.getElementById('login').hidden = false;
    document.getElementById('login-error').textContent = message;
  }
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    token = document.getElementById('token').value.trim();
    try {
      await call('GET', '/stats');
      sessionStorage.setItem(KEY, token);
      document.getElementById('login').hidden = true;
      document.getElementById('app').hidden = false;
      show('overview');
    } catch (err) {
      if (err.message !== 'unauthorized') document.getElementById('login-error').textContent = err.message;
    }
  });
  document.getElementById('logout').addEventListener('click', () => signOut());

  // ---------- tabs
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => show(b.dataset.tab));
  function show(name) {
    tab = name;
    for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === name);
    guard(VIEWS[name])();
  }
  const render = (...nodes) => main.replaceChildren(...nodes);
  async function refreshBadges() {
    const s = await call('GET', '/stats');
    document.getElementById('badge-feedback').textContent = s.feedbackNew || '';
    document.getElementById('badge-crashes').textContent = s.crashesOpen || '';
    return s;
  }

  // ---------- views
  const VIEWS = {
    async overview() {
      const s = await refreshBadges();
      const stat = (n, l) => h('div', { class: 'panel stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
      render(
        h('h2', {}, 'Overview'),
        h('div', { class: 'stats' },
          stat(s.users, 'Sync accounts'), stat(s.newUsers, 'New this week'), stat(s.activeUsers, 'Active this week'),
          stat(s.tasks, 'Synced tasks'), stat(s.feedbackNew, 'New feedback'), stat(s.crashesOpen, 'Open crash groups'),
          stat(s.crashEvents, 'Crashes this week')),
        h('div', { class: 'panel' }, h('h2', {}, 'Characters chosen'),
          s.characters.length
            ? h('table', {}, h('tbody', {}, s.characters.map((c) => h('tr', {}, h('td', {}, c.id), h('td', {}, c.n)))))
            : h('p', { class: 'muted' }, 'No accounts yet.')),
        h('p', { class: 'meta' }, 'Counts cover people who created a sync account. Local-only users are not tracked.'),
      );
    },

    async feedback(status = 'new') {
      const { feedback, total } = await call('GET', `/feedback?status=${status}&limit=100`);
      const filter = h('select', { onchange: (e) => guard(VIEWS.feedback)(e.target.value) },
        ['new', 'read', 'done', 'all'].map((s) => h('option', { value: s, selected: s === status }, s)));
      const setStatus = (id, s) => guard(async () => { await call('PATCH', `/feedback/${id}`, { status: s }); await refreshBadges(); VIEWS.feedback(status); })();
      const remove = (id) => guard(async () => { if (!confirm('Delete this feedback?')) return; await call('DELETE', `/feedback/${id}`); await refreshBadges(); VIEWS.feedback(status); })();
      render(
        h('h2', {}, 'Feedback'),
        h('div', { class: 'toolbar' }, 'Show', filter, h('span', { class: 'meta' }, `${total} item${total === 1 ? '' : 's'}`)),
        feedback.length ? h('div', { class: 'list' }, feedback.map((f) => h('div', { class: 'panel item' },
          h('div', { class: 'row' },
            h('span', { class: `chip ${f.kind}` }, f.kind), f.status === 'new' && h('span', { class: 'chip new' }, 'new'),
            h('span', { class: 'meta' }, `${ago(f.createdAt)} · v${f.appVersion || '?'} · ${f.os || ''}`),
            h('span', { class: 'spacer' }),
            f.status !== 'read' && h('button', { class: 'small', onclick: () => setStatus(f.id, 'read') }, 'Mark read'),
            f.status !== 'done' && h('button', { class: 'small', onclick: () => setStatus(f.id, 'done') }, '✓ Done'),
            h('button', { class: 'small danger', onclick: () => remove(f.id) }, 'Delete')),
          h('div', { class: 'msg' }, f.message),
          f.email && h('div', { class: 'meta' }, 'Reply to: ', h('a', { href: `mailto:${encodeURIComponent(f.email).replace('%40', '@')}` }, f.email)),
        ))) : h('div', { class: 'empty' }, 'Nothing here. 🎉'),
      );
    },

    async crashes(resolved = 'false') {
      const { crashes, total } = await call('GET', `/crashes?resolved=${resolved}&limit=100`);
      const filter = h('select', { onchange: (e) => guard(VIEWS.crashes)(e.target.value) },
        [['false', 'Open'], ['true', 'Resolved'], ['all', 'All']].map(([v, l]) => h('option', { value: v, selected: v === resolved }, l)));
      const mark = (id, r) => guard(async () => { await call('PATCH', `/crashes/${id}`, { resolved: r }); await refreshBadges(); VIEWS.crashes(resolved); })();
      const remove = (id) => guard(async () => { await call('DELETE', `/crashes/${id}`); await refreshBadges(); VIEWS.crashes(resolved); })();
      render(
        h('h2', {}, 'Crash reports'),
        h('div', { class: 'toolbar' }, 'Show', filter, h('span', { class: 'meta' }, `${total} group${total === 1 ? '' : 's'} · identical errors are grouped`)),
        crashes.length ? h('div', { class: 'list' }, crashes.map((c) => h('div', { class: 'panel item' },
          h('div', { class: 'row' },
            h('span', { class: 'chip' }, c.source), h('strong', {}, `×${c.count}`),
            h('span', { class: 'meta' }, `last ${ago(c.lastAt)} · first ${when(c.firstAt)} · v${c.appVersion || '?'} · ${c.os || ''}`),
            h('span', { class: 'spacer' }),
            h('button', { class: 'small', onclick: () => mark(c.id, !c.resolved) }, c.resolved ? 'Reopen' : '✓ Resolved'),
            h('button', { class: 'small danger', onclick: () => remove(c.id) }, 'Delete')),
          h('div', { class: 'msg' }, h('strong', {}, c.message || '(no message)')),
          c.stack && h('pre', {}, c.stack),
        ))) : h('div', { class: 'empty' }, 'No crashes. 🎉'),
      );
    },

    async users(q = '') {
      const { users, total } = await call('GET', `/users?limit=200&q=${encodeURIComponent(q)}`);
      const search = h('input', { type: 'search', placeholder: 'Search email…', value: q });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') guard(VIEWS.users)(search.value); });
      const remove = (u) => guard(async () => {
        if (!confirm(`Delete ${u.email} and all ${u.tasks} synced tasks? Their local data on their PC is not affected. This cannot be undone.`)) return;
        await call('DELETE', `/users/${u.id}`);
        toast('Account deleted');
        VIEWS.users(q);
      })();
      render(
        h('h2', {}, 'Users'),
        h('div', { class: 'toolbar' }, search, h('button', { onclick: () => guard(VIEWS.users)(search.value) }, 'Search'), h('span', { class: 'meta' }, `${total} account${total === 1 ? '' : 's'}`)),
        users.length ? h('div', { class: 'panel' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Email', 'Character', 'Tasks', 'Last sync', 'Joined', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, users.map((u) => h('tr', {},
            h('td', {}, u.email), h('td', {}, u.character || '—'), h('td', {}, u.tasks), h('td', {}, ago(u.lastSyncAt)), h('td', {}, when(u.createdAt)),
            h('td', {}, h('button', { class: 'small danger', onclick: () => remove(u) }, 'Delete'))))))) : h('div', { class: 'empty' }, 'No accounts found.'),
      );
    },

    async announcements(editing = null) {
      const { announcements } = await call('GET', '/announcements');
      const local = (d) => (d ? new Date(Date.parse(d) - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
      const e = editing || {};
      const f = {
        title: h('input', { required: true, maxlength: 120, value: e.title || '', placeholder: 'New character: Panda! 🐼' }),
        body: h('textarea', { maxlength: 1000, placeholder: 'A short message shown in the app' }),
        link: h('input', { type: 'url', value: e.link || '', placeholder: 'https://… (optional)' }),
        startsAt: h('input', { type: 'datetime-local', value: local(e.startsAt) }),
        endsAt: h('input', { type: 'datetime-local', value: local(e.endsAt) }),
        active: h('input', { type: 'checkbox', checked: e.active !== false }),
      };
      f.body.value = e.body || '';
      const save = guard(async (ev) => {
        ev.preventDefault();
        const body = {
          title: f.title.value, body: f.body.value, link: f.link.value, active: f.active.checked,
          startsAt: f.startsAt.value ? new Date(f.startsAt.value).toISOString() : null,
          endsAt: f.endsAt.value ? new Date(f.endsAt.value).toISOString() : null,
        };
        if (editing) await call('PUT', `/announcements/${editing.id}`, body); else await call('POST', '/announcements', body);
        toast(editing ? 'Announcement updated' : 'Announcement published');
        VIEWS.announcements();
      });
      const toggle = (a) => guard(async () => { await call('PUT', `/announcements/${a.id}`, { ...a, active: !a.active }); VIEWS.announcements(); })();
      const remove = (a) => guard(async () => { if (!confirm('Delete this announcement?')) return; await call('DELETE', `/announcements/${a.id}`); VIEWS.announcements(); })();
      render(
        h('h2', {}, 'Announcements'),
        h('p', { class: 'muted' }, 'Shown as a banner in everyone\'s app (checked every few hours). Users can dismiss each one.'),
        h('form', { class: 'panel form', onsubmit: save },
          h('h2', {}, editing ? 'Edit announcement' : 'New announcement'),
          h('label', {}, 'Title', f.title), h('label', {}, 'Message', f.body), h('label', {}, 'Link', f.link),
          h('div', { class: 'two' }, h('label', {}, 'Show from (optional)', f.startsAt), h('label', {}, 'Show until (optional)', f.endsAt)),
          h('label', { class: 'check' }, f.active, 'Active'),
          h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, editing ? 'Save' : 'Publish'),
            editing && h('button', { type: 'button', onclick: () => VIEWS.announcements() }, 'Cancel'))),
        h('div', { class: 'list', style: 'margin-top:14px' }, announcements.map((a) => h('div', { class: 'panel item' },
          h('div', { class: 'row' },
            h('strong', {}, a.title), h('span', { class: `chip ${a.active ? 'new' : ''}` }, a.active ? 'active' : 'off'),
            h('span', { class: 'meta' }, `${when(a.startsAt)} → ${when(a.endsAt)}`), h('span', { class: 'spacer' }),
            h('button', { class: 'small', onclick: () => guard(VIEWS.announcements)(a) }, 'Edit'),
            h('button', { class: 'small', onclick: () => toggle(a) }, a.active ? 'Turn off' : 'Turn on'),
            h('button', { class: 'small danger', onclick: () => remove(a) }, 'Delete')),
          a.body && h('div', { class: 'msg' }, a.body),
          a.link && h('div', { class: 'meta' }, a.link)))),
      );
    },
  };

  // ---------- start
  if (token) {
    call('GET', '/stats').then(() => {
      document.getElementById('app').hidden = false;
      show(tab);
    }).catch(() => {});
  } else {
    document.getElementById('login').hidden = false;
  }
})();
