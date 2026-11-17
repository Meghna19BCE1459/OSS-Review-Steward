// Fictional demonstration data. Not derived from any real project.
const ago = d => new Date(Date.now() - d * 86400000).toISOString();
const base = 'https://github.com/example/atlas';

// [number, title, author, association, daysOpen, labels, files, additions, deletions, body]
const rows = [
  [248, 'Fix session refresh after token rotation', 'maya-dev', 'CONTRIBUTOR', 12, ['security', 'bug'], ['src/auth/session.ts', 'src/auth/token.ts', 'package.json'], 187, 42,
    'This change refreshes expired sessions after token rotation.\n\nFixes #231\n\nTesting: manually verified sign-in and token rotation locally.\n\nAI assistance: used a coding assistant for the initial implementation; I reviewed and rewrote the retry logic.'],
  [247, 'Add cursor pagination to the search endpoint', 'alex-chen', 'MEMBER', 3, ['enhancement'], ['src/search/pagination.ts', 'tests/search.test.ts', 'docs/api.md', 'CHANGELOG.md'], 242, 18,
    '## Summary\nAdds cursor-based pagination to /search.\n\nCloses #219\n\n## Verification\nNew unit tests cover empty, single-page, and multi-page results.'],
  [245, 'Improve cache lookup performance', 'sam-rivera', 'CONTRIBUTOR', 34, ['performance'], ['src/cache/store.ts', 'src/cache/index.ts'], 116, 57,
    '## Summary\nAvoids a second map lookup on cache hits.\n\nLocal benchmark: ~12% faster on the hot path.'],
  [243, 'Document local development setup', 'jules-code', 'FIRST_TIME_CONTRIBUTOR', 2, ['documentation'], ['CONTRIBUTING.md', 'docs/development.md'], 68, 11,
    'First contribution! I got stuck setting up the dev environment so I wrote down what worked.'],
  [241, 'Update dependency lockfile', 'dependabot[bot]', 'NONE', 6, ['dependencies'], ['package.json', 'pnpm-lock.yaml'], 410, 386,
    'Bumps typescript from 5.4.2 to 5.5.4.'],
  [239, 'Add keyboard navigation to command menu', 'nora-k', 'CONTRIBUTOR', 41, ['accessibility'], ['src/ui/menu.ts', 'src/ui/menu.css', 'tests/menu.test.ts'], 306, 64,
    'Arrow keys move between items; Enter selects; Escape closes.\n\nRefs #188'],
  [238, 'Explore streaming response support', 'leo-builds', 'FIRST_TIME_CONTRIBUTOR', 1, ['enhancement'], ['src/api/stream.ts', '.github/workflows/ci.yml'], 92, 4,
    'WIP'],
  [236, 'Add rate-limit middleware', 'priya-s', 'CONTRIBUTOR', 19, ['enhancement'], ['src/api/ratelimit.ts', 'src/api/index.ts', 'package.json'], 141, 9,
    'Adds a token-bucket rate limiter to the public API.\n\nThis was written with Copilot and checked against the existing middleware tests.']
];
const patches = {
  248: { 'package.json': '@@ -18,6 +18,7 @@\n   "dependencies": {\n     "jose": "^5.2.0",\n+    "jwt-session-refresh": "^1.0.3",\n     "zod": "^3.23.0"\n   }' },
  241: { 'package.json': '@@ -30,7 +30,7 @@\n   "devDependencies": {\n-    "typescript": "^5.4.2",\n+    "typescript": "^5.5.4",\n     "vitest": "^1.6.0"\n   }' },
  236: { 'package.json': '@@ -18,6 +18,7 @@\n   "dependencies": {\n     "jose": "^5.2.0",\n+    "express-rate-limit": "^7.4.0",\n     "zod": "^3.23.0"\n   }' },
  238: { '.github/workflows/ci.yml': '@@ -4,6 +4,8 @@\n permissions:\n-  contents: read\n+  contents: write\n+  id-token: write\n jobs:' }
};
const defaultPatch = name => name.endsWith('.md') ? '@@ -1,2 +1,3 @@\n # Development\n+Run the test suite before submitting a change.'
  : '@@ -20,3 +20,5 @@\n export function handleRequest(context) {\n-  return resolve(context);\n+  const result = resolve(context);\n+  return validate(result);\n }';

const docs = [
  { name: 'CONTRIBUTING.md', url: base + '/blob/main/CONTRIBUTING.md', text: '# Contributing to Atlas\n\nThanks for your interest in Atlas!\n\nPlease open an issue before proposing a large change.\nAll contributions must follow the code of conduct.\nPlease add tests for new behavior.\nChanges should be reviewed by a maintainer before merging.\n\n## AI-assisted contributions\n\nAI-assisted contributions must disclose assistance in the PR description.\n\n## Getting help\n\nAsk questions in our Discord server or open a GitHub discussion.' },
  { name: 'GOVERNANCE.md', url: base + '/blob/main/GOVERNANCE.md', text: '# Governance\n\nDecisions are made by the core maintainers.\nMaintainers are responsible for release decisions.\nContributors should discuss architectural changes in public issues.\nDecisions must include a short rationale.' },
  { name: '.github/pull_request_template.md', url: base + '/blob/main/.github/pull_request_template.md', text: '## Summary\n<!-- What does this change and why? -->\n\n## Testing\n<!-- How did you verify it? -->' },
  { name: 'SECURITY.md', url: base + '/blob/main/SECURITY.md', text: '# Security\n\nPlease report vulnerabilities privately to the security team.\nWe follow coordinated disclosure and request CVE identifiers for confirmed issues.' }
];

export function demoData() {
  return {
    repo: { full_name: 'example/atlas', description: 'A fictional developer platform for exploring the OSS Review Steward workflow.', html_url: base, stargazers_count: 2840, language: 'TypeScript', private: false, license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' }, has_discussions: true, pushed_at: ago(1) },
    pulls: rows.map((r, i) => ({ number: r[0], title: r[1], user: { login: r[2] }, author_association: r[3], created_at: ago(r[4]), updated_at: ago(Math.min(r[4], 2)), labels: r[5].map(name => ({ name })), html_url: base + '/pull/' + r[0], draft: r[0] === 238, requested_reviewers: i === 0 ? [{ login: 'you' }] : i === 1 ? [{ login: 'elena-maintainer' }] : [], body: r[9] })),
    docs,
    rootFiles: ['README.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'SECURITY.md', 'LICENSE', 'package.json', '.github/', '.github/pull_request_template.md', '.github/workflows/', 'docs/'],
    warnings: [], queueTruncated: false, loadedAt: new Date().toISOString()
  };
}

export function demoDetail(number) {
  const data = demoData(), pr = data.pulls.find(p => p.number === number), row = rows.find(r => r[0] === number);
  const files = row[6].map(filename => ({ filename, status: filename === 'CHANGELOG.md' || filename.startsWith('tests/') ? 'added' : 'modified', additions: Math.round(row[7] / row[6].length), deletions: Math.round(row[8] / row[6].length), blob_url: base + '/blob/demo/' + filename, patch: patches[number]?.[filename] || defaultPatch(filename) }));
  return {
    pr: { ...pr, additions: row[7], deletions: row[8], changed_files: row[6].length, head: { sha: 'demo' }, mergeable_state: 'unknown' },
    files,
    checks: [{ name: 'Unit tests', status: 'completed', conclusion: number === 248 ? 'failure' : 'success', html_url: pr.html_url + '/checks' }, { name: 'Type check', status: 'completed', conclusion: 'success', html_url: pr.html_url + '/checks' }],
    reviews: number === 248 ? [{ id: 1, user: { login: 'elena-maintainer' }, state: 'CHANGES_REQUESTED', body: 'Please add a regression test for expired sessions. Also — I can’t find jwt-session-refresh on npm’s trending list; can you confirm it’s the package you meant?', html_url: pr.html_url + '#review-1', submitted_at: ago(2) }] : [],
    comments: [],
    discussion: [{ id: 5, user: { login: pr.user.login }, body: 'Ready for feedback. Happy to add more context where needed.', html_url: pr.html_url + '#issuecomment-5', created_at: ago(1) }],
    warnings: [], checkError: ''
  };
}

export function demoFiles(number) { return demoDetail(number).files; }

export function demoGovernance() {
  const people = [['elena-maintainer', 812], ['owen', 655], ['alex-chen', 201], ['maya-dev', 64], ['nora-k', 41], ['sam-rivera', 33], ['priya-s', 22], ['dependabot[bot]', 140], ...Array.from({ length: 30 }, (_, i) => ['contributor-' + (i + 1), Math.max(1, 18 - i)])];
  const closed = [];
  const add = (n, assoc, merged, days) => closed.push({ number: n, user: { login: assoc === 'MEMBER' ? 'owen' : 'someone-' + n }, author_association: assoc, created_at: ago(days + 30), merged_at: merged ? ago(30) : null, closed_at: ago(30) });
  for (let i = 0; i < 14; i++) add(200 - i, i % 2 ? 'MEMBER' : 'OWNER', i !== 5, 1 + (i % 3));
  for (let i = 0; i < 12; i++) add(180 - i, 'CONTRIBUTOR', i % 2 === 0, 9 + i);
  for (let i = 0; i < 6; i++) add(160 - i, 'FIRST_TIME_CONTRIBUTOR', i === 0, 21);
  return {
    contributors: people.map(([login, contributions]) => ({ login, contributions, type: login.endsWith('[bot]') ? 'Bot' : 'User' })),
    closed,
    labels: ['bug', 'enhancement', 'documentation', 'security', 'good first issue', 'help wanted'],
    docDates: { 'CONTRIBUTING.md': ago(520), 'GOVERNANCE.md': ago(610), 'SECURITY.md': ago(95), '.github/pull_request_template.md': ago(300) },
    warnings: [], loadedAt: new Date().toISOString()
  };
}

export function demoSample() {
  const c = (pr, body, assoc, login) => ({ pr, body, author_association: assoc, user: { login }, html_url: base + '/pull/' + pr + '#discussion_r' + pr });
  return {
    count: 10, warnings: [],
    comments: [
      c(230, 'Could you include benchmark results for the cache change?', 'MEMBER', 'elena-maintainer'),
      c(225, 'Please add benchmarks comparing the old and new implementation.', 'OWNER', 'owen'),
      c(221, 'Please provide benchmark numbers before we proceed.', 'MEMBER', 'elena-maintainer'),
      c(219, 'Can you add a changelog entry for this? Users will notice.', 'MEMBER', 'elena-maintainer'),
      c(214, 'Please add a line to the changelog under Unreleased.', 'OWNER', 'owen'),
      c(212, 'Nice work — looks good to me.', 'MEMBER', 'elena-maintainer')
    ]
  };
}
