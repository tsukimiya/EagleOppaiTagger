---
name: spec-to-readable-html
description: >-
  Converts dense specifications — PRDs, design docs, requirement docs, RFCs,
  API specs, or messy mixed-format spec text — into a single self-contained,
  human-readable HTML report with a dark theme, a sticky table of contents,
  summary cards, Mermaid diagrams, priority/status badges, callouts, and a
  source-traceability appendix. Use this whenever the user wants to make a long
  or hard-to-read spec "readable", "skimmable", or "reviewable", asks to turn a
  spec/PRD/design doc/requirements into an HTML report or visual document, or
  hands over a wall-of-text spec and wants the structure, priorities, and flows
  surfaced. Trigger even when the user says "HTML version of this doc",
  "visualize this spec", "make this PRD easier to read", or just shares a long
  spec file and asks to "clean it up" — not only when they literally say
  "spec-to-readable-html". Do NOT use for slide decks (.pptx), Word docs, or
  generic web pages unrelated to specifications.
---

# Spec → Readable HTML

## What this skill is for

Specs are written to be *complete*, not to be *read*. A PRD or design doc piles
background, requirements, non-functional constraints, and edge cases into a flat
wall of Markdown. The information is all there, but a reader can't see the shape
of it: what's the overall flow? what's actually required vs. nice-to-have? where
do the open questions live?

This skill re-expresses that same content as an HTML report whose **form makes
the content legible**. Nothing is invented and nothing required is dropped — the
job is to *restructure, summarize, and visualize* so a human actually wants to
read it. The insight (from "The Unreasonable Effectiveness of HTML") is that HTML
gives you diagrams, color-coded emphasis, in-page navigation, and layout that
Markdown can't — so use them.

The output is **one self-contained `.html` file** the user can open in a browser.
Mermaid is loaded from a CDN so diagrams render richly (and zoom) when online.

## This is analysis, not conversion

The single most important thing: **do not do a mechanical Markdown→HTML
pass.** A heading-for-heading transliteration is worthless — the user could get
that from any converter. Your value is reading the whole spec, understanding it,
and deciding how to present it so the structure and priorities pop.

That means you will routinely:

- **Summarize** — open each major section with a 1–2 sentence "what this is
  about" so the reader gets the gist before the detail.
- **Re-group** — collect scattered requirements into coherent sections; pull
  Must/Should/Could priorities out of prose into badges and tables.
- **Visualize** — turn described processes, system interactions, data models,
  and lifecycles into Mermaid diagrams (see the decision guide below).
- **Surface the skeleton** — lead with a summary-card row of the headline
  numbers/facts so the reader orients in seconds.

## Fidelity rules (this is the trust contract)

A spec report is only useful if the reader can trust it reflects the source. So:

- **Never alter normative keywords or identifiers.** Keep MUST / SHOULD / SHALL
  / MAY exactly as written. Keep API paths, field names, error codes, enum
  values, and config keys byte-for-byte. These are the load-bearing parts of a
  spec; paraphrasing them silently corrupts it.
- **Label anything you add.** If you infer a flow, fill a gap, or restructure in
  a way that adds meaning not literally in the source, mark it `Inferred` or
  `Assumption` (there's a badge for this). The reader must be able to tell your
  interpretation from the author's words.
- **Don't resolve ambiguity — quarantine it.** When the spec is unclear,
  contradictory, or silent on something important, do not guess and bury it.
  Collect these into an **Open Questions** section so they're visible, not lost.
- **Don't drop required content.** Summarizing the framing is good; deleting a
  requirement because it was buried is not. Every normative statement in the
  source should be findable in the report.

## Output language

Match the language of the **source spec** by default — a Japanese spec produces a
Japanese report, an English spec an English report. Keep code, identifiers, and
normative keywords in their original form regardless. If the user explicitly asks
for a specific output language ("出力は英語で" / "make the report Japanese"),
honor that override and translate the prose while still preserving identifiers
and normative keywords verbatim.

## Workflow

1. **Read the entire spec first.** Don't start emitting HTML until you've read
   the whole thing and understand the shape. If it's multiple files or a folder,
   read them all.
2. **Plan the structure.** Decide the section order (often: Summary → Background
   → Requirements → Architecture/Flows → Data → Non-functional → Open Questions →
   Traceability). Decide which content becomes a diagram, which becomes a table,
   which becomes badges. Identify the 3–6 headline facts for summary cards.
3. **Read the template and component guide.** Load `references/template.html`
   (the dark-theme skeleton with all CSS + JS wired up) and
   `references/components.md` (copy-paste snippets and when to use each). Build
   the report by filling the template, not by writing CSS from scratch — the
   template guarantees a consistent, polished dark look.
4. **Build diagrams deliberately** using the decision guide below. Keep each
   diagram focused; if a flow is huge, split it.
5. **Write the report**, applying the fidelity rules throughout. Add the
   traceability appendix mapping each report section back to where it came from
   in the source.
6. **Sanity-check before finishing**: open the file (or read it back) and verify
   the HTML is well-formed, the TOC links resolve, Mermaid blocks are valid, and
   no normative keyword or identifier was mangled. Save it next to the source (or
   wherever the user asked) with a clear name like `<spec-name>.report.html`.

## Visual decision guide

Pick the representation that matches the *kind* of content. Don't diagram for the
sake of it — a diagram that just restates a 3-item list is noise.

| Content in the spec | Best representation |
|---|---|
| A step-by-step process or workflow | Mermaid **flowchart** (`flowchart TD`) |
| Calls/messages between systems or services over time | Mermaid **sequence diagram** |
| Entities and their relationships / a data model | Mermaid **ER diagram** |
| A status or object lifecycle (states + transitions) | Mermaid **state diagram** |
| Requirements with Must/Should/Could priority | Table + priority **badges** |
| Headline metrics, counts, key facts | **Summary cards** at the top |
| Domain terms / glossary | **Glossary grid** (definition cards) |
| A critical constraint, gotcha, or design principle | **Callout** box (note/warning/important) |
| Mapping (e.g. requirement → component, field → type) | **Structured table** |
| Anything you inferred or any unresolved point | **Inferred badge** / **Open Questions** section |

## Anti-patterns to avoid

- A 1:1 Markdown transliteration with no summaries, diagrams, or badges.
- Diagrams that just rephrase a short list — only diagram genuine structure.
- Inventing requirements, numbers, or flows to "fill out" the report. If it's not
  in the source and not clearly labeled as inferred, it doesn't go in.
- Paraphrasing API paths, field names, error codes, or MUST/SHALL keywords.
- Burying contradictions instead of putting them in Open Questions.
- Hand-rolling CSS instead of using the provided template.

## Resources

- `references/template.html` — the dark-theme HTML skeleton. All CSS, the sticky
  TOC behavior, Mermaid init, and click-to-zoom for diagrams are already wired
  in. Start here and fill the content regions.
- `references/components.md` — a catalog of ready-to-use snippets (summary cards,
  badges, callouts, glossary grid, tables, diagram blocks, traceability table)
  with guidance on when to reach for each.
