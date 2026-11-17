import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepository, dependencyChanges, reviewTier, applyRules, detectGaps, governanceProfile, profileMarkdown, handoffMarkdown, template, aiLines, isDoc, escapeHTML } from '../dist/core.js';
import { demoData, demoDetail, demoGovernance, demoSample } from '../dist/demo.js';

test('parseRepository accepts URLs, deep links, and owner/repo', () => {
  assert.equal(parseRepository('pallets/flask'), 'pallets/flask');
  assert.equal(parseRepository('https://github.com/pallets/flask.git'), 'pallets/flask');
  assert.equal(parseRepository('https://github.com/pallets/flask/pulls'), 'pallets/flask');
  assert.throws(() => parseRepository('https://gitlab.com/a/b'));
  assert.throws(() => parseRepository('nonsense'));
});

test('escapeHTML escapes markup', () => assert.equal(escapeHTML('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;'));
test('requirements.txt is not treated as documentation', () => { assert.equal(isDoc('requirements-dev.txt'), false); assert.equal(isDoc('docs/a.py'), true); });

test('dependencyChanges distinguishes added from updated packages', () => {
  const files = [
    { filename: 'package.json', patch: '@@\n   "dependencies": {\n+    "left-pad": "^1.3.0",\n-    "zod": "^3.0.0",\n+    "zod": "^3.23.0",\n+  "version": "2.0.0",\n   }' },
    { filename: 'requirements.txt', patch: '@@\n+requests==2.32.0\n+numpy>=1.26\n' },
    { filename: 'go.mod', patch: '@@\n+\tgithub.com/spf13/cobra v1.8.0\n' }
  ];
  const deps = dependencyChanges(files);
  const by = Object.fromEntries(deps.map(d => [d.name, d]));
  assert.equal(by['left-pad'].change, 'added');
  assert.equal(by['zod'].change, 'updated');
  assert.equal(by['version'], undefined);
  assert.equal(by['requests'].ecosystem, 'PyPI');
  assert.ok(by['numpy']);
  assert.equal(by['github.com/spf13/cobra'].url, 'https://pkg.go.dev/github.com/spf13/cobra');
});

test('reviewTier uses change properties only', () => {
  assert.equal(reviewTier([{ filename: 'docs/a.md', additions: 3, deletions: 1 }]).tier, 'light');
  assert.equal(reviewTier([{ filename: 'src/auth/login.ts', additions: 3 }]).tier, 'focus');
  assert.equal(reviewTier([{ filename: 'src/x.ts', additions: 3 }]).tier, 'standard');
  assert.ok(reviewTier([{ filename: '.github/workflows/ci.yml' }]).reasons.includes('CI config'));
  assert.equal(reviewTier(undefined), null);
});

test('applyRules only checks rules the project has written', () => {
  const d = demoData(), pr = d.pulls.find(p => p.number === 248), detail = demoDetail(248);
  const rules = applyRules(pr, detail.files, d.docs);
  const ids = rules.map(r => r.id);
  assert.ok(ids.includes('tests') && ids.includes('ai') && ids.includes('issue'));
  assert.ok(!ids.includes('changelog'));
  assert.equal(rules.find(r => r.id === 'ai').status, 'found');
  assert.equal(rules.find(r => r.id === 'tests').status, 'missing');
  assert.equal(rules.find(r => r.id === 'issue').status, 'found');
  assert.deepEqual(applyRules(pr, detail.files, []), []);
});

test('aiLines finds disclosure wording without matching unrelated words', () => {
  assert.equal(aiLines('Used Copilot for tests').length, 1);
  assert.equal(aiLines('Fixes a maintainer email typo').length, 0);
});

test('detectGaps requires two PRs and absence from docs', () => {
  const d = demoData(), gaps = detectGaps(demoSample().comments, d.docs);
  assert.deepEqual(gaps.map(g => g.id).sort(), ['benchmarks', 'changelog']);
});

test('governanceProfile surfaces written vs practiced items and tensions for the demo', () => {
  const prof = governanceProfile(demoData(), demoGovernance());
  for (const k of ['capacity', 'authority', 'compliance']) {
    assert.ok(prof.dims[k].some(i => i.kind === 'written'), k + ' written');
    assert.ok(prof.dims[k].some(i => i.kind === 'practiced'), k + ' practiced');
  }
  assert.ok(prof.tensions.capacity.length >= 1);
  assert.ok(prof.tensions.authority.length >= 1);
  const open = Object.fromEntries(prof.openness.map(o => [o.title, o.ok]));
  assert.equal(open['How to contribute'], true);
  assert.equal(open['How to gain responsibility'], false);
  assert.equal(open['Newcomer entry points'], true);
  assert.match(profileMarkdown('example/atlas', prof), /## Capacity[\s\S]*### Observed in practice/);
});

test('governanceProfile tolerates missing governance data', () => {
  const prof = governanceProfile({ repo: { full_name: 'a/b' }, docs: [], pulls: [], rootFiles: [] }, null);
  assert.ok(prof.dims.capacity.length && prof.dims.authority.length && prof.dims.compliance.length);
});

test('handoff includes provenance and rules', () => {
  const d = demoData(), pr = d.pulls[0], detail = demoDetail(pr.number);
  const md = handoffMarkdown('example/atlas', pr, detail, 'note', { 'Inspected': true }, { disclosure: 'disclosed' }, applyRules(pr, detail.files, d.docs));
  assert.match(md, /AI assistance: Disclosed by contributor/);
  assert.match(md, /Project rules applied/);
  assert.match(md, /jwt-session-refresh/);
});

test('templates render and include confirmed gaps', () => {
  const gaps = [{ id: 'changelog', name: 'Changelog entry', suggestion: 'Add a changelog entry.' }];
  for (const k of ['ai-policy', 'pr-template', 'governance', 'agents', 'policy-card']) assert.ok(template(k, { project: 'x', confirmedGaps: gaps }).length > 100, k);
  assert.match(template('pr-template', { confirmedGaps: gaps }), /Add a changelog entry/);
  assert.match(template('policy-card', { confirmedGaps: gaps }), /id: changelog/);
  assert.match(template('ai-policy', { stance: 'none' }), /do not currently accept/);
});
