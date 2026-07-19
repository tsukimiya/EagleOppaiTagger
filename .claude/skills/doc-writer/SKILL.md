---
name: doc-writer
description: Write or update project documentation (Decision Records and ARCHITECTURE.md). Use when requests involve "create DR", "create ADR", "record decision", "write ARCHITECTURE.md", "update architecture doc", "document design decisions", or equivalent requests to summarize prior discussion into a decision record. Also triggers on requests to summarize architecture, reflect decision changes into documentation, describe the overall project structure, or when code changes warrant updating architectural documentation. Use this skill even when the user doesn't explicitly mention "DR" or "ARCHITECTURE.md" — any request about recording why a technical choice was made or capturing the current system design should use this skill.
user-invocable: true
---

# Document Writer

Create Decision Records (DR) and update ARCHITECTURE.md. DR is essentially synonymous with ADR (Architecture Decision Record) — no distinction is made.

## Document Map

```
CLAUDE.md                    -- Architecture Overview, Core Principles
docs/ARCHITECTURE.md         -- Detailed architecture document
docs/decisions/
  yyyy-mm-dd-slug.md         -- Decision Records (DR)
```

- Keep `CLAUDE.md` Architecture Overview and Core Principles consistent with ARCHITECTURE.md

## Routing

Execute one of the following based on the request:

1. **Create/edit a DR** → Follow the "Decision Record Writing" section
2. **Create/update ARCHITECTURE.md** → Follow the "Architecture Document Writing" section

## Decision Record Writing

### Naming

- Filename: `yyyy-mm-dd-slug.md` (date is the creation date)
- Location: `docs/decisions/`

### Title

Use `# Title` format. Preserve existing `# ADR NNNN:` titles as historical records.

### Template

When creating a new DR, read `references/decision-record-template.md` with the Read tool and follow its structure.

### Writing Guidelines

- Context and Decision are written by the user. Only the user can accurately describe their decision-making context and judgment — ask for these sections' content and compose the DR from their answers
- Write Decision in active voice with "We will ..." statements
- Consequences should cover positive, negative, and neutral outcomes — a consequence often becomes Context for a future DR
- Cross-link related existing DRs in the Notes section
- Write section headings in English (Status, Context, Decision, Consequences, Notes)

## Architecture Document Writing

ARCHITECTURE.md is a document written for humans, not AI agents (CLAUDE.md serves that role):

- Helps new developers and maintainers understand the system's design intent without reading every source file
- Documents core architectural concepts that reviewers rely on when evaluating whether a change aligns with the system's design direction

Analyze DRs and the codebase to create or update ARCHITECTURE.md.

### Instructions

1. Examine the package structure under `packages/`, package.json dependencies, and main entry points
2. Examine `.github/workflows/` to understand where and how each package runs
3. Read all DRs under `docs/decisions/`
4. Create or update ARCHITECTURE.md following the guidelines below

### Source Priority

Follow **codebase > DR > existing ARCHITECTURE.md** priority. Code is the single source of truth — DRs record intent but implementation may lag behind, so trust sources in this order. If a DR is accepted but not yet reflected in code, describe the current code state. Only reflect DR content to the extent it is implemented in code.

### Updating

Broad but shallow coverage has no value — the user selects which items to focus on. Present proposed changes to the user and apply only after approval.

After updating ARCHITECTURE.md, check whether `CLAUDE.md` Architecture Overview and Core Principles need updates, and propose them if so.

### What to Include

Record the knowledge a human needs to understand this system — the design intent, the reasoning behind structural choices, and the mental model that makes the codebase navigable. A new developer reading ARCHITECTURE.md should come away understanding why the system is shaped this way, not just what exists.

- Text-based overview diagram (execution environments and data flow)
- Design principles and how they are concretized in each component
- Package collaboration structure and dependency rules centered on core types
- Where each package runs and how it connects to others
- Technology selection rationale (only when significant context exists, such as cost, constraints, or bug avoidance)

### Prohibited

- Direct code (command examples, schema definitions, function signatures, etc.). Sample JSON is allowed (see "Exceptions" below)
- Facts obvious from reading code (CLI flags, API endpoint lists, etc.) or enumerations of each package's implementation details
- Inventing names that don't exist in the codebase
- Describing historical changes ("originally X, then changed to Y"). Change history belongs in DRs — write only the current state and intent
- Meta-descriptions of the document's own purpose
- Operational details (schedule frequencies, CI/CD configuration values, etc.) — these change frequently and become stale

### Style

- Write declaratively, not in Q&A format. State the current state in each section with intent woven in naturally
- Keep it simple. Avoid verbose explanations
- Write for a human reader — use natural narrative flow, not bullet-point checklists optimized for machine parsing

### Examples

**Bad — stating what's obvious from code:**
cli-fetch-rss is a package that fetches RSS feeds, accepts a group argument,
loads a list of corresponding feed URLs, and fetches them in parallel.

**Good — design intent not readable from code:**
Feed fetching and AI processing are separated into different packages so that
expensive AI processing can be skipped for quick debugging.

**Bad — historical narrative:**
Originally called the Claude API directly, then migrated to Agent SDK.

**Good — current intent only:**
AI processing uses Agent SDK. By providing tools to agents, they can fetch
external information as needed to make decisions.

### Format

When creating or significantly revising ARCHITECTURE.md, read `references/architecture-template.md` with the Read tool and follow its structure. The format is inspired by [esbuild's architecture.md](https://github.com/evanw/esbuild/blob/main/docs/architecture.md).

- **Leading comment**: Always include an HTML comment at the very top of the file (before the table of contents) stating that this document is for human readers and directing AI agents to also read the Decision Records under `docs/decisions/`

  ```html
  <!--
    This document is written for human readers.
    If you are an AI agent, also read the Decision Records under docs/decisions/.
  -->
  ```
- **Table of contents**: Place a nested bulleted list below the leading comment (before the title). Each item is an anchor link to a section heading
- **Design principles**: Use `* **Principle Name**` + indented paragraph (not `**Name**: description` inline format)
- **Section headings**: Write in English
- **Overview diagram**: Text-based ASCII diagram. Do not use Japanese inside boxes (monospace fonts misalign). Do not include specific configuration values like cron frequencies

### Exceptions

The following are allowed as exceptions to the "don't write details" principle in Prohibited:

- **Sample JSON** illustrating a data shape, when the shape itself is central to understanding how components collaborate. Keep it minimal — a few representative fields with placeholder values, not the full schema
- **Text-based overview diagrams** (required by "What to Include") and the leading HTML comment (required by "Format")

## User Prompt

$ARGUMENTS