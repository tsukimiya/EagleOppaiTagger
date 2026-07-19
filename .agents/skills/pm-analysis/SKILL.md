---
name: pm-analysis
description: >
  Product manager analysis of GitHub milestones and open issues — release planning, milestone triage,
  issue prioritization, and roadmap health checks. Use this when the user asks to analyze milestones,
  review the project roadmap, prioritize open issues, plan a release, assess what belongs in each
  milestone, or evaluate release ordering. Triggers on phrases like "analyze our milestones",
  "PM analysis", "release planning", "triage issues", "what should go in next release",
  "milestone review", "is our roadmap coherent", "help me prioritize issues", or any request for a
  product management perspective on a GitHub project. Also use when the user wants to know if a
  milestone is too full, too thin, or out of order relative to other milestones.
---

# PM Analysis

Analyze a GitHub repository's milestones and open issues from a product manager perspective:
evaluate coherence, size, ordering, and release readiness — then propose concrete improvements.

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
gh api "repos/$REPO/milestones?state=open&per_page=100"
gh api "repos/$REPO/milestones?state=closed&per_page=20" --jq '.[] | "\(.number) \(.title)"'
```

## Step 2: Analyze each milestone

For each open milestone, evaluate these four dimensions:

- **Theme coherence** — Do the issues tell a single story, or is this a grab bag?
  A well-scoped milestone has a one-sentence theme you could say in a standup.
- **Size** — Overloaded (> 6 issues) or too thin (< 2 issues)? Both are warning signs.
- **Cross-milestone dependencies** — Are there issues that block others in a *different* milestone?
  If issue A depends on issue B but they live in separate milestones, that's a scheduling risk.
- **Unassigned issues** — List open issues with no milestone. These are planning debt.

## Step 3: Evaluate release ordering

Apply these PM principles in priority order when assessing whether milestones are sequenced well:

1. **Trust before integration** — Users must trust the core product before connecting it to other
   systems. Don't ship integrations before the foundation is solid.
2. **Control before automation** — Give users visibility and manual control before adding
   automation. Users shouldn't have to trust a black box.
3. **Bugs before features** — Ship fixes first. Bug debt that carries across milestones erodes
   user trust and credibility.
4. **Coherent narrative per release** — Each release should have a one-sentence theme.
   If you can't summarize the milestone in a sentence, it likely needs splitting.
5. **Minimize WIP** — Prefer fewer, focused milestones over many scattered ones.
   More than 4–5 active milestones is usually a signal that planning has fragmented.

> For technical health (tech debt, refactoring, architecture decisions), use the `cto-analysis` skill instead.

## Step 4: Present findings

Structure your output in four sections:

### Current State
Table: `Milestone | Issues | Theme (your one-sentence read) | Health`

### Issues Found
Concrete, specific problems — incoherence, overloaded milestones, ordering violations,
unassigned issues, cross-milestone blockers. Be direct; vague observations aren't actionable.

### Proposed Reorganization
Table: `Milestone → Revised Theme → Issues to move in/out → Rationale`

### Recommended Actions
Ordered list of specific steps, highest impact first. Include the exact `gh` commands
the user would need to execute each one.

## Step 5: Execute (with confirmation)

**Always ask before making any changes.** Do not move issues or modify milestones without
explicit user approval.

Once approved, use:

```bash
# Move an issue to a different milestone
gh api repos/$REPO/issues/$ISSUE_NUMBER -X PATCH -f milestone=$MILESTONE_NUMBER

# Remove a milestone from an issue
gh api repos/$REPO/issues/$ISSUE_NUMBER -X PATCH -f milestone=

# Update a milestone's title or description
gh api repos/$REPO/milestones/$MILESTONE_NUMBER -X PATCH \
  -f title="New title" \
  -f description="One-sentence theme"

# Close a milestone
gh api repos/$REPO/milestones/$MILESTONE_NUMBER -X PATCH -f state=closed
```

When executing a batch of changes, confirm once for the whole batch rather than asking
for each individual change — users find per-change confirmation tedious.
