---
name: cto-analysis
description: >
  CTO-level technical health review of a GitHub repository — tech debt assessment, architecture
  risk analysis, bug health, documentation gaps, and refactoring priorities. Use this when the
  user asks about technical health, code quality, tech debt, refactoring backlog, architecture
  risks, dependency concerns, documentation coverage, or bug accumulation. Triggers on phrases
  like "CTO analysis", "technical health", "how bad is our tech debt", "what should we refactor",
  "architecture review", "are we accumulating too much debt", "review our bugs", "dependency risk",
  "docs coverage", or any request for a technical leadership perspective on a codebase's health.
  Do NOT use for product prioritization, milestone planning, or release ordering — use pm-analysis
  for those.
---

# CTO Analysis

Analyze a GitHub repository's technical health from a CTO perspective: tech debt, architecture
risks, bug posture, documentation gaps, and refactoring priorities — then present concrete
recommendations.

## Setup

Determine the target repo:
- If the user specified a repo (e.g., `owner/repo`), use it.
- Otherwise infer from the current git context:
  ```bash
  git remote get-url origin
  ```
  Parse `owner/repo` from the URL (handles both HTTPS and SSH formats).

## Step 1: Gather current state

Run these in parallel:

```bash
gh issue list --repo $REPO --state open --json number,title,milestone,labels,createdAt --limit 200
gh issue list --repo $REPO --state open --label bug --json number,title,milestone,createdAt --limit 100
gh issue list --repo $REPO --state open --search "refactor OR tech-debt OR deprecat" --json number,title,milestone,labels,createdAt --limit 100
git log --oneline -30
```

## Step 2: Tech debt assessment

- **Debt accumulation** — How many refactor/tech-debt/deprecation issues exist? Absolute count and
  as a percentage of all open issues.
- **Debt distribution** — Is it concentrated in one area (e.g., one module, one subsystem) or
  spread across the codebase? Concentrated debt is easier to address.
- **Debt age** — Oldest refactor issues. Stale debt (> 60 days with no milestone) signals
  active avoidance — a cultural problem, not just a technical one.
- **Debt-to-feature ratio per milestone** — > 30% per milestone = the team is already behind.

## Step 3: Architecture risk analysis

- **Breaking changes queued** — API changes, schema migrations, deprecations. Are they grouped
  together or scattered across releases? Scattered breaking changes are painful for consumers.
- **Cross-cutting concerns** — Issues touching multiple modules simultaneously. These are the
  highest-risk items because they require coordination and are frequently underscoped.
- **Dependency risks** — Supply chain issues, pinned versions that lag behind security patches,
  known CVEs. Flag any deps that look like they were frozen after an incident.

## Step 4: Documentation health

- **Doc-feature gap** — Features shipped recently that have no corresponding doc issue closed.
  Features without docs are half-shipped.
- **Stale doc issues** — `docs:` labeled issues older than 30 days. Signals docs are treated as
  optional rather than part of the definition of done.
- **API documentation** — Are public APIs documented? Are breaking changes communicated ahead of
  time with migration guides?
- **Onboarding path** — Could a new contributor get started from the docs alone, without
  asking a teammate? If not, knowledge is a bottleneck.

## Step 5: Bug health

- **Bug velocity** — Are bugs being closed faster than they're opened? If not, the backlog is
  growing and will eventually dominate the roadmap.
- **Bug age** — Any chronic bugs (> 30 days open, still unassigned or unmilestoned)? These are
  decisions being deferred, not forgotten.
- **Bugs without milestones** — Each unmilestoned bug is a triage gap. They should be either
  scheduled, closed as wontfix, or downgraded to enhancement.

## Step 6: Apply CTO principles

Evaluate findings against these principles in order:

1. **Debt compounds** — 3+ refactor issues without a milestone = schedule a debt sprint. Debt
   without a paydown plan grows at compound interest.
2. **Breaking changes need coordination** — Group into a single release with migration guides.
   Spreading breaking changes across releases multiplies consumer pain.
3. **Chronic bugs erode trust** — Any bug > 30 days old needs a decision: fix it, close it as
   wontfix, or explicitly downgrade. Silence is not a strategy.
4. **Docs are part of the product** — A feature without docs doesn't exist for most users.
   Doc debt is product debt.
5. **Architecture before features** — If cross-cutting concerns are piling up, consider pausing
   feature work until the architectural foundation is stable.
6. **Dependencies are liabilities** — Flag any CVEs or incident-pinned deps. Each pinned dep is
   a future emergency waiting to be scheduled.

## Step 7: Present findings

Structure your output in five sections:

### Technical Health Summary
Overall rating (Healthy / Needs Attention / At Risk), with a one-paragraph justification.
Key metrics: debt count, debt-to-feature ratio, bug count, chronic bug count.

### Tech Debt Inventory
Table: `Issue # | Title | Area | Age | Milestone | Priority`
Sort by age descending (oldest first = highest risk).

### Documentation Health
Brief assessment with specific gaps called out by name, not vague summaries.

### Architecture Risks
List of specific risks with severity (High / Medium / Low) and recommended action.

### Recommendations
Ordered list of specific, actionable steps — highest leverage first. Include the exact
commands or issues a team would need to act on each recommendation.

## Step 8: Cross-reference with PM view

If `pm-analysis` was also run in this session, cross-reference:
- Are milestones balanced between feature work and debt paydown?
- Is the release order sustainable from a technical perspective, or is debt about to block
  a planned feature release?
- Flag any milestone where debt-to-feature ratio > 30% — that milestone is at delivery risk.

## Important

Analysis only — do NOT modify issues, close milestones, or make any changes without
explicit user approval.
