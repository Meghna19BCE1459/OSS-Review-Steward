// OSS Review Steward core logic: pure functions only (no DOM, no network). Covered by tests/core.test.mjs.

export function parseRepository(input) {
  const s = String(input || '').trim();
  let path = s;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    if (u.hostname.toLowerCase() !== 'github.com' || u.protocol !== 'https:' || u.username || u.password) throw new Error('Use an https://github.com/owner/repository URL.');
    path = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/').slice(0, 2).join('/');
  }
  const match = path.match(/^([a-zA-Z0-9][a-zA-Z0-9-]*)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/);
  if (!match || match[2] === '.' || match[2] === '..') throw new Error('Enter a GitHub repository URL or owner/repository.');
  return match[1] + '/' + match[2];
}

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : '#'; } catch { return '#'; }
}
export const ageDays = (date, now = Date.now()) => Math.max(0, Math.floor((now - new Date(date).getTime()) / 86400000));
export const median = values => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const isTest = name => /(^|\/)(__tests__|tests?|specs?)(\/|\.)|[._-](test|spec)\.[^/]+$/i.test(name);
export const isSensitive = name => /(^|[\/_.-])(auth(?:entication|orization)?|oauth|crypto|security|permissions?|session|password|token|payment|secrets?|\.env|credentials?)([\/_.-]|$)/i.test(name);
export const isDependency = name => /(^|\/)(package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(?:\.lock)?|pom\.xml|build\.gradle)$/i.test(name);
export const isDoc = name => /\.(md|mdx|rst|txt)$/i.test(name) && !/requirements[^/]*\.txt$/i.test(name) || /(^|\/)docs?\//i.test(name);
export const isCI = name => /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\//i.test(name);
export const isBot = login => /\[bot\]$|^dependabot|^renovate|-bot$/i.test(login || '');

const MAINTAINER_ROLES = ['OWNER', 'MEMBER', 'COLLABORATOR'];
export const authorGroup = assoc => MAINTAINER_ROLES.includes(assoc) ? 'maintainer' : ['FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER'].includes(assoc) ? 'first-time' : 'outside';

// ---------------------------------------------------------------------------
// AI-use wording in contributor text (displayed, never inferred)
export const AI_WORDING = /\b(AI[- ]assist\w*|AI[- ]generat\w*|generated (with|by|using) (an? )?(AI|LLM)|copilot|chatgpt|claude|gemini|cursor|codex|LLM|coding assistant|language model)\b/i;
export const aiLines = body => String(body || '').split('\n').map(l => l.trim()).filter(l => l && AI_WORDING.test(l));

// ---------------------------------------------------------------------------
// Dependency additions (supports human verification of package names
const META_KEYS = new Set(['name', 'version', 'description', 'main', 'module', 'types', 'typings', 'license', 'type', 'node', 'npm', 'pnpm', 'yarn', 'packagemanager', 'homepage', 'private', 'edition', 'authors', 'repository', 'readme', 'rust-version', 'documentation', 'keywords', 'categories', 'publish', 'resolver', 'members', 'python', 'requires-python', 'build-backend', 'packages', 'include', 'exclude', 'path', 'features', 'default', 'optional', 'workspace', 'git', 'branch', 'tag', 'rev']);
const MANIFESTS = [
  { test: /(^|\/)package\.json$/i, ecosystem: 'npm', re: [/^\s*"(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)"\s*:\s*"(?:[~^<>=]|\d|npm:|workspace:|latest|\*|git|https?:)/i], url: n => 'https://www.npmjs.com/package/' + n },
  { test: /(^|\/)requirements[^/]*\.txt$/i, ecosystem: 'PyPI', re: [/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>!~]=?|;|#|$)/], url: n => 'https://pypi.org/project/' + n + '/' },
  { test: /(^|\/)pyproject\.toml$/i, ecosystem: 'PyPI', re: [/^\s*"([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>!~;][^"]*)?"\s*,?\s*$/, /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=\s*["{]/], url: n => 'https://pypi.org/project/' + n + '/' },
  { test: /(^|\/)Cargo\.toml$/i, ecosystem: 'crates.io', re: [/^\s*([a-z0-9_-]+)\s*=\s*["{]/i], url: n => 'https://crates.io/crates/' + n },
  { test: /(^|\/)go\.mod$/i, ecosystem: 'Go', re: [/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/\S+)\s+v\d/i], url: n => 'https://pkg.go.dev/' + n },
  { test: /(^|\/)Gemfile$/, ecosystem: 'RubyGems', re: [/^\s*gem\s+['"]([^'"]+)['"]/], url: n => 'https://rubygems.org/gems/' + n }
];
export function dependencyChanges(files = []) {
  const out = [];
  for (const f of files) {
    const m = MANIFESTS.find(x => x.test.test(f.filename));
    if (!m || !f.patch) continue;
    const pick = sign => {
      const names = new Set();
      for (const line of f.patch.split('\n')) {
        if (!line.startsWith(sign) || line.startsWith(sign.repeat(3))) continue;
        const body = line.slice(1);
        for (const re of m.re) { const r = body.match(re); if (r && !META_KEYS.has(r[1].toLowerCase())) { names.add(r[1]); break; } }
      }
      return names;
    };
    const added = pick('+'), removed = pick('-');
    for (const name of added) out.push({ name, ecosystem: m.ecosystem, file: f.filename, url: m.url(name), change: removed.has(name) ? 'updated' : 'added' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Review signals (explainable, path/metadata-based)
export function analyzePR(pr, detail, docs = []) {
  const findings = [], files = detail?.files || [];
  const add = (kind, title, description, evidence = []) => findings.push({ kind, title, description, evidence });
  if (!detail) {
    if (pr.draft) add('neutral', 'Draft contribution', 'The author has marked this pull request as a draft.');
    if (ageDays(pr.created_at) >= 7) add('attention', 'Waiting at least a week', `Opened ${ageDays(pr.created_at)} days ago. This is age, not a measure of review effort.`);
    return findings;
  }
  const fileEvidence = subset => subset.map(f => ({ label: f.filename, url: f.blob_url || pr.html_url + '/files' }));
  const sensitive = files.filter(f => isSensitive(f.filename));
  if (sensitive.length) add('attention', 'Sensitive paths changed', 'File names suggest authentication, permissions, secrets, or payment behavior. Verify the actual diff; this is a path-based signal.', fileEvidence(sensitive));
  const deps = dependencyChanges(files).filter(d => d.change === 'added');
  if (deps.length) add('attention', 'New dependencies added', `${deps.length} package name(s) appear for the first time in a manifest. Confirm each exists, is the intended package, and is maintained — AI tools can suggest packages that do not exist.`, deps.map(d => ({ label: `${d.name} (${d.ecosystem})`, url: d.url })));
  else if (files.some(f => isDependency(f.filename))) add('attention', 'Dependency manifests changed', 'Inspect the manifest diff for updated dependencies. A changed manifest does not necessarily add a dependency.', fileEvidence(files.filter(f => isDependency(f.filename))));
  const ci = files.filter(f => isCI(f.filename));
  if (ci.length) add('attention', 'CI or workflow configuration changed', 'Workflow changes can alter permissions, secrets exposure, or what gets tested.', fileEvidence(ci));
  const code = files.filter(f => !isDoc(f.filename) && !isDependency(f.filename));
  if (code.length && !files.some(f => isTest(f.filename))) add('question', 'No changed test files identified', 'No file matched common test naming patterns in the loaded diff. Existing tests may cover the change; confirm coverage.', [{ label: 'Inspect changed files', url: pr.html_url + '/files' }]);
  const total = (detail.pr?.additions || 0) + (detail.pr?.deletions || 0);
  if (total > 500 || files.length > 15) add('attention', 'Broad change surface', `${total.toLocaleString()} changed lines across ${detail.pr?.changed_files ?? files.length} files. Consider reviewing by component.`, [{ label: 'Full diff', url: pr.html_url + '/files' }]);
  const checks = detail.checks || [];
  const failed = checks.filter(c => ['failure', 'timed_out', 'cancelled', 'action_required', 'error'].includes(c.conclusion || c.state));
  if (failed.length) add('attention', 'Checks need attention', `${failed.length} loaded check(s) did not succeed. Inspect results before drawing conclusions.`, failed.map(c => ({ label: c.name || c.context, url: c.html_url || c.target_url || pr.html_url + '/checks' })));
  if (detail.checks && !checks.length) add('question', 'Check results unavailable', detail.checkError || 'No check runs or commit statuses were returned. This is not proof that tests passed.');
  if (!findings.length) add('neutral', 'No path-based signals', 'Nothing in file names, size, or checks stood out. Review the diff as usual.');
  return findings;
}

// Risk tier from properties of the change only — never from who authored it.
export function reviewTier(files, checks = []) {
  if (!files) return null;
  const reasons = [];
  if (files.some(f => isSensitive(f.filename))) reasons.push('Sensitive paths');
  if (dependencyChanges(files).some(d => d.change === 'added')) reasons.push('New dependency');
  else if (files.some(f => isDependency(f.filename))) reasons.push('Dependency manifest');
  if (files.some(f => isCI(f.filename))) reasons.push('CI config');
  if (checks.some(c => ['failure', 'timed_out', 'error'].includes(c.conclusion || c.state))) reasons.push('Failing checks');
  const lines = files.reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0);
  if (lines > 500 || files.length > 15) reasons.push('Broad change');
  if (reasons.length) return { tier: 'focus', label: 'Focused review', reasons, rank: 0 };
  if (files.length && files.every(f => isDoc(f.filename))) return { tier: 'light', label: 'Docs only', reasons: ['Documentation files only'], rank: 2 };
  return { tier: 'standard', label: 'Standard', reasons: [], rank: 1 };
}

// ---------------------------------------------------------------------------
// Project rules applied to a PR
const ISSUE_REF = /(^|\s)(#\d+|[\w.-]+\/[\w.-]+#\d+)|github\.com\/[^\s]+\/issues\/\d+|\b(fix(es|ed)?|close[sd]?|resolve[sd]?|refs?)\b/i;
export const RULES = [
  { id: 'tests', name: 'Tests accompany changed behavior', policy: /\b(add|include|write|update|provide)\b[^.\n]{0,50}\btests?\b|\btests?\b[^.\n]{0,40}\b(are )?(required|must|mandatory)\b/i,
    evaluate: (pr, files) => !files.some(f => !isDoc(f.filename) && !isDependency(f.filename)) ? ['na', 'No code files changed.'] : files.some(f => isTest(f.filename)) ? ['found', 'Test files are part of this change.'] : ['missing', 'No changed test files matched. Existing tests may already cover it.'] },
  { id: 'ai', name: 'AI assistance is disclosed', policy: /\b(AI|LLM|copilot|chatgpt|machine[- ]generated|AI[- ]assisted|AI[- ]generated|generative)\b/,
    evaluate: pr => aiLines(pr.body).length ? ['found', 'The description mentions AI use.'] : ['judgment', 'No AI wording in the description. Absence is not evidence either way — ask if unsure.'] },
  { id: 'issue', name: 'Linked to a prior issue or discussion', policy: /\b(open|file|create)\s+(an?\s+)?issue\b[^.\n]{0,60}\b(first|before)\b|\bdiscuss\w*\b[^.\n]{0,60}\b(before|first)\b/i,
    evaluate: pr => ISSUE_REF.test(pr.body || '') ? ['found', 'The description references an issue.'] : ['missing', 'No issue reference found in the description.'] },
  { id: 'changelog', name: 'Changelog or release note updated', policy: /\b(changelog|release notes?|changeset|news entry)\b/i,
    evaluate: (pr, files) => files.some(f => /changelog|(^|\/)changes(\.|\/)|(^|\/)news\/|\.changeset\/|release[-_]notes/i.test(f.filename)) ? ['found', 'A changelog-style file changed.'] : ['missing', 'No changelog-style file in this change. May not apply to internal changes.'] },
  { id: 'docs', name: 'Documentation updated with changes', policy: /\b(update|add)\b[^.\n]{0,30}\b(docs|documentation)\b/i,
    evaluate: (pr, files) => files.some(f => isDoc(f.filename)) ? ['found', 'Documentation files changed.'] : ['judgment', 'No documentation files changed — decide whether user-facing behavior changed.'] },
  { id: 'signoff', name: 'Sign-off / contributor agreement', policy: /\b(DCO|developer certificate of origin|signed-off-by|sign[- ]off|CLA|contributor license agreement)\b/i,
    evaluate: () => ['judgment', 'Commit sign-off is not loaded by OSS Review Steward. Check the commits or the CLA/DCO check.'] }
];
// Prefers sentences over Markdown headings; falls back to a heading if that's all there is.
export function findPolicyLine(docs, re) {
  let heading = null;
  for (const d of docs) {
    const lines = d.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const hit = { doc: d.name, line: i + 1, text: lines[i].replace(/^\s*[-*#>]+\s*/, '').trim(), url: d.url + '#L' + (i + 1) };
      if (!/^\s*#/.test(lines[i])) return hit;
      heading ??= hit;
    }
  }
  return heading;
}
export function applyRules(pr, files = [], docs = []) {
  return RULES.map(r => {
    const source = findPolicyLine(docs, r.policy);
    if (!source) return null;
    const [status, explanation] = r.evaluate(pr, files);
    return { id: r.id, name: r.name, status, explanation, source };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Expectations & gaps
export function extractExpectations(docs) {
  return docs.flatMap(d => d.text.split('\n').map((text, i) => ({ text: text.replace(/^\s*[-*#>]+\s*/, '').trim(), line: i + 1, doc: d.name, url: d.url + '#L' + (i + 1) }))
    .filter(x => x.text.length > 15 && x.text.length < 450 && /\b(must|required|please|should|ensure|need to|do not)\b/i.test(x.text)))
    .map(x => ({ ...x, ai: AI_WORDING.test(x.text) || /\bAI\b/.test(x.text) }))
    .slice(0, 60);
}
const REQ = '\\b(please|could you|can you|need|add|include|provide|require|missing)\\b';
export const GAP_TOPICS = [
  { id: 'tests', name: 'Test coverage', request: new RegExp(REQ + '.*\\b(tests?|coverage)\\b', 'i'), policy: /\b(test|tests|testing|coverage)\b/i, suggestion: 'Describe how you tested your change and add or update tests for changed behavior where appropriate.' },
  { id: 'benchmarks', name: 'Benchmark evidence', request: new RegExp(REQ + '.*\\bbenchmark', 'i'), policy: /benchmark/i, suggestion: 'For performance-related changes, include benchmark results and describe the measurement environment.' },
  { id: 'changelog', name: 'Changelog entry', request: new RegExp(REQ + '.*\\b(changelog|release note)', 'i'), policy: /changelog|release note/i, suggestion: 'For user-visible changes, add a changelog entry describing the impact.' },
  { id: 'reproduction', name: 'Reproduction steps', request: new RegExp(REQ + '.*\\b(reproduc|repro\\b)', 'i'), policy: /reproduc|repro\b/i, suggestion: 'For bug fixes, include a minimal reproduction and explain how the change resolves it.' },
  { id: 'docs', name: 'Documentation updates', request: new RegExp(REQ + '.*\\b(docs|documentation|docstring|readme)\\b', 'i'), policy: /\b(update|add)\b[^.\n]{0,30}\b(docs|documentation)\b/i, suggestion: 'When a change affects user-facing behavior, update the relevant documentation in the same pull request.' },
  { id: 'ai', name: 'AI-use disclosure', request: new RegExp(REQ + '.*\\b(AI|LLM|copilot|chatgpt|generated)\\b', 'i'), policy: /\b(AI|LLM|copilot|generative)\b/, suggestion: 'If you used AI tools, say which parts they helped with and how you verified the result.' }
];
export function detectGaps(comments, docs) {
  const written = docs.map(d => d.text).join('\n');
  return GAP_TOPICS.map(t => {
    const evidence = comments.filter(c => MAINTAINER_ROLES.includes(c.author_association) && t.request.test(c.body || ''));
    const prs = new Set(evidence.map(c => c.pr));
    return { ...t, evidence, prCount: prs.size, documented: t.policy.test(written) };
  }).filter(t => t.prCount >= 2 && !t.documented);
}

// ---------------------------------------------------------------------------
// Governance profile: what is written down vs. what is observable, per dimension.
export const PATTERNS = {
  decisions: /\b(vote|voting|consensus|lazy consensus|steering committee|technical steering|TSC|BDFL|decision[- ]making|decisions are made|RFC process|maintainers? (decide|approve))\b/i,
  maintainership: /\b(become (a |an )?(maintainer|committer|reviewer|core)|maintainer(ship)? (nomination|promotion)|nominat\w+|promot(ed|ion) to|emeritus|commit (access|rights))\b/i,
  aiPolicy: /\b(AI|LLM|large language model|copilot|chatgpt|generative)\b|AI[- ](assisted|generated)|machine[- ]generated/,
  provenance: /\b(DCO|developer certificate of origin|signed-off-by|CLA|contributor license agreement)\b/i,
  external: /\b(SBOM|software bill of materials|cyber resilience act|\bCRA\b|CVE|OpenSSF|scorecard|SLSA|ISO\/IEC|NIST|EU AI Act)\b/i,
  channels: /\b(discord|slack|matrix|zulip|gitter|mailing list|google group|forum|discourse|community (call|meeting)|office hours|github discussions)\b/i,
  roadmap: /\broadmap\b/i
};
const AI_CONTEXT_FILES = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.cursor\/rules|copilot-instructions\.md|\.aiignore|AI[_-]?POLICY\.md|\.windsurfrules)$/i;
const ONBOARDING_LABEL = /good.?first|first.?timers?|beginner|starter|easy|help.?wanted|newcomer/i;
export const cadence = days => days == null ? 'Unknown' : days <= 180 ? 'Updated in the last 6 months' : days <= 400 ? 'Updated in the last year' : 'Not updated in over a year';

export function governanceProfile(data, gov, now = Date.now()) {
  const docs = data.docs || [], files = data.rootFiles || [], pulls = data.pulls || [];
  const has = re => files.find(f => re.test(f));
  const written = re => findPolicyLine(docs, re);
  const ev = s => s ? [{ label: `${s.doc} · line ${s.line}`, url: s.url }] : [];
  const item = (kind, title, status, value, detail, codes, evidence = []) => ({ kind, title, status, value, detail, codes, evidence });
  const dims = { capacity: [], authority: [], compliance: [] };
  const tensions = { capacity: [], authority: [], compliance: [] };

  // --- Capacity --------------------------------------------------------------
  const govDocs = docs.filter(d => !/readme/i.test(d.name));
  const dated = govDocs.map(d => ({ d, days: gov?.docDates?.[d.name] ? ageDays(gov.docDates[d.name], now) : null })).filter(x => x.days != null);
  const stalest = dated.sort((a, b) => b.days - a.days)[0];
  dims.capacity.push(item('written', 'Governance documentation', govDocs.length ? 'found' : 'missing',
    govDocs.length ? `${govDocs.length} document${govDocs.length > 1 ? 's' : ''}` : 'None found',
    govDocs.length ? (stalest ? `Oldest: ${stalest.d.name} — ${cadence(stalest.days).toLowerCase()} (${stalest.days} days).` : 'Update dates not loaded.') : 'No contributing, governance, or security documents in the repository root or .github folder.',
    [], govDocs.slice(0, 4).map(d => ({ label: d.name, url: d.url }))));
  const pushedDays = data.repo?.pushed_at ? ageDays(data.repo.pushed_at, now) : null;
  if (stalest && stalest.days > 400 && pushedDays != null && pushedDays < 30) tensions.capacity.push({ text: `Code is active (last push ${pushedDays === 0 ? 'today' : pushedDays === 1 ? 'yesterday' : pushedDays + ' days ago'}) but ${stalest.d.name} has not changed in over a year. Documentation may trail practice.`, ref: 'Documentation often reflects whatever maintainers had time to write.' });

  const humans = (gov?.contributors || []).filter(c => c.type !== 'Bot' && !isBot(c.login));
  if (humans.length) {
    const total = humans.reduce((n, c) => n + c.contributions, 0);
    let acc = 0, half = 0;
    for (const c of humans) { acc += c.contributions; half++; if (acc >= total / 2) break; }
    const top3 = Math.round(humans.slice(0, 3).reduce((n, c) => n + c.contributions, 0) / Math.max(1, total) * 100);
    dims.capacity.push(item('practiced', 'Commit concentration', 'observed', `${half} ${half === 1 ? 'person' : 'people'} → 50% of commits`,
      `Top 3 accounts made ${top3}% of commits among ${humans.length} listed contributors. A rough bus-factor proxy: commits are not the same as governance or review work.`,
      [], [{ label: 'Contributors graph', url: (data.repo?.html_url || '') + '/graphs/contributors' }]));
    if (half <= 2) tensions.capacity.push({ text: `Half of all commits come from ${half === 1 ? 'one person' : 'two people'}. If they step away, who reviews and releases?`, ref: 'Projects that rely on a few people are vulnerable when those people step away.' });
  } else dims.capacity.push(item('practiced', 'Commit concentration', 'unknown', 'Not loaded', 'Contributor statistics were not available for this repository.', []));

  const ready = pulls.filter(p => !p.draft);
  const waits = ready.map(p => ageDays(p.created_at, now));
  const med = median(waits);
  const old = waits.filter(d => d >= 30).length;
  dims.capacity.push(item('practiced', 'Time waiting for review', ready.length ? 'observed' : 'unknown',
    ready.length ? `Median ${Math.round(med)} days open` : 'No open PRs',
    ready.length ? `${old} of ${ready.length} ready PRs have been open 30+ days. Age reflects many factors, not only reviewer time.` : 'No non-draft pull requests in the loaded queue.', []));
  const unassigned = ready.filter(p => !(p.requested_reviewers || []).length && !(p.requested_teams || []).length).length;
  if (ready.length) dims.capacity.push(item('practiced', 'Reviewer assignment', 'observed', `${Math.round(unassigned / ready.length * 100)}% unassigned`,
    `${unassigned} of ${ready.length} ready PRs have no requested reviewer. Some projects triage without formal assignment.`, []));

  // --- Authority -------------------------------------------------------------
  const decisions = written(PATTERNS.decisions);
  dims.authority.push(item('written', 'How decisions are made', decisions ? 'found' : 'missing', decisions ? 'Described' : 'Not found',
    decisions ? `“${decisions.text.slice(0, 160)}”` : 'No description of voting, consensus, or who decides in loaded documents.', [], ev(decisions)));
  const pathway = written(PATTERNS.maintainership);
  dims.authority.push(item('written', 'Path to maintainership', pathway ? 'found' : 'missing', pathway ? 'Described' : 'Not found',
    pathway ? `“${pathway.text.slice(0, 160)}”` : 'Nothing explains how a contributor gains review or commit rights.', [], ev(pathway)));
  const owners = has(/(^|\/)CODEOWNERS$/i);
  dims.authority.push(item('written', 'Code ownership (CODEOWNERS)', owners ? 'found' : 'missing', owners ? 'Present' : 'Not found',
    owners ? 'Review responsibility is mapped to paths.' : 'No CODEOWNERS file in root, .github, or docs.', []));

  const closed = (gov?.closed || []).filter(p => !isBot(p.user?.login));
  if (closed.length) {
    const groups = { maintainer: [], outside: [], 'first-time': [] };
    for (const p of closed) groups[authorGroup(p.author_association)].push(p);
    const stats = g => {
      const merged = g.filter(p => p.merged_at);
      return { n: g.length, merged: merged.length, rate: g.length ? Math.round(merged.length / g.length * 100) : null, days: median(merged.map(p => (new Date(p.merged_at) - new Date(p.created_at)) / 86400000)) };
    };
    const s = { maintainer: stats(groups.maintainer), outside: stats([...groups.outside, ...groups['first-time']]), first: stats(groups['first-time']) };
    const mergedAll = closed.filter(p => p.merged_at), extShare = mergedAll.length ? Math.round(mergedAll.filter(p => authorGroup(p.author_association) !== 'maintainer').length / mergedAll.length * 100) : null;
    const band = extShare == null ? '' : extShare < 30 ? 'Low' : extShare <= 70 ? 'Medium' : 'High';
    dims.authority.push(item('practiced', 'Merged work from outside the core team', extShare == null ? 'unknown' : 'observed', extShare == null ? 'No merges in sample' : `${extShare}% · ${band}`,
      `Of ${mergedAll.length} merged PRs in the ${closed.length} most recently updated closed PRs. Bands: Low < 30%, Medium 30–70%, High > 70%.`, []));
    const fmt = x => x.n ? `${x.rate}% merged${x.days != null ? `, median ${x.days < 1 ? '<1' : Math.round(x.days)}d` : ''} (n=${x.n})` : 'none in sample';
    dims.authority.push(item('practiced', 'Outcomes by contributor relationship', 'observed', s.maintainer.n && s.outside.n ? `${s.maintainer.rate - s.outside.rate > 0 ? '+' : ''}${s.maintainer.rate - s.outside.rate} pts` : '—',
      `Maintainers/members: ${fmt(s.maintainer)}. Outside contributors: ${fmt(s.outside)}. First-time: ${fmt(s.first)}. Many legitimate reasons affect merges; use this to ask questions, not to judge.`, []));
    if (s.maintainer.n >= 3 && s.outside.n >= 3 && s.maintainer.rate - s.outside.rate >= 30) tensions.authority.push({ text: `Maintainer PRs merge at ${s.maintainer.rate}% versus ${s.outside.rate}% for outside contributors in this sample.${pathway ? '' : ' No path to maintainership is documented.'}`, ref: 'Repeat contributors can get faster, easier merges than newcomers.' });
  } else dims.authority.push(item('practiced', 'Outcomes by contributor relationship', 'unknown', 'Not loaded', 'Closed pull requests were not available.', []));
  if (!decisions && !pathway && (gov?.contributors || []).length > 20) tensions.authority.push({ text: 'Many people contribute, but nothing explains who decides or how to gain responsibility. Participation may not translate into influence.', ref: 'Community input does not always translate into decision-making influence.' });

  // --- Compliance ------------------------------------------------------------
  const lic = data.repo?.license;
  dims.compliance.push(item('written', 'License', lic ? 'found' : 'missing', lic ? (lic.spdx_id && lic.spdx_id !== 'NOASSERTION' ? lic.spdx_id : lic.name || 'Present') : 'Not detected',
    lic ? 'Defines reuse terms that AI-generated contributions must also respect.' : 'GitHub did not detect a license. Without one, reuse terms are unclear.', []));
  const security = has(/(^|\/)SECURITY(\.\w+)?$/i);
  dims.compliance.push(item('written', 'Security reporting policy', security ? 'found' : 'missing', security ? 'Present' : 'Not found',
    security ? 'Vulnerability reports have a documented route.' : 'No SECURITY file. Reporters may disclose publicly by default.', [], security ? docs.filter(d => /security/i.test(d.name)).map(d => ({ label: d.name, url: d.url })) : []));
  const ai = written(PATTERNS.aiPolicy);
  dims.compliance.push(item('written', 'AI contribution policy', ai ? 'found' : 'missing', ai ? 'Mentioned' : 'Not found',
    ai ? `“${ai.text.slice(0, 160)}”` : 'Loaded documents say nothing about AI-assisted contributions. Most projects are inventing these rules now.', [], ev(ai)));
  const ctx = files.filter(f => AI_CONTEXT_FILES.test(f));
  dims.compliance.push(item('written', 'AI assistant context files', ctx.length ? 'found' : 'missing', ctx.length ? ctx.join(', ') : 'None',
    ctx.length ? 'Conventions are communicated directly to coding assistants.' : 'No AGENTS.md, CLAUDE.md, .cursorrules, or copilot-instructions file.', []));
  const prov = written(PATTERNS.provenance);
  dims.compliance.push(item('written', 'Provenance: DCO / CLA', prov ? 'found' : 'missing', prov ? 'Required' : 'Not found',
    prov ? `“${prov.text.slice(0, 160)}”` : 'No sign-off or contributor agreement mentioned.', [], ev(prov)));
  const ext = written(PATTERNS.external);
  dims.compliance.push(item('written', 'External requirements (SBOM, CRA, CVE…)', ext ? 'found' : 'missing', ext ? 'Mentioned' : 'Not found',
    ext ? `“${ext.text.slice(0, 160)}”` : 'No reference to SBOMs, the EU Cyber Resilience Act, CVE handling, or OpenSSF.', [], ev(ext)));
  const disclosed = pulls.filter(p => aiLines(p.body).length).length;
  dims.compliance.push(item('practiced', 'AI use disclosed in open PRs', pulls.length ? 'observed' : 'unknown', pulls.length ? `${disclosed} of ${pulls.length}` : '—',
    'Counts descriptions that mention AI tools. Not a detector: undisclosed use is invisible here.', []));
  if (ai && /\bdisclos|must (state|mention|indicate)|label\b/i.test(ai.text) && pulls.length >= 5 && disclosed === 0) tensions.compliance.push({ text: 'The project asks for AI disclosure, yet no open PR mentions AI use. Either no one uses AI, or the rule is not reaching contributors.', ref: 'Writing a rule down does not by itself show that it is followed.' });
  const template = has(/pull_request_template/i);
  if (template && pulls.length) {
    const thin = pulls.filter(p => (p.body || '').replace(/<!--[\s\S]*?-->/g, '').trim().length < 40).length;
    const pct = Math.round(thin / pulls.length * 100);
    dims.compliance.push(item('practiced', 'PR template followed', 'observed', `${pct}% near-empty`, `${thin} of ${pulls.length} open PR descriptions have under 40 characters after removing template comments.`, []));
    if (pct >= 40) tensions.compliance.push({ text: `A PR template exists, but ${pct}% of open PRs have almost no description. The written process may not be what happens.`, ref: 'Documented rules are not always enforced in practice.' });
  }
  if (!ai && disclosed > 0) tensions.compliance.push({ text: `${disclosed} open PR(s) mention AI use, but no AI policy is written down. Reviewers are deciding case by case.`, ref: 'Without a written policy, AI contributions are handled case by case.' });

  // --- Openness check ------------------------------------------
  const contributing = docs.find(d => /contribut/i.test(d.name)) || (has(/(^|\/)CONTRIBUTING/i) ? { name: has(/(^|\/)CONTRIBUTING/i) } : null);
  const channel = written(PATTERNS.channels);
  const roadmap = written(PATTERNS.roadmap) || (has(/(^|\/)ROADMAP/i) ? { doc: has(/(^|\/)ROADMAP/i) } : null);
  const labels = (gov?.labels || []).filter(l => ONBOARDING_LABEL.test(l));
  const openness = [
    { title: 'How to contribute', ok: !!contributing, detail: contributing ? contributing.name : 'No CONTRIBUTING guide', url: contributing?.url },
    { title: 'How decisions are made', ok: !!decisions, detail: decisions ? decisions.doc : 'Not described', url: decisions?.url },
    { title: 'How to gain responsibility', ok: !!pathway, detail: pathway ? pathway.doc : 'Not described', url: pathway?.url },
    { title: 'Where discussion happens', ok: !!channel || !!data.repo?.has_discussions, detail: channel ? channel.doc : data.repo?.has_discussions ? 'GitHub Discussions enabled' : 'No channel named', url: channel?.url || (data.repo?.has_discussions ? data.repo.html_url + '/discussions' : undefined) },
    { title: 'Public roadmap', ok: !!roadmap, detail: roadmap ? (roadmap.doc || 'Mentioned') : 'Not found', url: roadmap?.url },
    { title: 'Newcomer entry points', ok: labels.length > 0, detail: labels.length ? labels.slice(0, 2).join(', ') : gov ? 'No onboarding labels' : 'Labels not loaded' }
  ];
  return { dims, tensions, openness, sampled: { closed: closed.length, contributors: humans.length } };
}

// ---------------------------------------------------------------------------
// Exports
const PROV_LABELS = {
  disclosure: ['AI assistance', { disclosed: 'Disclosed by contributor', none: 'Contributor states no AI use', unstated: 'Not mentioned', asked: 'Asked contributor' }],
  scope: ['Scope of AI involvement', { most: 'Most of the change', part: 'Part of the change', minor: 'Minor (naming, docs, boilerplate)', unknown: 'Unknown' }],
  verification: ['Human verification described', { yes: 'Yes', partial: 'Partially', no: 'No', unknown: 'Unknown' }],
  licensing: ['Licensing / provenance', { clear: 'No concern observed', followup: 'Needs follow-up', unclear: 'Unclear' }],
  dependencies: ['New dependencies', { verified: 'Verified to exist and be intended', check: 'Need verification', na: 'None added' }]
};
export const provenanceFields = PROV_LABELS;
export function handoffMarkdown(repo, pr, detail, note, checks, provenance = {}, rules = []) {
  const prov = Object.entries(PROV_LABELS).map(([k, [label, opts]]) => `- ${label}: ${opts[provenance[k]] || 'Not recorded'}`).join('\n');
  const deps = detail ? dependencyChanges(detail.files).filter(d => d.change === 'added') : [];
  const statusWord = { found: 'Evidence found', missing: 'Not found in PR', judgment: 'Needs judgment', na: 'Not applicable' };
  return `# Review handoff: ${repo} #${pr.number}

${pr.title}
${pr.html_url}

## Reviewer checklist
${Object.entries(checks || {}).map(([label, done]) => `- [${done ? 'x' : ' '}] ${label}`).join('\n')}

## Notes and next action
${note || 'No notes recorded.'}

## AI-use & provenance record
${prov}
${provenance.notes ? '\nProvenance notes: ' + provenance.notes + '\n' : ''}
${rules.length ? `## Project rules applied\n${rules.map(r => `- ${r.name}: ${statusWord[r.status]} — ${r.explanation} (source: ${r.source.doc} line ${r.source.line})`).join('\n')}\n` : ''}${deps.length ? `\n## New dependencies to verify\n${deps.map(d => `- ${d.name} (${d.ecosystem}) — ${d.url}`).join('\n')}\n` : ''}
## Evidence coverage
${detail ? `${detail.files.length} changed files loaded; ${(detail.checks || []).length} checks/statuses loaded.` : 'Detailed evidence not loaded.'}

Generated by OSS Review Steward. Human-authored notes; automated signals require review and are not verdicts.
`;
}

export function profileMarkdown(repo, profile, loadedAt) {
  const icon = { found: '✔', missing: '✘', observed: '•', unknown: '?' };
  const dim = (name, key) => `## ${name}

### Written down
${profile.dims[key].filter(i => i.kind === 'written').map(i => `- ${icon[i.status]} **${i.title}** — ${i.value}. ${i.detail}`).join('\n')}

### Observed in practice
${profile.dims[key].filter(i => i.kind === 'practiced').map(i => `- ${icon[i.status]} **${i.title}** — ${i.value}. ${i.detail}`).join('\n')}
${profile.tensions[key].length ? `\n### Worth discussing\n${profile.tensions[key].map(t => `- ${t.text} (${t.ref})`).join('\n')}\n` : ''}`;
  return `# Governance profile: ${repo}

Generated ${new Date(loadedAt || Date.now()).toLocaleString()} by OSS Review Steward.
Dimensions: capacity, authority, compliance. Interpretive signals, not a score or audit.

## Is participation documented? (Openness check)
${profile.openness.map(o => `- [${o.ok ? 'x' : ' '}] ${o.title} — ${o.detail}`).join('\n')}

${dim('Capacity', 'capacity')}
${dim('Authority', 'authority')}
${dim('Compliance', 'compliance')}
## Suggested use
Bring this to a maintainer meeting or governance review. Decide together which differences matter for this project; many are deliberate.

Sample: ${profile.sampled.closed} recently closed PRs, ${profile.sampled.contributors} listed contributors.
`;
}

// ---------------------------------------------------------------------------
// Governance toolkit templates
export function template(kind, o = {}) {
  const project = o.project || 'this project';
  const gaps = (o.confirmedGaps || []);
  if (kind === 'ai-policy') {
    const stance = {
      disclose: `We welcome contributions made with the help of AI tools, provided you disclose that use and take full responsibility for the result.`,
      limited: `AI tools may be used for limited assistance (e.g., autocomplete, wording, boilerplate). Substantial AI-generated code is not accepted unless discussed with maintainers first.`,
      none: `We do not currently accept contributions that were substantially generated by AI tools. Minor assistance (e.g., autocomplete) does not need to be disclosed.`
    }[o.stance || 'disclose'];
    return `# AI-assisted contributions

${stance}

## What we ask of you
- **Disclose** AI use in the pull request description: which tool, and which parts of the change it helped with.
${o.verify !== false ? '- **Verify** every line you submit. Describe how you tested the change; “the AI said it works” is not verification.\n' : ''}${o.licensing !== false ? '- **Respect licenses.** Do not submit output that reproduces code you cannot license under this project’s terms. Rewriting licensed code with an AI tool does not remove its original obligations.\n' : ''}${o.deps !== false ? '- **Check dependencies.** Confirm any newly added package exists, is the one you intended, and is actively maintained. AI tools sometimes suggest packages that do not exist.\n' : ''}- **Stay accountable.** You must be able to explain and maintain the change. Reviewers may ask questions about any part of it.

## How maintainers review
Disclosure is not a penalty. Reviewers use it to decide where to look closely. Contributions are judged on what they change, not on who wrote them or which tools were used.

## Why this exists
${project} has limited review capacity. Clear expectations help reviewers spend time where it matters and help newcomers know what is expected before they start.

_Last reviewed: ${new Date().toISOString().slice(0, 10)}. We will revisit this policy as practice and standards evolve._
`;
  }
  if (kind === 'pr-template') {
    const extra = gaps.map(g => `- [ ] ${g.suggestion}`).join('\n');
    return `## What does this change?
<!-- A short summary and the motivation. Link the related issue: Fixes #123 -->

## How was it tested?
<!-- Commands you ran, cases you checked, screenshots if relevant -->

## Checklist
- [ ] I have read the contributing guide
- [ ] Tests cover the changed behavior (or I explained why not)
${extra ? extra + '\n' : ''}
## AI-use record
<!-- Disclosure helps reviewers focus. It is not a penalty. -->
- AI tools used: <!-- none / name the tool(s) -->
- Parts of this change they helped with: <!-- e.g. tests only, initial draft of X -->
- How I verified the AI-assisted parts: <!-- ran tests, read every line, compared with docs -->
- New dependencies, if any, confirmed to exist and be intended: <!-- yes / not applicable -->
- I can license this contribution under the project license: <!-- yes -->
`;
  }
  if (kind === 'governance') {
    const model = {
      council: ['A group of maintainers (listed in MAINTAINERS.md) makes decisions by lazy consensus: a proposal passes if no maintainer objects within 7 days. If there is an objection, maintainers vote and a simple majority decides.', 'Contributors who have made sustained, high-quality contributions for about three months can be nominated by any maintainer. Existing maintainers approve by majority vote.'],
      bdfl: [`The project lead has final say on direction and disputes. Day-to-day decisions are made by maintainers in pull requests and issues. The lead commits to explaining significant decisions publicly.`, 'The project lead appoints maintainers, usually from contributors who have shown sustained, careful review work. Anyone may ask the lead what they would need to do to get there.'],
      doocracy: ['Whoever does the work makes the decision for that area (“do-ocracy”). Large or cross-cutting changes must be proposed in a public issue for at least one week first. Anyone who takes ownership of an area is responsible for it until they hand it off publicly.', 'Taking ownership of an area — reviewing, fixing, and answering questions about it over time — earns commit access. Ask in an issue when you are ready.'],
      steering: ['A steering committee (listed below) sets direction, approves releases, and resolves disputes. Technical decisions are delegated to maintainers of each component. Committee meetings are public and minuted.', 'Maintainers are nominated by existing maintainers and confirmed by the steering committee. Steering seats are elected by maintainers each year, with no single organization holding a majority.']
    }[o.model || 'council'];
    return `# Governance of ${project}

This document explains how decisions are made and how you can take part. Being public is not the same as being open; we want both.

## Who makes decisions
${model[0]}

## How to propose a change
1. Open an issue describing the problem and your proposed approach.
2. Discuss it publicly. Maintainers aim to respond within two weeks.
3. Decisions and their rationale are recorded in the issue.

## How to gain responsibility
${model[1]}

## Where discussion happens
- Issues and pull requests on GitHub
- <!-- add your chat, forum, or mailing list -->

## Roadmap
<!-- link a public roadmap, milestone, or project board -->

## Changing this document
Changes to governance follow the same decision process and stay open for at least 14 days.

_Last reviewed: ${new Date().toISOString().slice(0, 10)}. We revisit governance when the project’s size or contributors change._
`;
  }
  if (kind === 'agents') {
    return `# AGENTS.md — guidance for AI coding assistants

This file tells AI tools how ${project} works. Contributors remain responsible for every change.

## Project conventions
- Follow the existing code style; run the formatter and linter before committing.
- Add or update tests for any change in behavior.
- Keep changes focused; one concern per pull request.
${gaps.map(g => '- ' + g.suggestion).join('\n')}${gaps.length ? '\n' : ''}
## Do not
- Add new dependencies without saying so explicitly in the PR description.
- Invent package names, APIs, or configuration options. If unsure, ask.
- Copy code from other projects unless its license is compatible with this project’s license.
- Modify CI workflows, security-sensitive code, or release configuration unless asked.

## Before opening a pull request
- Fill in the AI-use record in the pull request template.
- Describe how the change was verified.
`;
  }
  if (kind === 'policy-card') {
    const rules = [
      ['ai-disclosure', 'AI assistance is disclosed in the PR description', 'pr.body', 'mentions_ai_or_states_none', 'ask'],
      ['tests', 'Code changes include or reference tests', 'pr.files', 'has_test_files_when_code_changes', 'ask'],
      ['new-dependencies', 'Newly added packages are verified by a human', 'pr.files', 'lists_added_dependencies', 'flag-for-review'],
      ['sensitive-paths', 'Changes to auth, secrets, or CI get a second reviewer', 'pr.files', 'matches_sensitive_paths', 'request-review'],
      ...gaps.map(g => [g.id, g.name, 'pr', 'reviewer_confirms', 'ask'])
    ];
    return `# Policy card for ${project}
# Machine-readable review expectations .
# Every rule produces a prompt for a human — never an automatic rejection.
version: 1
project: ${JSON.stringify(project)}
principles:
  - Flag properties of the change, never the reputation of the contributor.
  - A flag is a question for a reviewer, not a violation.
rules:
${rules.map(([id, desc, scope, check, action]) => `  - id: ${id}
    description: ${JSON.stringify(desc)}
    scope: ${scope}
    check: ${check}
    on_missing: ${action}`).join('\n')}
`;
  }
  return '';
}
