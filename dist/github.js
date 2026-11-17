import { parseRepository } from './core.js';

// Governance-relevant files, in load priority order (README last: it is often large and least specific).
const DOC_PRIORITY = [/^contributing/i, /^governance/i, /^ai[_-]?(policy|usage|contributions?)/i, /^pull_request_template/i, /^maintainers/i, /^security/i, /^agents\.md$/i, /^claude\.md$/i, /^copilot-instructions/i, /^roadmap/i, /^codeowners$/i, /^readme/i];
const MAX_DOCS = 10;

export class GitHub {
  constructor(token = '', onRate = () => {}) { this.token = token; this.onRate = onRate; this.cache = new Map(); }

  async get(path, signal) {
    if (!path.startsWith('/repos/')) throw new Error('Unsupported API path.');
    if (this.cache.has(path)) return this.cache.get(path);
    const headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const response = await fetch('https://api.github.com' + path, { headers, signal });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining !== null) this.onRate({ remaining: Number(remaining), reset: Number(response.headers.get('x-ratelimit-reset')) });
    if (!response.ok) {
      const error = new Error(response.status === 404 ? 'Repository or resource not found. Check the URL and, for private projects, token access.'
        : response.status === 401 ? 'GitHub rejected this token. Update it in Settings.'
        : response.status === 403 || response.status === 429 ? 'GitHub access or rate limit reached. Check token permissions, wait for the limit to reset, or add a token in Settings.'
        : `GitHub request failed (${response.status}). Please retry.`);
      error.status = response.status; throw error;
    }
    const data = response.status === 204 ? [] : await response.json();
    this.cache.set(path, data); return data;
  }

  async list(path, maxPages = 3, signal) {
    const items = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.get(path + (path.includes('?') ? '&' : '?') + `per_page=100&page=${page}`, signal);
      if (!Array.isArray(data)) throw new Error('Unexpected response from GitHub.');
      items.push(...data);
      if (data.length < 100) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  async repository(input, signal) {
    const name = parseRepository(input), base = '/repos/' + name;
    const [repo, pulls] = await Promise.all([this.get(base, signal), this.list(base + '/pulls?state=open&sort=created&direction=desc', 3, signal)]);
    const docs = [], warnings = [];
    const result = await Promise.allSettled([this.get(base + '/community/profile', signal), this.get(base + '/contents', signal), this.get(base + '/contents/.github', signal), this.get(base + '/contents/docs', signal)]);
    const rootFiles = new Set();
    for (let i = 1; i < 4; i++) if (result[i].status === 'fulfilled' && Array.isArray(result[i].value)) for (const f of result[i].value) rootFiles.add(f.path + (f.type === 'dir' ? '/' : ''));
    if (result[0].status === 'fulfilled') {
      for (const key of ['contributing', 'readme', 'code_of_conduct', 'pull_request_template']) {
        const f = result[0].value.files?.[key];
        if (f?.url?.startsWith('https://api.github.com' + base + '/contents/')) rootFiles.add(decodeURIComponent(f.url.split('/contents/')[1].split('?')[0]));
      }
    }
    if (result.some(r => r.status === 'rejected' && r.reason.status !== 404)) warnings.push('Some documentation locations could not be read.');
    const rank = p => { const n = p.split('/').pop(); const i = DOC_PRIORITY.findIndex(re => re.test(n)); return i < 0 ? 99 : i + (p.startsWith('docs/') ? 0.5 : 0); };
    const candidates = [...rootFiles].filter(p => !p.endsWith('/') && rank(p) < 99).sort((a, b) => rank(a) - rank(b));
    if (candidates.length > MAX_DOCS) warnings.push(`Loaded the first ${MAX_DOCS} of ${candidates.length} governance documents.`);
    await Promise.all(candidates.slice(0, MAX_DOCS).map(async path => {
      try {
        const f = await this.get(base + '/contents/' + path.split('/').map(encodeURIComponent).join('/'), signal);
        if (f.encoding !== 'base64' || !f.content) { warnings.push(`${path}: content unavailable or too large.`); return; }
        const bytes = Uint8Array.from(atob(f.content.replace(/\s/g, '')), c => c.charCodeAt(0));
        docs.push({ name: path, text: new TextDecoder().decode(bytes), url: f.html_url, rank: rank(path) });
      } catch (e) { if (e.name === 'AbortError') throw e; warnings.push(`${path}: could not load.`); }
    }));
    docs.sort((a, b) => a.rank - b.rank);
    return { repo, pulls: pulls.items, queueTruncated: pulls.truncated, docs, rootFiles: [...rootFiles], warnings, loadedAt: new Date().toISOString() };
  }

  // Lightweight: changed files only, for queue triage.
  async files(repo, number, signal) {
    return (await this.list('/repos/' + repo + '/pulls/' + number + '/files', 3, signal)).items;
  }

  async detail(repo, number, signal) {
    const base = '/repos/' + repo, p = base + '/pulls/' + number;
    const [pr, files, reviews, comments, discussion] = await Promise.allSettled([this.get(p, signal), this.list(p + '/files', 10, signal), this.list(p + '/reviews', 3, signal), this.list(p + '/comments', 3, signal), this.list(base + '/issues/' + number + '/comments', 3, signal)]);
    if (pr.status === 'rejected') throw pr.reason;
    if (files.status === 'rejected') throw files.reason;
    const warnings = [];
    const take = (r, label) => { if (r.status === 'fulfilled') { if (r.value.truncated) warnings.push(`${label} limited to the loaded sample.`); return r.value.items; } warnings.push(`${label} unavailable: ${r.reason.message}`); return []; };
    const loadedFiles = take(files, 'Changed files');
    const checkResults = await Promise.allSettled([this.get(base + '/commits/' + pr.value.head.sha + '/check-runs?per_page=100', signal), this.get(base + '/commits/' + pr.value.head.sha + '/status?per_page=100', signal)]);
    const checks = [];
    if (checkResults[0].status === 'fulfilled') { checks.push(...checkResults[0].value.check_runs); if (checkResults[0].value.total_count > 100) warnings.push('Check runs limited to the first 100.'); }
    if (checkResults[1].status === 'fulfilled') checks.push(...checkResults[1].value.statuses);
    const checkError = checkResults.filter(r => r.status === 'rejected').map(r => r.reason.message).join(' ');
    if (checkError) warnings.push('Some check results could not be loaded. ' + checkError);
    return { pr: pr.value, files: loadedFiles, reviews: take(reviews, 'Reviews'), comments: take(comments, 'Review comments'), discussion: take(discussion, 'Discussion'), checks, checkError, warnings };
  }

  // Inputs for the governance profile (~3 + number of docs requests).
  async governance(repo, docs, signal) {
    const base = '/repos/' + repo, warnings = [];
    const [contributors, closed, labels] = await Promise.allSettled([
      this.get(base + '/contributors?per_page=100', signal),
      this.get(base + '/pulls?state=closed&sort=updated&direction=desc&per_page=60', signal),
      this.get(base + '/labels?per_page=100', signal)
    ]);
    const val = (r, label) => { if (r.status === 'fulfilled') return r.value; if (r.reason.name === 'AbortError') throw r.reason; warnings.push(`${label} unavailable: ${r.reason.message}`); return []; };
    const docDates = {};
    await Promise.all(docs.filter(d => !/readme/i.test(d.name)).slice(0, 8).map(async d => {
      try { const c = await this.get(base + '/commits?path=' + encodeURIComponent(d.name) + '&per_page=1', signal); if (c[0]) docDates[d.name] = c[0].commit?.committer?.date || c[0].commit?.author?.date; }
      catch (e) { if (e.name === 'AbortError') throw e; }
    }));
    return { contributors: val(contributors, 'Contributors'), closed: val(closed, 'Closed pull requests'), labels: val(labels, 'Labels').map(l => l.name), docDates, warnings, loadedAt: new Date().toISOString() };
  }

  async sampleReviews(repo, signal) {
    const prs = await this.get('/repos/' + repo + '/pulls?state=closed&sort=updated&direction=desc&per_page=10', signal);
    const comments = [], warnings = [];
    await Promise.all(prs.map(async pr => {
      try {
        const data = await this.list('/repos/' + repo + '/pulls/' + pr.number + '/comments', 1, signal);
        comments.push(...data.items.map(c => ({ ...c, pr: pr.number })));
        if (data.truncated) warnings.push(`PR #${pr.number}: first 100 inline review comments only.`);
      } catch (e) { if (e.name === 'AbortError') throw e; warnings.push(`PR #${pr.number}: ${e.message}`); }
    }));
    return { comments, warnings, count: prs.length };
  }
}
