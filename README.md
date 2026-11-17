# OSS Review Steward

A tool that helps open source maintainers review pull requests and see how their project is actually run.

It only reads from GitHub. It never comments, approves, merges, or changes anything.

## Quick start

You need Node.js 20.11 or newer. Nothing else to install.

    npm start

On Windows you can also double-click `Start-OSS-Review-Steward.cmd`.

Open http://127.0.0.1:4173. A demo project loads first so you can try everything. To use a real project, click **Connect repository** and paste a GitHub link.

## What it does

**Pull request review**
- A review queue you can search, filter, and sort.
- Highlights changes that need a closer look, such as changes to sensitive files, new dependencies, or failing checks. It looks only at the change, never at who wrote it.
- Checks each PR against the project's own written rules (tests, changelog, AI disclosure, and so on).
- Lists newly added packages so you can confirm they are real.
- A handoff checklist and an AI-use record you can export as Markdown.

**Project governance**
- Compares what the project's documents say with what happens in practice: who does the work, who makes decisions, and how rules like licensing and security are followed.
- Checks whether a newcomer can find out how to contribute and how decisions are made.
- Finds requests maintainers make often but haven't written down.
- Starter templates: an AI contribution policy, a PR template, GOVERNANCE.md, and AGENTS.md.

## Good to know

- Public repositories work without signing in, within GitHub's limit of 60 requests per hour. For private repositories or more requests, add a GitHub token in **Settings**. The token is kept in memory only and never saved.
- Your notes are stored in your browser. You can export or clear them in Settings.
- All signals are simple rules, not AI. They are prompts for a person to check, not verdicts.
- This is a research prototype and hasn't been formally evaluated yet. See [EVALUATION.md](EVALUATION.md).

## Development

    npm test         # run tests
    npm run check    # check syntax
