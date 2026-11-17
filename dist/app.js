import {
  escapeHTML as h, safeURL, parseRepository, ageDays, analyzePR, extractExpectations, detectGaps, handoffMarkdown,
  reviewTier, applyRules, dependencyChanges, aiLines, authorGroup, governanceProfile, profileMarkdown,
  GAP_TOPICS, PATTERNS, findPolicyLine, provenanceFields, template, isSensitive, isDependency, isTest, isCI
} from './core.js';
import { GitHub } from './github.js';
import { demoData, demoDetail, demoFiles, demoGovernance, demoSample } from './demo.js';
import { icon } from './icons.js';

// ---------------------------------------------------------------------------
// State & persistence
const STORE = { notes: 'ossrs.notes.v1', gaps: 'ossrs.gaps.v1', prefs: 'ossrs.prefs.v1', recent: 'ossrs.recent.v1', dismiss: 'ossrs.dismissed.v1' };
// Carry over data saved under the tool's earlier storage keys.
try { for (const [k, v] of Object.entries(STORE)) { const old = v.replace('ossrs.', 'reviewbridge.'); if (localStorage.getItem(v) === null && localStorage.getItem(old) !== null) localStorage.setItem(v, localStorage.getItem(old)); } } catch { /* storage unavailable */ }
const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const state = {
  data: null, demo: true, page: 'queue', selected: null, tab: 'brief',
  filter: 'all', search: '', sort: 'oldest',
  details: new Map(), triage: new Map(), triageBusy: false, gov: null, govBusy: false,
  busy: false, error: '', rate: null, token: '', sample: null, loadingDetail: false, detailError: '', sequence: 0,
  notes: load(STORE.notes, {}), gapStates: load(STORE.gaps, {}), prefs: { theme: 'system', text: 'md', ...load(STORE.prefs, {}) },
  recent: load(STORE.recent, []), dismissed: load(STORE.dismiss, {}),
  navOpen: false, doc: 0, expFilter: 'all',
  toolkit: { kind: 'ai-policy', stance: 'disclose', verify: true, licensing: true, deps: true, model: 'council' }
};
let controller = new AbortController();
const onRate = rate => { state.rate = rate; const el = document.getElementById('rate'); if (el) el.textContent = rate.remaining + ' GitHub API requests remaining'; };
let api = new GitHub('', onRate);
const app = document.getElementById('app');

function useDemo() {
  state.demo = true; state.data = demoData(); state.details.clear(); state.triage.clear();
  for (const p of state.data.pulls) state.triage.set(p.number, demoFiles(p.number));
  state.gov = demoGovernance(); state.sample = null;
}
useDemo();

function persist() {
  try {
    localStorage.setItem(STORE.notes, JSON.stringify(state.notes));
    localStorage.setItem(STORE.gaps, JSON.stringify(state.gapStates));
    return true;
  } catch { notify('Browser storage is unavailable or full. Export your notes to keep them.'); return false; }
}
function savePref(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* optional */ } }
function applyPrefs() {
  const root = document.documentElement;
  if (state.prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = state.prefs.theme;
  if (state.prefs.text === 'md') delete root.dataset.text; else root.dataset.text = state.prefs.text;
  savePref(STORE.prefs, state.prefs);
}

// ---------------------------------------------------------------------------
// Small helpers
const link = (url, label, cls = '') => `<a class="${cls}" href="${h(safeURL(url))}" target="_blank" rel="noopener noreferrer">${h(label)} ${icon('external')}<span class="sr-only">(opens in a new tab)</span></a>`;
const chip = (text, kind = '', ic = '', title = '') => `<span class="chip ${kind}"${title ? ` title="${h(title)}"` : ''}>${ic ? icon(ic) : ''}${h(text)}</span>`;
const current = () => state.data.pulls.find(p => p.number === state.selected);
const key = (number = state.selected) => `${state.demo ? 'demo:' : ''}${state.data.repo.full_name}#${number}`;
const noteFor = (number = state.selected) => state.notes[key(number)] || { text: '', checks: {}, provenance: {} };
const formatDate = v => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: ageDays(v) > 300 ? 'numeric' : undefined });
const plural = (n, w, pl = w + 's') => `${n} ${n === 1 ? w : pl}`;
function notify(message) {
  const el = document.getElementById('toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove('visible'), 4000);
}
function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); }
  catch { notify('Copy failed — use Download instead.'); }
}
function empty(title, description, ic = 'search', action = '') {
  return `<div class="empty"><div class="badge-icon">${icon(ic)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
function pageHead(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>`;
}
const tierFor = p => {
  const d = state.details.get(p.number);
  return reviewTier(d?.files || state.triage.get(p.number), d?.checks || []);
};
const confirmedGaps = () => GAP_TOPICS.filter(t => state.gapStates[key('gap:' + t.id)] === 'Confirmed');

// ---------------------------------------------------------------------------
// Shell
const NAV = [
  ['Review', [['queue', 'inbox', 'Review queue'], ['handoffs', 'clipboard', 'My handoffs']]],
  ['Governance', [['profile', 'compass', 'Governance profile'], ['guidance', 'book', 'Project guidance'], ['gaps', 'gap', 'Expectation gaps'], ['toolkit', 'wrench', 'Governance toolkit']]]
];
function render() {
  const d = state.data;
  const handoffCount = Object.keys(state.notes).filter(k => k.startsWith(key(''))).length;
  const counts = { queue: d.pulls.length, handoffs: handoffCount || '', guidance: d.docs.length };
  const [owner, name] = d.repo.full_name.split('/');
  app.innerHTML = `<div class="layout ${state.navOpen ? 'nav-open' : ''}">
  <aside class="sidebar" aria-label="Sidebar">
    <a class="brand" href="?" data-action="home"><img src="/icon.svg" width="36" height="36" alt=""><span>OSS Review Steward<small>Review with context</small></span></a>
    <button class="repo-switch" data-action="connect" aria-label="Switch repository (current: ${h(d.repo.full_name)})"><span class="repo-icon">${icon('folder')}</span><span><strong>${h(name)}</strong><small>${h(owner)}${state.demo ? ' · demo' : ''}</small></span>${icon('chevron')}</button>
    <nav aria-label="Main">${NAV.map(([group, items]) => `<p class="nav-group-label">${group}</p><ul>${items.map(([id, ic, label]) => `<li><button class="nav-item ${!state.selected && state.page === id ? 'active' : ''}" data-page="${id}" ${!state.selected && state.page === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${counts[id] !== undefined && counts[id] !== '' ? `<span class="nav-count">${counts[id]}</span>` : ''}</button></li>`).join('')}</ul>`).join('')}</nav>
    <div class="sidebar-foot">
      <button class="nav-item" data-action="settings">${icon('sliders')}<span>Settings</span></button>
    </div>
  </aside>
  <div class="scrim" data-action="close-nav"></div>
  <div class="shell">
    <header class="topbar">
      <div class="crumbs"><button class="btn ghost icon-only menu-button" data-action="open-nav" aria-label="Open navigation">${icon('menu')}</button><span class="hide-sm">Workspace</span><span class="hide-sm" aria-hidden="true">/</span><strong>${h(d.repo.full_name)}</strong>${state.demo ? chip('Demo', 'accent') : chip('Live', 'ok', '', 'Read-only GitHub data')}</div>
      <div class="top-actions">
        <button class="btn ghost icon-only" data-action="toggle-theme" aria-label="Switch color theme" title="Switch color theme">${icon(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'sun' : 'moon')}</button>
        <button class="btn ghost icon-only" data-action="cycle-text" aria-label="Change text size (now ${{ md: 'default', lg: 'large', xl: 'larger' }[state.prefs.text]})" title="Text size">${icon('type')}</button>
        <button class="btn ghost icon-only hide-sm" data-action="shortcuts" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">${icon('help')}</button>
        <button class="btn primary sm" data-action="connect">${icon('github')}<span class="hide-sm">${state.demo ? 'Connect repository' : 'Switch repository'}</span></button>
      </div>
    </header>
    <main id="main" tabindex="-1">${banners()}${state.selected ? detailView() : pageView()}</main>
    <footer><span>OSS Review Steward · read-only · never posts, approves, or merges</span><span id="rate">${state.rate ? state.rate.remaining + ' GitHub API requests remaining' : state.demo ? 'Fictional demo data · no GitHub connection' : 'Read-only GitHub connection'}</span></footer>
  </div>
</div>`;
  const hash = state.selected ? `pr-${state.selected}${state.tab !== 'brief' ? '/' + state.tab : ''}` : state.page;
  if (location.hash.slice(1) !== hash) history[location.hash ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + '#' + hash);
}
const PAGES = ['queue', 'handoffs', 'profile', 'guidance', 'gaps', 'toolkit'];
function route() {
  const m = location.hash.slice(1).match(/^pr-(\d+)(?:\/(\w+))?$/);
  if (m && state.data.pulls.some(p => p.number === Number(m[1]))) {
    const tab = TABS.some(t => t[0] === m[2]) ? m[2] : 'brief';
    if (state.selected === Number(m[1])) { state.tab = tab; render(); } else selectPR(Number(m[1])).then(() => { if (state.tab !== tab) { state.tab = tab; render(); } });
    return;
  }
  state.selected = null;
  state.page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'queue';
  render();
}
addEventListener('popstate', route);
function banners() {
  let out = '';
  if (state.demo && !state.dismissed.demo) out += `<div class="banner demo">${icon('sparkles')}<div><strong>You’re exploring a fictional demo.</strong> Every feature works here with sample data. Connect a public GitHub repository to use your own.</div><button class="btn sm" data-action="connect">Use my repository</button><button class="close" data-action="dismiss-demo" aria-label="Dismiss">${icon('x')}</button></div>`;
  if (state.error) out += `<div class="banner error" role="alert">${icon('alert')}<div>${h(state.error)}</div><button class="close" data-action="dismiss-error" aria-label="Dismiss error">${icon('x')}</button></div>`;
  if (state.busy) out += `<div class="loading" role="status"><span class="spinner"></span>Reading GitHub evidence…</div>`;
  return out;
}
function pageView() {
  return ({ queue: queueView, handoffs: handoffsView, profile: profileView, guidance: guidanceView, gaps: gapsView, toolkit: toolkitView }[state.page] || queueView)();
}

// ---------------------------------------------------------------------------
// Queue
const FILTERS = [['all', 'All'], ['ready', 'Ready'], ['waiting', 'Waiting 7+ days'], ['focus', 'Focused review'], ['first', 'First-time contributors'], ['draft', 'Drafts']];
function visiblePRs() {
  const q = state.search.toLowerCase().trim();
  const prs = state.data.pulls.filter(p => {
    const f = state.filter;
    const pass = f === 'all' || (f === 'ready' && !p.draft) || (f === 'waiting' && !p.draft && ageDays(p.created_at) >= 7) || (f === 'draft' && p.draft)
      || (f === 'focus' && tierFor(p)?.tier === 'focus') || (f === 'first' && authorGroup(p.author_association) === 'first-time');
    return pass && (!q || `${p.title} #${p.number} ${p.user.login} ${p.labels.map(l => l.name).join(' ')}`.toLowerCase().includes(q));
  });
  const t = p => new Date(p.created_at).getTime();
  const by = {
    oldest: (a, b) => t(a) - t(b), newest: (a, b) => t(b) - t(a),
    updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
    focus: (a, b) => (tierFor(a)?.rank ?? 1.5) - (tierFor(b)?.rank ?? 1.5) || (tierFor(b)?.reasons.length || 0) - (tierFor(a)?.reasons.length || 0) || t(a) - t(b)
  };
  return prs.sort(by[state.sort]);
}
function queueView() {
  const pulls = state.data.pulls, ready = pulls.filter(p => !p.draft), waiting = ready.filter(p => ageDays(p.created_at) >= 7);
  const tiers = pulls.map(tierFor), loaded = tiers.filter(Boolean).length, focus = tiers.filter(t => t?.tier === 'focus').length;
  const untriaged = pulls.filter(p => !tierFor(p)).length;
  return pageHead('Review', 'Review queue', `Open pull requests for <strong>${h(state.data.repo.full_name)}</strong>. Open one to see its evidence, the project’s rules, and a place to leave a handoff.`,
    `<button class="btn" data-action="refresh" ${state.busy ? 'disabled' : ''}>${icon('refresh')}Refresh</button>`)
  + `<div class="stats">
      ${stat('Open pull requests', pulls.length, state.data.queueTruncated ? 'Newest 300 loaded' : 'In the loaded queue', 'pr')}
      ${stat('Ready for review', ready.length, 'Not marked as draft', 'checkCircle')}
      ${stat('Waiting 7+ days', waiting.length, waiting.length ? 'A prompt to check in' : 'Nothing waiting long', 'clock', waiting.length ? 'warn' : '')}
      ${stat('Need focused review', loaded ? focus : '—', loaded ? `Of ${loaded} with file data` : 'Load review focus below', 'zap', focus ? 'warn' : '')}
    </div>
    <section class="card" aria-labelledby="queue-title">
      <div class="card-head"><div><h2 id="queue-title">Pull requests <span class="count">${pulls.length}</span></h2><p>Synced ${new Date(state.data.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div></div>
      ${untriaged && !state.demo ? `<div class="triage-callout"><div>${icon('zap')}<span><strong>Prioritize by what changed, not who changed it.</strong> Load changed-file lists to flag sensitive paths, new dependencies, CI edits, and broad changes. Uses about ${Math.min(20, untriaged)} API requests.</span></div><button class="btn sm" data-action="triage" ${state.triageBusy ? 'disabled' : ''}>${state.triageBusy ? '<span class="spinner"></span>Loading…' : 'Load review focus'}</button></div>` : ''}
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Filter pull requests">${FILTERS.map(([id, label]) => `<button data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`).join('')}</div>
        <div class="controls">
          <label class="search">${icon('search')}<span class="sr-only">Search pull requests</span><input id="search" type="search" placeholder="Search title, author, label…" value="${h(state.search)}" autocomplete="off"><kbd aria-hidden="true">/</kbd></label>
          <label class="sr-only" for="sort">Sort</label>
          <select id="sort">${[['oldest', 'Oldest first'], ['newest', 'Newest first'], ['updated', 'Recently updated'], ['focus', 'Review focus first']].map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
      </div>
      <div id="queue-list">${queueList()}</div>
    </section>
    <div class="cards-2">
      <div class="card feature-card"><div class="badge-icon">${icon('compass')}</div><div><h3>Where do written rules and practice part ways?</h3><p>The governance profile compares what this project documents with what its activity shows, across capacity, authority, and compliance.</p><button class="link-btn" data-page="profile">Open governance profile ${icon('right')}</button></div></div>
      <div class="card feature-card"><div class="badge-icon">${icon('gap')}</div><div><h3>What do reviewers keep asking for?</h3><p>Find recurring reviewer requests that aren’t in the contributing guide yet, then turn confirmed ones into guidance.</p><button class="link-btn" data-page="gaps">Find expectation gaps ${icon('right')}</button></div></div>
    </div>`;
}
function stat(label, value, sub, ic, cls = '') {
  return `<div class="card stat ${cls}"><div class="stat-top"><span>${label}</span>${icon(ic)}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
}
function queueList() {
  const prs = visiblePRs();
  const note = state.sort === 'focus' ? `<div class="ordered-note">${icon('info')}Ordered by properties of the change — sensitive paths, new dependencies, CI edits, failing checks, size. Never by who wrote it.</div>` : '';
  const filterNote = state.filter === 'first' ? `<div class="ordered-note">${icon('users')}First contributions often decide whether someone stays. A timely, kind first response matters more than speed of merge.</div>` : '';
  return note + filterNote + (prs.length ? `<ul class="pr-list">${prs.map(prRow).join('')}</ul>` : empty('Nothing in this view', state.data.pulls.length ? (state.filter === 'focus' && !state.data.pulls.some(tierFor) ? 'Load review focus first, then filter.' : 'Try a different filter or search.') : 'This repository has no open pull requests. Its governance profile and guidance are still available.'))
    + `<div class="card-foot"><span>Showing ${prs.length} of ${state.data.pulls.length}</span><span>Use <kbd>j</kbd> <kbd>k</kbd> to move, <kbd>Enter</kbd> to open</span></div>`;
}
function prRow(p) {
  const t = tierFor(p), age = ageDays(p.created_at), first = authorGroup(p.author_association) === 'first-time', note = state.notes[key(p.number)];
  const tierChip = !t ? '' : t.tier === 'focus' ? chip('Focused review', 'warn', 'zap', t.reasons.join(', ')) : t.tier === 'light' ? chip('Docs only', 'ok', 'book') : chip('Standard', '');
  return `<li><button class="pr-row" data-pr="${p.number}">
    ${icon('pr', 'pr-icon' + (p.draft ? ' draft' : ''))}
    <span><span class="pr-title">${h(p.title)}</span>
      <span class="pr-meta"><span>#${p.number}</span><span class="sep">·</span><span>${h(p.user.login)}</span>${first ? chip('First-time contributor', 'info') : ''}${p.draft ? chip('Draft') : ''}${note ? chip('Your notes', 'accent', 'clipboard') : ''}${p.labels.slice(0, 3).map(l => chip(l.name, 'label')).join('')}</span>
      ${t?.tier === 'focus' ? `<span class="pr-meta tier-reasons">${icon('zap')}${h(t.reasons.join(' · '))}</span>` : ''}
    </span>
    <span class="pr-side">${tierChip}<span class="age ${age >= 7 && !p.draft ? 'old' : ''}" title="Opened ${h(new Date(p.created_at).toLocaleString())}">${icon('clock')}${age}d</span></span>
  </button></li>`;
}

// ---------------------------------------------------------------------------
// PR detail
const TABS = [['brief', 'Review brief', 'layers'], ['files', 'Changed files', 'file'], ['history', 'Review history', 'message'], ['handoff', 'Handoff & provenance', 'clipboard']];
function detailView() {
  const p = current(); if (!p) return '';
  const d = state.details.get(p.number), t = d ? reviewTier(d.files, d.checks) : tierFor(p);
  const counts = { files: d?.files.length, history: d ? d.reviews.length + d.comments.length + d.discussion.length : undefined };
  const checks = d?.checks || [], failed = checks.filter(c => ['failure', 'error', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion || c.state)).length;
  const lastReview = d?.reviews.filter(r => ['APPROVED', 'CHANGES_REQUESTED'].includes(r.state)).at(-1);
  return `<button class="btn ghost back" data-action="back">${icon('left')}Back to ${state.page === 'handoffs' ? 'handoffs' : 'queue'}</button>
  <div class="detail-head"><div>
    <div class="eyebrow">Pull request #${p.number}</div>
    <h1>${h(p.title)}</h1>
    <div class="detail-meta">${p.draft ? chip('Draft') : chip('Open', 'ok')}<span><strong>${h(p.user.login)}</strong> opened ${plural(ageDays(p.created_at), 'day')} ago</span>${authorGroup(p.author_association) === 'first-time' ? chip('First-time contributor', 'info') : ''}${p.labels.map(l => chip(l.name, 'label')).join('')}</div>
  </div>${link(p.html_url, 'Open on GitHub', 'btn')}</div>
  ${d ? `<div class="card summary-strip">
    <span><b>${d.pr.changed_files}</b> files</span><span class="plus">+${d.pr.additions}</span><span class="minus">−${d.pr.deletions}</span>
    <span>${checks.length ? (failed ? chip(`${failed} of ${checks.length} checks failing`, 'danger', 'xCircle') : chip(`${checks.length} checks passing or pending`, 'ok', 'checkCircle')) : chip('No checks loaded', '', 'help')}</span>
    ${t ? (t.tier === 'focus' ? chip('Focused review: ' + t.reasons.join(', '), 'warn', 'zap') : chip(t.label, t.tier === 'light' ? 'ok' : '')) : ''}
    ${lastReview ? chip(lastReview.state === 'APPROVED' ? 'Approved by ' + lastReview.user.login : 'Changes requested by ' + lastReview.user.login, lastReview.state === 'APPROVED' ? 'ok' : 'warn') : ''}
  </div>` : ''}
  <div class="tabs" role="tablist" aria-label="Pull request views">${TABS.map(([id, label, ic]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${icon(ic)}${label}${counts[id] !== undefined ? ` <span class="count">${counts[id]}</span>` : ''}</button>`).join('')}</div>
  ${state.loadingDetail ? '<div class="loading" role="status"><span class="spinner"></span>Loading diff, reviews, and checks…</div>' : ''}
  ${state.detailError ? `<div class="banner error" role="alert">${icon('alert')}<div>${h(state.detailError)}</div><button class="btn sm" data-action="retry-detail">Retry</button></div>` : ''}
  ${d?.warnings.map(w => `<div class="banner warn">${icon('info')}<div>${h(w)}</div></div>`).join('') || ''}
  <div role="tabpanel">${state.tab === 'handoff' ? handoffView(p, d) : !d ? (state.loadingDetail ? '' : empty(state.detailError ? 'Evidence unavailable' : 'Evidence is loading', 'The contribution is always available through its GitHub link.', 'file')) : state.tab === 'files' ? filesView(p, d) : state.tab === 'history' ? historyView(p, d) : briefView(p, d)}</div>`;
}
const STATUS_ICON = { found: 'checkCircle', missing: 'xCircle', judgment: 'help', na: 'dotCircle', observed: 'dotCircle', unknown: 'help' };
const STATUS_TEXT = { found: ['Evidence found', 'ok'], missing: ['Not found in PR', 'warn'], judgment: ['Needs your judgment', 'info'], na: ['Not applicable', ''] };
function briefView(p, d) {
  const flags = analyzePR(p, d, state.data.docs), rules = applyRules(p, d.files, state.data.docs);
  const deps = dependencyChanges(d.files), ai = aiLines(p.body);
  return `<div class="split"><div class="stack">
    <section class="card card-pad"><div class="section-title"><h2>${icon('zap')}Where to focus</h2></div>
      <p class="muted small">Signals explain what to inspect. They don’t decide whether a contribution is safe or correct.</p>
      ${flags.map(f => `<article class="finding"><span class="finding-icon ${f.kind}">${icon(f.kind === 'attention' ? 'alert' : f.kind === 'question' ? 'help' : 'check')}</span><div><h3>${h(f.title)}</h3><p>${h(f.description)}</p>${f.evidence.length ? `<div class="evidence">${f.evidence.slice(0, 8).map(e => link(e.url, e.label)).join('')}${f.evidence.length > 8 ? `<span class="muted small">+${f.evidence.length - 8} more</span>` : ''}</div>` : ''}</div></article>`).join('')}
    </section>
    <section class="card card-pad"><div class="section-title"><h2>${icon('book')}Project rules applied</h2>${rules.length ? chip(`${rules.filter(r => r.status === 'found').length} of ${rules.length} with evidence`, 'accent') : ''}</div>
      <p class="muted small">Rules this project has written down, checked against this PR. A missing item is a question to ask, not a violation.</p>
      ${rules.length ? rules.map(r => `<div class="rule">${icon(STATUS_ICON[r.status], 'status-icon ' + r.status)}<div><div class="rule-head"><h3>${h(r.name)}</h3>${chip(...STATUS_TEXT[r.status])}</div><p>${h(r.explanation)}</p><q>${h(r.source.text.slice(0, 200))}</q><div class="evidence" style="margin-top:.375rem">${link(r.source.url, r.source.doc + ' · line ' + r.source.line)}</div></div></div>`).join('')
        : empty('No checkable rules found', 'The loaded guidance doesn’t mention tests, changelogs, AI disclosure, or similar expectations in a way OSS Review Steward can check.', 'book', `<button class="btn sm" data-page="toolkit">Draft guidance in the toolkit</button>`)}
    </section>
    ${deps.length ? `<section class="card card-pad"><div class="section-title"><h2>${icon('pkg')}Dependencies to verify</h2>${chip(plural(deps.filter(x => x.change === 'added').length, 'new package'), deps.some(x => x.change === 'added') ? 'warn' : '')}</div>
      <p class="muted small">AI coding tools sometimes suggest packages that don’t exist — and attackers register those names. Open each registry page and confirm it’s the package intended, published by who you expect, and maintained.</p>
      ${deps.map(x => `<div class="dep"><span><code>${h(x.name)}</code> <span class="muted small">${h(x.ecosystem)} · ${h(x.file)}</span></span><span class="btn-row">${chip(x.change === 'added' ? 'Newly added' : 'Version changed', x.change === 'added' ? 'warn' : '')}${link(x.url, 'Check registry', 'btn sm')}</span></div>`).join('')}
    </section>` : ''}
    <section class="card card-pad"><div class="section-title"><h2>${icon('message')}Contributor’s description</h2></div><pre class="description">${h(p.body || 'No description was provided.')}</pre></section>
  </div>
  <aside class="stack">
    <section class="card card-pad"><div class="section-title"><h2>Checks & statuses</h2></div>
      ${d.checks.length ? d.checks.map(c => { const s = c.conclusion || c.state || c.status; const cls = ['success', 'neutral', 'skipped'].includes(s) ? 'pass' : ['failure', 'error', 'timed_out', 'cancelled', 'action_required'].includes(s) ? 'fail' : 'pending'; return `<div class="check-row">${icon(cls === 'pass' ? 'checkCircle' : cls === 'fail' ? 'xCircle' : 'clock', cls)}<div>${link(c.html_url || c.target_url || p.html_url + '/checks', c.name || c.context)}<small>${h(s)}</small></div></div>`; }).join('') : '<p class="muted">No check results available. That’s not proof tests passed.</p>'}
    </section>
    <section class="card card-pad"><div class="section-title"><h2>${icon('sparkles')}AI-use context</h2></div>
      ${ai.length ? `<p class="muted small">The contributor’s description mentions AI tools:</p>${ai.map(t => `<blockquote>${h(t)}</blockquote>`).join('')}` : '<p class="muted small">No AI-use wording in the description. OSS Review Steward doesn’t detect AI use — absence tells you nothing either way.</p>'}
      <button class="btn full" data-tab="handoff">${icon('clipboard')}Record provenance</button>
    </section>
    <section class="card card-pad"><div class="section-title"><h2>Leave a clear next step</h2></div><p class="muted small">Write down what you checked so you — or someone else — can pick it up later.</p>${noteFor(p.number).updated ? `<p class="small">${icon('check')} Notes saved ${h(new Date(noteFor(p.number).updated).toLocaleString())}</p>` : ''}<button class="btn primary full" data-tab="handoff">Write a handoff ${icon('right')}</button></section>
  </aside></div>`;
}
function fileTags(name) {
  return [isSensitive(name) && chip('Sensitive', 'warn'), isDependency(name) && chip('Dependencies', 'warn'), isCI(name) && chip('CI', 'warn'), isTest(name) && chip('Test', 'ok')].filter(Boolean).join('');
}
function filesView(p, d) {
  return `<section class="card card-pad"><div class="section-title"><h2>Changed files</h2><span class="muted">${d.files.length} of ${d.pr.changed_files} loaded</span></div>
  <p class="muted small">Excerpts come from GitHub and may be truncated. Use the original diff for a complete review.</p>
  ${d.files.map(f => `<details class="file"><summary><span>${icon('file')}${h(f.filename)}</span><span class="tags">${fileTags(f.filename)}${chip(f.status)}<span class="plus">+${f.additions}</span><span class="minus">−${f.deletions}</span></span></summary><div class="file-body">${link(f.blob_url || p.html_url + '/files', 'View file on GitHub')}<pre class="diff">${f.patch ? f.patch.split('\n').map(l => `<span class="${l.startsWith('+') ? 'added' : l.startsWith('-') ? 'removed' : l.startsWith('@@') ? 'hunk' : ''}">${h(l) || ' '}</span>`).join('') : '<span>No text diff available (binary, deleted, or large file).</span>'}</pre></div></details>`).join('')}
  </section>`;
}
function historyView(p, d) {
  const items = [...d.reviews.map(x => ({ ...x, time: x.submitted_at, type: x.state.replace('_', ' ').toLowerCase() })), ...d.comments.map(x => ({ ...x, time: x.created_at, type: 'inline comment' })), ...d.discussion.map(x => ({ ...x, time: x.created_at, type: 'discussion' }))].sort((a, b) => new Date(a.time) - new Date(b.time));
  return `<section class="card card-pad"><div class="section-title"><h2>Review history <span class="count">${items.length}</span></h2></div><p class="muted small">Reviews, inline comments, and discussion in time order.</p>
  ${items.length ? `<ol class="timeline">${items.map(c => `<li><span class="avatar" aria-hidden="true">${h((c.user?.login || '?').slice(0, 1).toUpperCase())}</span><div><div class="timeline-head"><strong>${h(c.user?.login || 'Unknown')}</strong>${chip(c.type, c.type === 'approved' ? 'ok' : c.type === 'changes requested' ? 'warn' : '')}${c.author_association && authorGroup(c.author_association) === 'maintainer' ? chip('Maintainer', 'accent') : ''}<span class="muted small">${c.time ? formatDate(c.time) : ''}</span></div><pre class="description">${h(c.body || 'No written comment.')}</pre><div style="margin-top:.5rem">${link(c.html_url || p.html_url, 'View on GitHub')}</div></div></li>`).join('')}</ol>` : empty('No conversation yet', 'Start your review on GitHub, or record a local handoff.', 'message')}
  </section>`;
}
const CHECKLIST = ['Read the relevant project guidance', 'Inspected the changed code', 'Checked test evidence and results', 'Reviewed dependencies and sensitive paths', 'Recorded unresolved questions'];
function handoffView(p, d) {
  const note = noteFor(), prov = note.provenance || {}, ai = aiLines(p.body);
  const done = CHECKLIST.filter(t => note.checks[t]).length;
  return `<div class="grid-2">
  <div class="stack">
    <section class="card card-pad"><div class="section-title"><h2>Review checklist</h2><span id="check-count">${chip(`${done} of ${CHECKLIST.length}`, done === CHECKLIST.length ? 'ok' : '')}</span></div><p class="muted small">Tick only what you personally did.</p>
      ${CHECKLIST.map((text, i) => `<label class="checklist"><input type="checkbox" data-check="${i}" ${note.checks[text] ? 'checked' : ''}><span>${text}</span></label>`).join('')}
    </section>
    <section class="card card-pad"><div class="section-title"><h2>${icon('sparkles')}AI-use & provenance record</h2></div>
      <p class="muted small">A structured record of what is known about how this change was made. It records disclosure and verification; it doesn’t detect AI.</p>
      ${ai.length && !prov.disclosure ? `<div class="banner info">${icon('info')}<div>The description mentions AI use. You may want to choose “Disclosed by contributor”.</div></div>` : ''}
      ${Object.entries(provenanceFields).map(([k, [label, opts]]) => `<fieldset><legend>${label}</legend><div class="radio-row">${Object.entries(opts).map(([v, l]) => `<label><input type="radio" name="prov-${k}" value="${v}" data-prov="${k}" ${prov[k] === v ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>`).join('')}
      <label class="field" for="prov-notes">Provenance notes</label><input class="input" id="prov-notes" value="${h(prov.notes || '')}" placeholder="e.g. Contributor confirmed retry logic was hand-written">
    </section>
  </div>
  <section class="card card-pad"><div class="section-title"><h2>Notes & next action</h2></div>
    <label class="muted small" for="notes">What did you verify? What’s unresolved? Who should act next?</label>
    <textarea id="notes" placeholder="Reviewed the session refresh logic. Still need a regression test for expired credentials. Asked the author to confirm the new package name.">${h(note.text)}</textarea>
    <div class="btn-row" style="margin-top:1rem"><button class="btn primary" data-action="export-handoff">${icon('download')}Download handoff</button><button class="btn" data-action="copy-handoff">${icon('copy')}Copy as Markdown</button><span id="save-status" class="muted small">${note.updated ? 'Saved ' + new Date(note.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Autosaves on this device'}</span></div>
    <div class="banner" style="margin-top:1.25rem">${icon('info')}<div>Notes stay in this browser. The handoff includes your checklist, provenance record, the project rules applied, and any new dependencies — ready to paste into a PR comment or share with a co-maintainer.</div></div>
  </section></div>`;
}
function handoffText() {
  const p = current(), note = noteFor(), d = state.details.get(p.number);
  const checks = Object.fromEntries(CHECKLIST.map(t => [t, !!note.checks[t]]));
  return handoffMarkdown(state.data.repo.full_name, p, d, note.text, checks, note.provenance, d ? applyRules(p, d.files, state.data.docs) : []);
}

// ---------------------------------------------------------------------------
// Handoffs
function handoffsView() {
  const prefix = key('');
  const entries = Object.entries(state.notes).filter(([k]) => k.startsWith(prefix)).map(([k, n]) => ({ number: Number(k.slice(prefix.length)), n })).filter(e => Number.isFinite(e.number)).sort((a, b) => new Date(b.n.updated || 0) - new Date(a.n.updated || 0));
  return pageHead('Review', 'My handoffs', 'Checklists, provenance records, and notes saved in this browser for this repository.', entries.length ? `<button class="btn" data-action="export-all">${icon('download')}Export all notes</button>` : '')
  + `<section class="card">${entries.length ? `<ul class="pr-list">${entries.map(({ number, n }) => {
      const p = state.data.pulls.find(x => x.number === number), done = CHECKLIST.filter(t => n.checks?.[t]).length, prov = Object.keys(n.provenance || {}).filter(k => k !== 'notes').length;
      return `<li><button class="pr-row" ${p ? `data-pr="${number}"` : 'disabled'}>${icon('clipboard', 'pr-icon')}<span><span class="pr-title">${h(p?.title || n.title || 'Pull request #' + number)}</span><span class="pr-meta"><span>#${number}</span>${chip(`${done}/${CHECKLIST.length} checked`, done === CHECKLIST.length ? 'ok' : '')}${prov ? chip('Provenance recorded', 'accent', 'sparkles') : ''}${!p ? chip('Not in open queue') : ''}${n.updated ? `<span>Updated ${h(formatDate(n.updated))}</span>` : ''}</span>${n.text ? `<span class="pr-meta">${h(n.text.slice(0, 160))}${n.text.length > 160 ? '…' : ''}</span>` : ''}</span><span class="pr-side">${p ? `<span class="link-btn">Continue ${icon('right')}</span>` : ''}</span></button></li>`;
    }).join('')}</ul>` : empty('No handoffs yet', 'Open a pull request and use the Handoff & provenance tab to record what you checked and what’s next.', 'clipboard', `<button class="btn" data-page="queue">Go to the queue</button>`)}</section>`;
}

// ---------------------------------------------------------------------------
// Governance profile
const DIMS = [
  ['capacity', 'Capacity', 'users', 'Time, people, and resources available to keep governance working.', '', 'cap'],
  ['authority', 'Authority', 'scale', 'Who actually makes decisions — and whether participation turns into influence.', '', 'auth'],
  ['compliance', 'Compliance', 'shield', 'Licensing, security, AI rules, and external requirements — and whether they are enacted.', '', 'comp']
];
function profileView() {
  const actions = state.gov ? `<button class="btn" data-action="build-profile" ${state.govBusy ? 'disabled' : ''}>${icon('refresh')}Refresh</button><button class="btn primary" data-action="export-profile">${icon('download')}Export report</button>` : '';
  const head = pageHead('Governance', 'Governance profile', 'Where this project’s written governance and its everyday practice line up — and where they drift apart.', actions);
  if (!state.gov) return head + `<section class="card hero-empty"><div class="badge-icon">${icon('compass')}</div><h2>See the gap between documented and practiced governance</h2><p>OSS Review Steward compares what <strong>${h(state.data.repo.full_name)}</strong> writes down with what its contributors, recent pull requests, and queue show — organized by capacity, authority, and compliance.</p><button class="btn primary" data-action="build-profile" ${state.govBusy ? 'disabled' : ''}>${state.govBusy ? '<span class="spinner"></span>Building…' : 'Build governance profile'}</button><p class="muted small" style="margin-top:1rem">Uses about ${3 + Math.min(8, state.data.docs.filter(d => !/readme/i.test(d.name)).length)} read-only API requests.</p></section>`;
  const prof = governanceProfile(state.data, state.gov);
  const allTensions = DIMS.reduce((n, [k]) => n + prof.tensions[k].length, 0);
  const opened = prof.openness.filter(o => o.ok).length;
  return head + `<div class="banner info">${icon('info')}<div><strong>A conversation starter, not a score.</strong> These are interpretive signals from public data. Many differences are deliberate. Bring the exported report to a maintainer meeting and decide together which ones matter.</div></div>
  ${state.gov.warnings.map(w => `<div class="banner warn">${icon('alert')}<div>${h(w)}</div></div>`).join('')}
  <div class="stats">
    ${stat('Participation documented', `${opened}/${prof.openness.length}`, 'Openness check items found', 'eye', opened < 4 ? 'warn' : '')}
    ${stat('Worth discussing', allTensions, allTensions ? 'Places written and practiced diverge' : 'No strong divergences found', 'flag', allTensions ? 'warn' : '')}
    ${stat('Contributors listed', prof.sampled.contributors || '—', 'Excluding bots', 'users')}
    ${stat('Closed PRs sampled', prof.sampled.closed || '—', 'Most recently updated', 'pr')}
  </div>
  <section class="card" style="margin-bottom:1.25rem"><div class="card-head"><div><h2>Is participation documented?</h2><p>Being public isn’t the same as being open. Can a newcomer find out how to take part and where decisions happen?</p></div></div>
    <div class="card-body"><div class="openness">${prof.openness.map(o => `<div class="open-item ${o.ok ? 'ok' : 'no'}">${icon(o.ok ? 'checkCircle' : 'xCircle')}<div><strong>${h(o.title)}</strong>${o.url ? link(o.url, o.detail) : `<span>${h(o.detail)}</span>`}</div></div>`).join('')}</div></div>
  </section>
  <div class="stack">${DIMS.map(([k, name, ic, desc, ref]) => `<section class="card dim ${k}" aria-labelledby="dim-${k}">
    <div class="dim-head"><div class="badge-icon">${icon(ic)}</div><div><h2 id="dim-${k}">${name}</h2><p>${desc}</p></div></div>
    ${prof.tensions[k].map(t => `<div class="tension">${icon('flag')}<p><strong>Worth discussing:</strong> ${h(t.text)}<small>${h(t.ref)}</small></p></div>`).join('')}
    <div class="dim-cols">
      <div class="dim-col"><h3>${icon('file')}Written down</h3>${gItems(prof.dims[k].filter(i => i.kind === 'written'))}</div>
      <div class="dim-col"><h3>${icon('eye')}Observed in practice</h3>${gItems(prof.dims[k].filter(i => i.kind === 'practiced'))}</div>
    </div></section>`).join('')}</div>
  <p class="muted small" style="margin-top:1.25rem">Commit counts are not governance work, merge rates have many legitimate causes, and keyword matches can miss guidance written differently or hosted elsewhere.</p>`;
}
function gItems(items) {
  if (!items.length) return '<p class="muted small">No items.</p>';
  const label = { found: 'Found', missing: 'Not found', observed: 'Observed', unknown: 'Unavailable' };
  return items.map(i => `<div class="g-item">${icon(STATUS_ICON[i.status], 'status-icon ' + i.status)}<div><div class="g-item-head"><strong>${h(i.title)}</strong><span class="g-value">${h(i.value)}</span></div><p>${h(i.detail)}</p><div class="g-tags"><span class="sr-only">${label[i.status]}.</span>${i.evidence.map(e => `<span class="evidence">${link(e.url, e.label)}</span>`).join('')}</div></div></div>`).join('');
}

// ---------------------------------------------------------------------------
// Guidance
function guidanceView() {
  const docs = state.data.docs, exps = extractExpectations(docs).filter(e => state.expFilter === 'all' || (state.expFilter === 'ai' ? e.ai : e.doc === state.expFilter));
  const doc = docs[Math.min(state.doc, docs.length - 1)];
  const head = pageHead('Governance', 'Project guidance', 'The project’s own documents, with likely requirements pulled out so they’re easy to keep beside your review.');
  if (!docs.length) return head + `<section class="card">${empty('No guidance documents found', 'OSS Review Steward checks the repository root, .github, docs/, and the community profile. Guidance may live elsewhere — missing here doesn’t mean no policy exists.', 'book', `<button class="btn" data-page="toolkit">Draft governance documents</button>`)}</section>`;
  return head + `<div class="split left">
    <aside class="card card-pad"><div class="section-title"><h2>Documents <span class="count">${docs.length}</span></h2></div><div class="doc-list">${docs.map((d, i) => `<button class="doc-btn" data-doc="${i}" aria-pressed="${d === doc}"><span>${icon('file')} ${h(d.name)}</span></button>`).join('')}</div></aside>
    <section class="card"><div class="card-head"><div><h2>${h(doc.name)}</h2><p>${plural(doc.text.split('\n').length, 'line')}</p></div>${link(doc.url, 'View on GitHub', 'btn sm')}</div><div class="card-body"><pre class="doc-text">${h(doc.text)}</pre></div></section>
  </div>
  <section class="card" style="margin-top:1.25rem"><div class="card-head"><div><h2>Candidate expectations <span class="count">${exps.length}</span></h2><p>Sentences with words like “must”, “should”, or “please”. Read the surrounding document before applying one.</p></div>
    <div class="segmented" role="group" aria-label="Filter expectations"><button data-exp="all" aria-pressed="${state.expFilter === 'all'}">All</button><button data-exp="ai" aria-pressed="${state.expFilter === 'ai'}">${icon('sparkles')}AI-related</button></div></div>
    <div class="card-body">${exps.length ? exps.map(e => `<article class="expectation"><p>${h(e.text)}</p><div class="meta">${e.ai ? chip('AI-related', 'info', 'sparkles') : ''}${link(e.url, e.doc + ' · line ' + e.line)}</div></article>`).join('') : empty(state.expFilter === 'ai' ? 'No AI-related expectations' : 'No candidate requirements', state.expFilter === 'ai' ? 'The loaded documents say nothing about AI-assisted contributions. The toolkit can draft a policy.' : 'Read the source documents for context.', 'book', state.expFilter === 'ai' ? `<button class="btn sm" data-page="toolkit">Draft an AI policy</button>` : '')}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Expectation gaps
function gapsView() {
  const gaps = state.sample ? detectGaps(state.sample.comments, state.data.docs) : [];
  const head = pageHead('Governance', 'Expectation gaps', 'Things reviewers keep asking for that aren’t written down yet. Confirm the real ones, then turn them into guidance.',
    state.sample ? `<button class="btn" data-action="scan" ${state.busy ? 'disabled' : ''}>${icon('refresh')}Rescan</button>` : '');
  if (!state.sample) return head + `<section class="card hero-empty"><div class="badge-icon">${icon('gap')}</div><h2>Find the expectations between the lines</h2><p>Repeated maintainer requests for tests, benchmarks, changelogs, reproduction steps, docs, or AI disclosure may reveal guidance worth writing down — so newcomers don’t have to learn it the hard way.</p><button class="btn primary" data-action="scan" ${state.busy ? 'disabled' : ''}>Scan recent reviews</button><p class="muted small" style="margin-top:1rem">Reads inline review comments on up to 10 recently closed PRs. Makes no changes on GitHub.</p></section>`;
  return head + `<div class="banner info">${icon('info')}<div><strong>Suggestions for human review.</strong> Six request topics, matched in inline comments from owners, members, and collaborators, across ${state.sample.count} recently updated closed PRs (${state.sample.comments.length} comments). A topic appears when it was requested on 2+ PRs and no matching keyword is in the loaded guidance.</div></div>
  ${state.sample.warnings.map(w => `<div class="banner warn">${icon('alert')}<div>${h(w)}</div></div>`).join('')}
  ${gaps.length ? `<div class="stack">${gaps.map(g => {
    const status = state.gapStates[key('gap:' + g.id)] || 'Needs review';
    return `<section class="card"><div class="card-head"><div><div class="eyebrow">Possible unwritten expectation</div><h2>${h(g.name)}</h2><p>Requested on ${g.prCount} sampled PRs. Not found in loaded guidance.</p></div>${chip(status, status === 'Confirmed' ? 'ok' : status === 'Dismissed' ? '' : 'info')}</div>
      <div class="card-body">${g.evidence.map(c => `<blockquote><p>“${h(c.body)}”</p><cite>${h(c.user?.login || 'Reviewer')} · ${link(c.html_url, 'PR #' + c.pr)}</cite></blockquote>`).join('')}
        <div class="suggestion"><span class="small-caps">Draft guidance — adapt to your project</span><p>${h(g.suggestion)}</p></div>
        <div class="btn-row"><button class="btn primary" data-gap="${g.id}" data-status="Confirmed">${icon('check')}Confirm</button><button class="btn" data-gap="${g.id}" data-status="Context-specific">Context-specific</button><button class="btn" data-gap="${g.id}" data-status="Dismissed">Dismiss</button><button class="btn ghost" data-export-gap="${g.id}">${icon('download')}Export proposal</button></div>
        ${status === 'Confirmed' ? `<p class="small" style="margin-top:.75rem">${icon('check')} Confirmed expectations are added automatically to the PR template, AGENTS.md, and policy card in the <button class="link-btn" data-page="toolkit">Governance toolkit</button>.</p>` : ''}
      </div></section>`;
  }).join('')}</div>` : `<section class="card">${empty('No recurring gaps in this sample', 'A limited scan with no findings doesn’t show that written guidance and practice are aligned.', 'checkCircle')}</section>`}`;
}

// ---------------------------------------------------------------------------
// Toolkit
const TOOLS = [
  ['ai-policy', 'AI contribution policy', 'sparkles', 'AI_POLICY.md', 'Disclosure, verification, licensing, and dependency checks.'],
  ['pr-template', 'PR template with AI-use record', 'pr', '.github/pull_request_template.md', 'Structured disclosure contributors fill in when they open a PR.'],
  ['governance', 'Decision-making & participation', 'scale', 'GOVERNANCE.md', 'Who decides, how to propose changes, how to gain responsibility.'],
  ['agents', 'AI assistant context file', 'file', 'AGENTS.md', 'Project conventions told directly to coding assistants.'],
  ['policy-card', 'Machine-readable policy card', 'layers', '.github/policy-card.yml', 'Review expectations as checkable rules that prompt humans.']
];
function existing(kind) {
  const files = state.data.rootFiles || [], has = re => files.find(f => re.test(f));
  if (kind === 'ai-policy') { const s = findPolicyLine(state.data.docs, PATTERNS.aiPolicy); return s ? `${s.doc} already mentions AI (line ${s.line}).` : ''; }
  if (kind === 'pr-template') return has(/pull_request_template/i) ? `${has(/pull_request_template/i)} exists — consider adding just the AI-use record section.` : '';
  if (kind === 'governance') return has(/(^|\/)GOVERNANCE/i) ? `${has(/(^|\/)GOVERNANCE/i)} exists — compare against the sections below.` : '';
  if (kind === 'agents') return has(/(^|\/)(AGENTS|CLAUDE)\.md$|copilot-instructions|\.cursorrules/i) || '';
  return '';
}
function toolkitView() {
  const tk = state.toolkit, [, name, , file, desc] = TOOLS.find(t => t[0] === tk.kind), gaps = confirmedGaps(), found = existing(tk.kind);
  const text = template(tk.kind, { ...tk, project: state.data.repo.full_name.split('/')[1], confirmedGaps: gaps });
  const opts = tk.kind === 'ai-policy' ? `<fieldset><legend>Stance</legend><div class="radio-row">${[['disclose', 'Welcome, with disclosure'], ['limited', 'Limited assistance only'], ['none', 'Not accepted']].map(([v, l]) => `<label><input type="radio" name="tk-stance" data-tk="stance" value="${v}" ${tk.stance === v ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Ask contributors to</legend>${[['verify', 'Describe how they verified the change'], ['licensing', 'Respect licenses (no AI rewrites of incompatible code)'], ['deps', 'Confirm new dependencies exist']].map(([k, l]) => `<label class="check-inline"><input type="checkbox" data-tkb="${k}" ${tk[k] ? 'checked' : ''}>${l}</label>`).join('')}</fieldset>`
    : tk.kind === 'governance' ? `<fieldset><legend>Decision model</legend><div class="radio-row">${[['council', 'Maintainer council'], ['bdfl', 'Project lead'], ['doocracy', 'Do-ocracy'], ['steering', 'Steering committee']].map(([v, l]) => `<label><input type="radio" name="tk-model" data-tk="model" value="${v}" ${tk.model === v ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>`
    : ['pr-template', 'agents', 'policy-card'].includes(tk.kind) ? `<p class="small">${gaps.length ? `${icon('check')} Includes ${plural(gaps.length, 'confirmed expectation')} from Expectation gaps: ${gaps.map(g => h(g.name)).join(', ')}.` : `${icon('info')} Confirm expectation gaps to add them here automatically.`} <button class="link-btn" data-page="gaps">Expectation gaps</button></p>` : '';
  return pageHead('Governance', 'Governance toolkit', 'Starter documents for projects without time to write governance from scratch. Adapt them to your project — they are drafts, not standards.')
  + `<div class="banner">${icon('info')}<div>Small projects shouldn’t each have to invent governance alone. These templates keep requirements light and put the burden on clarity, not on paperwork.</div></div>
  <div class="split left">
    <aside class="stack"><div class="tool-pick" role="group" aria-label="Choose a template">${TOOLS.map(([id, label, ic, , d]) => `<button class="tool-btn" data-tool="${id}" aria-pressed="${tk.kind === id}">${icon(ic)}<strong>${label}</strong><span>${d}</span></button>`).join('')}</div></aside>
    <section class="card"><div class="card-head"><div><h2>${name}</h2><p>${desc} Save as <code>${file}</code>.</p></div><div class="btn-row"><button class="btn" data-action="copy-template">${icon('copy')}Copy</button><button class="btn primary" data-action="download-template">${icon('download')}Download</button></div></div>
      <div class="card-body">${found ? `<div class="banner warn">${icon('alert')}<div><strong>Already in this repository:</strong> ${h(found)}</div></div>` : `<div class="banner info">${icon('info')}<div>Not found in <strong>${h(state.data.repo.full_name)}</strong>.</div></div>`}
        ${opts}<pre class="preview" id="template-preview">${h(text)}</pre></div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Dialogs
const EXAMPLES = ['pallets/flask', 'expressjs/express', 'psf/requests'];
function modal(kind) {
  const el = document.getElementById('modal'); if (el.open) el.close();
  const close = `<button class="btn ghost icon-only close-x" data-action="close-modal" aria-label="Close">${icon('x')}</button>`;
  if (kind === 'connect') el.innerHTML = `${close}<div class="eyebrow">Connect a repository</div><h2 id="modal-title">Review with your own project</h2><p class="muted">Paste a GitHub repository URL. OSS Review Steward loads open pull requests and discovers the project’s governance documents. Read-only.</p>
    <form id="connect-form"><label class="field" for="repo-input">GitHub repository</label><input class="input" id="repo-input" required placeholder="https://github.com/owner/repository or owner/repository" autocomplete="off" spellcheck="false"><div id="form-error" class="form-error" role="alert"></div><button class="btn primary full" type="submit">Connect ${icon('right')}</button></form>
    ${state.recent.length ? `<p class="small muted" style="margin:0">Recent</p><div class="quick-repos">${state.recent.map(r => `<button class="btn sm" data-repo="${h(r)}">${h(r)}</button>`).join('')}</div>` : ''}
    <p class="small muted" style="margin:1rem 0 0">Try a public project</p><div class="quick-repos">${EXAMPLES.map(r => `<button class="btn sm" data-repo="${r}">${r}</button>`).join('')}</div>
    <hr><p class="small muted">Public repositories work without a token within GitHub’s limit of 60 requests per hour. Add a token in <button class="link-btn" data-action="settings">Settings</button> for private repositories or more requests.</p>
    <button class="link-btn" data-action="demo">${icon('sparkles')}Explore the demo workspace instead</button>`;
  else if (kind === 'shortcuts') el.innerHTML = `${close}<h2 id="modal-title">Keyboard shortcuts</h2><div class="shortcuts" style="margin-top:1.25rem"><kbd>/</kbd><span>Search the queue</span><kbd>j</kbd><span>Next pull request</span><kbd>k</kbd><span>Previous pull request</span><kbd>Esc</kbd><span>Back to the queue</span><kbd>1</kbd>–<kbd>4</kbd><span style="grid-column:2">Switch tabs on a pull request</span><kbd>?</kbd><span>Show this list</span></div>`;
  else el.innerHTML = `${close}<div class="eyebrow">Settings</div><h2 id="modal-title">Display, access, and data</h2>
    <h3 style="margin-top:1.5rem">Display</h3>
    <fieldset><legend>Theme</legend><div class="radio-row">${[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label><input type="radio" name="theme" data-pref="theme" value="${v}" ${state.prefs.theme === v ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Text size</legend><div class="radio-row">${[['md', 'Default'], ['lg', 'Large'], ['xl', 'Larger']].map(([v, l]) => `<label><input type="radio" name="text" data-pref="text" value="${v}" ${state.prefs.text === v ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>
    <hr><h3>GitHub access</h3><p class="muted small">Optional. A fine-grained token with read access to Contents, Pull requests, Issues, Checks, and Commit statuses. Sent only to api.github.com and never saved — reloading clears it.</p>
    <form id="token-form"><label class="field" for="token-input">Personal access token</label><input class="input" type="password" id="token-input" autocomplete="off" placeholder="${state.token ? 'Token in use · enter a replacement' : 'github_pat_…'}"><div class="btn-row" style="margin-top:.75rem"><button class="btn primary" type="submit">Use for this session</button>${state.token ? '<button class="btn" type="button" data-action="disconnect">Remove token</button>' : ''}</div></form>
    <hr><h3>Local review data</h3><p class="muted small">Notes, provenance records, and gap decisions live in this browser. They may include private information you typed.</p><div class="btn-row"><button class="btn" data-action="export-all">${icon('download')}Export all notes</button><button class="btn danger" data-action="clear-local">Clear local data</button></div>`;
  el.showModal();
  if (kind !== 'settings') el.querySelector('input')?.focus();
}

// ---------------------------------------------------------------------------
// Data loading
function resetRepoState() {
  state.details.clear(); state.triage.clear(); state.gov = null; state.sample = null;
  state.filter = 'all'; state.search = ''; state.page = 'queue'; state.detailError = ''; state.doc = 0; state.expFilter = 'all';
}
async function connect(input) {
  let repo;
  try { repo = parseRepository(input); } catch (e) { const el = document.getElementById('form-error'); if (el && document.getElementById('modal').open) el.textContent = e.message; else { state.error = e.message; render(); } return; }
  document.getElementById('modal')?.close();
  controller.abort(); controller = new AbortController();
  const sequence = ++state.sequence;
  Object.assign(state, { busy: true, error: '', selected: null, loadingDetail: false, navOpen: false }); render();
  try {
    const data = await api.repository(repo, controller.signal);
    if (sequence !== state.sequence) return;
    state.data = data; state.demo = false; resetRepoState();
    state.recent = [data.repo.full_name, ...state.recent.filter(r => r.toLowerCase() !== data.repo.full_name.toLowerCase())].slice(0, 5); savePref(STORE.recent, state.recent);
    history.replaceState(null, '', '?repo=' + encodeURIComponent(data.repo.full_name));
    notify(`Connected to ${data.repo.full_name}. Open a PR to load its evidence.`);
  } catch (e) { if (e.name !== 'AbortError' && sequence === state.sequence) state.error = e.message; }
  finally { if (sequence === state.sequence) { state.busy = false; render(); } }
}
async function selectPR(number) {
  Object.assign(state, { selected: number, tab: 'brief', detailError: '', loadingDetail: false, navOpen: false });
  if (state.details.has(number)) { render(); scrollTo(0, 0); return; }
  if (state.demo) { state.details.set(number, demoDetail(number)); render(); scrollTo(0, 0); return; }
  state.loadingDetail = true; render(); scrollTo(0, 0);
  const sequence = state.sequence;
  try { const result = await api.detail(state.data.repo.full_name, number, controller.signal); if (sequence === state.sequence) state.details.set(number, result); }
  catch (e) { if (e.name !== 'AbortError' && state.selected === number && sequence === state.sequence) state.detailError = e.message; }
  finally { if (sequence === state.sequence && state.selected === number) { state.loadingDetail = false; render(); } }
}
async function scan() {
  state.busy = true; render();
  const sequence = state.sequence;
  try { const sample = state.demo ? demoSample() : await api.sampleReviews(state.data.repo.full_name, controller.signal); if (sequence === state.sequence) state.sample = sample; }
  catch (e) { if (e.name !== 'AbortError' && sequence === state.sequence) state.error = e.message; }
  finally { if (sequence === state.sequence) { state.busy = false; render(); } }
}
async function buildProfile() {
  if (state.demo) { state.gov = demoGovernance(); render(); notify('Demo profile refreshed.'); return; }
  state.govBusy = true; render();
  const sequence = state.sequence;
  try { const gov = await api.governance(state.data.repo.full_name, state.data.docs, controller.signal); if (sequence === state.sequence) state.gov = gov; }
  catch (e) { if (e.name !== 'AbortError' && sequence === state.sequence) state.error = e.message; }
  finally { if (sequence === state.sequence) { state.govBusy = false; render(); } }
}
async function loadTriage() {
  const targets = visiblePRs().filter(p => !tierFor(p)).slice(0, 20);
  if (!targets.length) { notify('Review focus is already loaded for the listed PRs.'); return; }
  state.triageBusy = true; render();
  const sequence = state.sequence, repo = state.data.repo.full_name;
  let i = 0, failed = 0, stop = false;
  const worker = async () => {
    while (i < targets.length && !stop) {
      const p = targets[i++];
      try { const files = await api.files(repo, p.number, controller.signal); if (sequence === state.sequence) state.triage.set(p.number, files); }
      catch (e) { if (e.name === 'AbortError') { stop = true; return; } failed++; if (e.status === 403 || e.status === 429) { stop = true; state.error = e.message; } }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (sequence !== state.sequence) return;
  state.triageBusy = false;
  if (state.sort === 'oldest') state.sort = 'focus';
  render();
  notify(`Review focus loaded for ${targets.length - failed} PRs${failed ? ` (${failed} failed)` : ''}. Sorted by review focus.`);
}

// ---------------------------------------------------------------------------
// Events
function saveNote(mutate) {
  const p = current(), note = noteFor();
  note.provenance = note.provenance || {};
  mutate(note); note.title = p?.title; note.updated = new Date().toISOString();
  state.notes[key()] = note;
  const ok = persist();
  const el = document.getElementById('save-status'); if (el) el.textContent = ok ? 'Saved on this device' : 'Not saved — export your notes';
}
function rerenderTemplate() {
  const tk = state.toolkit, pre = document.getElementById('template-preview');
  if (pre) pre.textContent = template(tk.kind, { ...tk, project: state.data.repo.full_name.split('/')[1], confirmedGaps: confirmedGaps() });
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button,a,[data-action]');
  if (!target || target.disabled) return;
  const ds = target.dataset;
  if (ds.page) { Object.assign(state, { page: ds.page, selected: null, navOpen: false }); document.getElementById('modal').close(); render(); document.getElementById('main')?.focus({ preventScroll: true }); scrollTo(0, 0); return; }
  if (ds.pr) { selectPR(Number(ds.pr)); return; }
  if (ds.tab) { state.tab = ds.tab; render(); return; }
  if (ds.filter) { state.filter = ds.filter; render(); return; }
  if (ds.doc) { state.doc = Number(ds.doc); render(); return; }
  if (ds.exp) { state.expFilter = ds.exp; render(); return; }
  if (ds.tool) { state.toolkit.kind = ds.tool; render(); return; }
  if (ds.repo) { connect(ds.repo); return; }
  if (ds.gap) { state.gapStates[key('gap:' + ds.gap)] = ds.status; persist(); render(); notify(`Marked “${GAP_TOPICS.find(g => g.id === ds.gap).name}” as ${ds.status.toLowerCase()}.`); return; }
  if (ds.exportGap) {
    const g = detectGaps(state.sample.comments, state.data.docs).find(x => x.id === ds.exportGap);
    download('guidance-proposal-' + g.id + '.md', `# Proposed contribution guidance: ${g.name}\n\nStatus: ${state.gapStates[key('gap:' + g.id)] || 'Needs review'}\n\n${g.suggestion}\n\n## Supporting review examples\n${g.evidence.map(e => '- PR #' + e.pr + ': ' + e.html_url + '\n  > ' + e.body).join('\n')}\n\nDraft proposal. Confirm applicability and check all project guidance before adoption.\n`);
    return;
  }
  const action = ds.action; if (!action) return;
  event.preventDefault();
  const tk = state.toolkit;
  switch (action) {
    case 'connect': case 'settings': case 'shortcuts': modal(action); break;
    case 'close-modal': document.getElementById('modal').close(); break;
    case 'open-nav': state.navOpen = true; render(); app.querySelector('.sidebar .nav-item')?.focus(); break;
    case 'close-nav': state.navOpen = false; render(); break;
    case 'back': state.selected = null; render(); break;
    case 'home': Object.assign(state, { page: 'queue', selected: null, navOpen: false }); render(); break;
    case 'dismiss-error': state.error = ''; render(); break;
    case 'dismiss-demo': state.dismissed.demo = true; savePref(STORE.dismiss, state.dismissed); render(); break;
    case 'retry-detail': selectPR(state.selected); break;
    case 'scan': scan(); break;
    case 'triage': loadTriage(); break;
    case 'build-profile': buildProfile(); break;
    case 'export-profile': download(`governance-profile-${state.data.repo.full_name.replace('/', '-')}.md`, profileMarkdown(state.data.repo.full_name, governanceProfile(state.data, state.gov), state.gov.loadedAt)); break;
    case 'refresh': api.cache.clear(); if (state.demo) { useDemo(); render(); notify('Demo refreshed.'); } else connect(state.data.repo.full_name); break;
    case 'demo':
      controller.abort(); controller = new AbortController(); state.sequence++;
      useDemo(); Object.assign(state, { selected: null, busy: false, loadingDetail: false, error: '', page: 'queue', search: '', filter: 'all' });
      history.replaceState(null, '', location.pathname); document.getElementById('modal').close(); render(); break;
    case 'disconnect': state.token = ''; api = new GitHub('', onRate); state.rate = null; notify('Token removed.'); modal('settings'); break;
    case 'export-handoff': download(`oss-review-steward-${current().number}-handoff.md`, handoffText()); break;
    case 'copy-handoff': copy(handoffText()); break;
    case 'copy-template': copy(template(tk.kind, { ...tk, project: state.data.repo.full_name.split('/')[1], confirmedGaps: confirmedGaps() })); break;
    case 'download-template': { const file = TOOLS.find(t => t[0] === tk.kind)[3]; download(file.split('/').pop(), template(tk.kind, { ...tk, project: state.data.repo.full_name.split('/')[1], confirmedGaps: confirmedGaps() }), file.endsWith('.yml') ? 'text/yaml' : 'text/markdown'); break; }
    case 'export-all': download('oss-review-steward-notes.json', JSON.stringify({ notes: state.notes, gapDecisions: state.gapStates }, null, 2), 'application/json'); break;
    case 'clear-local':
      if (confirm('Clear all locally saved OSS Review Steward notes, provenance records, and gap decisions? Export them first if you need a copy.')) { state.notes = {}; state.gapStates = {}; persist(); notify('Local data cleared.'); modal('settings'); }
      break;
    case 'toggle-theme': {
      const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      state.prefs.theme = dark ? 'light' : 'dark'; applyPrefs(); render(); break;
    }
    case 'cycle-text': {
      const order = ['md', 'lg', 'xl'], next = order[(order.indexOf(state.prefs.text) + 1) % 3];
      state.prefs.text = next; applyPrefs(); render(); notify('Text size: ' + { md: 'Default', lg: 'Large', xl: 'Larger' }[next]); break;
    }
  }
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'connect-form') connect(document.getElementById('repo-input').value);
  if (event.target.id === 'token-form') {
    const token = document.getElementById('token-input').value.trim();
    if (!token) { notify('Enter a token first.'); return; }
    state.token = token; api = new GitHub(token, onRate);
    document.getElementById('modal').close();
    notify('Token set for this session. It will be checked on the next GitHub request.');
  }
});
document.addEventListener('input', event => {
  const t = event.target;
  if (t.id === 'search') { state.search = t.value; document.getElementById('queue-list').innerHTML = queueList(); }
  if (t.id === 'notes') saveNote(n => { n.text = t.value; });
  if (t.id === 'prov-notes') saveNote(n => { n.provenance.notes = t.value; });
});
document.addEventListener('change', event => {
  const t = event.target, ds = t.dataset;
  if (t.id === 'sort') { state.sort = t.value; document.getElementById('queue-list').innerHTML = queueList(); }
  if (ds.check !== undefined) {
    saveNote(n => { n.checks[CHECKLIST[Number(ds.check)]] = t.checked; });
    const done = CHECKLIST.filter(x => noteFor().checks[x]).length, el = document.getElementById('check-count');
    if (el) el.innerHTML = chip(`${done} of ${CHECKLIST.length}`, done === CHECKLIST.length ? 'ok' : '');
  }
  if (ds.prov) saveNote(n => { n.provenance[ds.prov] = t.value; });
  if (ds.pref) { state.prefs[ds.pref] = t.value; applyPrefs(); render(); }
  if (ds.tk) { state.toolkit[ds.tk] = t.value; rerenderTemplate(); }
  if (ds.tkb) { state.toolkit[ds.tkb] = t.checked; rerenderTemplate(); }
});
document.addEventListener('keydown', event => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  const modalOpen = document.getElementById('modal').open;
  if (modalOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') {
    if (typing) { event.target.blur(); return; }
    if (state.navOpen) { state.navOpen = false; render(); return; }
    if (state.selected) { const n = state.selected; state.selected = null; render(); app.querySelector(`[data-pr="${n}"]`)?.focus(); }
    return;
  }
  if (typing) return;
  if (event.key === '/') { const s = document.getElementById('search'); if (s) { event.preventDefault(); s.focus(); } else if (!state.selected) { state.page = 'queue'; render(); document.getElementById('search')?.focus(); event.preventDefault(); } return; }
  if (event.key === '?') { modal('shortcuts'); return; }
  if (state.selected && /^[1-4]$/.test(event.key)) { state.tab = TABS[Number(event.key) - 1][0]; render(); return; }
  if (event.key === 'j' || event.key === 'k') {
    const rows = [...app.querySelectorAll('.pr-row:not(:disabled)')]; if (!rows.length) return;
    const i = rows.indexOf(document.activeElement);
    const next = event.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    rows[next].focus(); rows[next].scrollIntoView({ block: 'nearest' }); event.preventDefault();
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.prefs.theme === 'system') render(); });

applyPrefs();
const initialRepo = new URLSearchParams(location.search).get('repo');
if (initialRepo) { render(); connect(initialRepo); } else route();
