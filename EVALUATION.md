# Evaluation plan

## Questions
1. Does evidence-linked review context help maintainers understand a contribution and identify missing evidence without adding to review burden?
2. Does a written-vs-practiced governance profile help maintainers notice and discuss governance gaps they consider meaningful?
3. Do structured AI-use/provenance records make reviewers more confident about provenance without discouraging disclosure?

## Review study
Use a counterbalanced within-participant comparison of native GitHub review and OSS Review Steward on comparable PR tasks. Recruit maintainers from projects of different sizes and with different levels of review experience. Use public or consented data, give practice tasks before timing, and keep realistic tasks separate from the fictional demo.

Measure:
- Time to locate relevant project expectations.
- Correctness of evidence interpretation.
- Unresolved questions identified.
- Time spent investigating false positives, including review-focus flags and dependency checks.
- Perceived workload (e.g. NASA-TLX).

Record whether participants distinguish automated signals from verified problems. Do not treat task speed as a measure of review quality.

## Governance profile study
Ask maintainers to review their own project's profile while thinking aloud. For each "worth discussing" item, record whether they consider it accurate, deliberate, or worth acting on. At a 4–6 week check-in, note which items led to concrete follow-up, such as adopting a toolkit template.

## Expectation-gap and toolkit study
Have maintainers inspect sampled suggestions independently, decide whether the requests really recur and apply, and mark each one as documented, context-specific, or incorrect. Measure:
- Accepted and rejected suggestions.
- Missing source context.
- Time spent.

Review any resulting documentation proposal or template before adoption. If projects adopt changes, follow up on contributor clarification requests and on how complete PR descriptions are.

## Fairness and accessibility
- Include PRs from both newcomers and repeat contributors, and verify that review-focus ordering is independent of who wrote the PR.
- Evaluate keyboard navigation, screen-reader labels, text-size settings, and mobile access.
- Check that missing-data labels are understandable, and that requests for additional evidence don't put an undue burden on newcomers.

## Boundaries
- No causal claims before evaluation.
- No universal governance score.
- Any participant study must follow the institution's ethics review and consent process.
