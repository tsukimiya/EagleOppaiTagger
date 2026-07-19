# Component catalog

Copy-paste snippets for building the report inside `template.html`. All styling
is already defined in the template's `<style>` — these are just the markup
patterns. Use the **Visual decision guide** in SKILL.md to choose which to reach
for; don't use a component just because it exists.

## Table of contents

One link per major section. The `href` must match the `id` of the `<section>`.
Use `class="sub"` for nested sub-sections.

```html
<li><a href="#requirements">Requirements</a></li>
<li><a href="#req-auth" class="sub">Authentication</a></li>
```

## Section + gist

Every major section opens with a one/two-sentence "gist" so the reader gets the
point before the detail. This is summarization, not decoration — write the gist
in your own words from understanding the section.

```html
<section id="requirements">
  <h2>Requirements</h2>
  <p class="section-gist">Functional requirements for the checkout flow, grouped by
     priority. Normative keywords are preserved from the source.</p>
  ...
</section>
```

## Summary cards

A row of headline facts at the top of the report (or a section). Pull the 3–6
most orienting numbers/facts. If the spec has no natural metrics, use key facts
(e.g. "Target platform", "Auth method") rather than inventing numbers.

```html
<div class="cards">
  <div class="card">
    <div class="label">Requirements</div>
    <div class="value">24</div>
    <div class="sub">12 Must · 8 Should · 4 Could</div>
  </div>
  <div class="card">
    <div class="label">Target release</div>
    <div class="value">v2.0</div>
    <div class="sub">Q3 2026</div>
  </div>
</div>
```

## Badges

Inline pills for priority, status, type, or provenance. Available classes:
`must`, `should`, `could`, `info`, `infer`, `warn`.

```html
<span class="badge must">MUST</span>
<span class="badge should">SHOULD</span>
<span class="badge could">COULD</span>
<span class="badge info">v2 only</span>
<span class="badge infer">Inferred</span>     <!-- use whenever YOU added/derived this -->
<span class="badge warn">At risk</span>
```

Keep the source's normative keyword text exact — if the spec says "SHALL", the
badge text should read `SHALL`, not `MUST`.

## Requirements table

The workhorse for requirements. Put the priority badge in its own column so the
reader can scan priorities down the page.

```html
<table>
  <thead><tr><th>ID</th><th>Priority</th><th>Requirement</th><th>Notes</th></tr></thead>
  <tbody>
    <tr>
      <td class="mono">REQ-01</td>
      <td><span class="badge must">MUST</span></td>
      <td>The system <strong>MUST</strong> reject expired tokens with <code>401</code>.</td>
      <td>—</td>
    </tr>
    <tr>
      <td class="mono">REQ-07</td>
      <td><span class="badge could">COULD</span></td>
      <td>Users <strong>MAY</strong> enable dark mode.</td>
      <td><span class="badge infer">Inferred</span> from UX notes</td>
    </tr>
  </tbody>
</table>
```

## Callouts

For a critical constraint, gotcha, or design principle that would be lost in a
table or paragraph. Three flavors: `note` (FYI), `warning` (caution), `important`
(hard constraint / blocker).

```html
<div class="callout important">
  <p class="ttl">⛔ Hard constraint</p>
  <p>All PII <strong>MUST</strong> be encrypted at rest. This is a launch blocker.</p>
</div>

<div class="callout warning">
  <p class="ttl">⚠ Watch out</p>
  <p>The legacy <code>/v1/login</code> endpoint stays live during migration.</p>
</div>

<div class="callout note">
  <p class="ttl">ℹ Note</p>
  <p>Rate limits are defined per-tenant, not per-user.</p>
</div>
```

## Glossary grid

For domain terms. Cards read better than a long definition list.

```html
<dl class="glossary">
  <div class="term"><dt>Tenant</dt><dd>An isolated customer organization with its own data scope.</dd></div>
  <div class="term"><dt>Idempotency key</dt><dd>Client-supplied token making a retried request safe to replay.</dd></div>
</dl>
```

## Diagrams (Mermaid)

Wrap every diagram in `.diagram` so it gets the panel styling, a zoom hint, and
click-to-zoom. Add a `.cap` caption. Match the diagram type to the content using
the decision guide.

```html
<div class="diagram">
  <span class="zoom-hint">click to zoom</span>
  <div class="mermaid">
flowchart TD
    A[User submits order] --> B{Payment valid?}
    B -- yes --> C[Create order]
    B -- no  --> D[Return 402]
    C --> E[Send confirmation]
  </div>
  <div class="cap">Figure 1 — Checkout happy path</div>
</div>
```

Diagram-type starters:

```
sequenceDiagram
    participant C as Client
    participant API
    participant DB
    C->>API: POST /orders
    API->>DB: INSERT order
    DB-->>API: ok
    API-->>C: 201 Created
```

```
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    USER { string id string email }
```

```
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: submit
    Submitted --> Approved: approve
    Submitted --> Rejected: reject
    Approved --> [*]
```

**Mermaid hygiene:** keep node labels short; if a label contains `()`, `:`,
`{}`, or quotes, wrap it in double quotes (e.g. `A["GET /users (paged)"]`). Split
oversized diagrams into a few focused ones rather than one unreadable mega-graph.

## Open Questions

Where ambiguity goes — never guess inline and never silently drop a
contradiction. Each item should point at what's unclear and, where useful, why it
matters.

```html
<section id="open-questions">
  <h2>Open Questions</h2>
  <p class="section-gist">Unresolved or contradictory points found in the source.</p>
  <ul>
    <li><strong>Token TTL:</strong> §3.2 says 15 min, §6 says 1 hour — which governs?</li>
    <li><strong>Offline mode:</strong> mentioned in the intro but never specified. Out of scope for v2?</li>
  </ul>
</section>
```

## Traceability appendix

The trust anchor: map each report section back to where it came from in the
source, so a reader can verify nothing was fabricated or relocated misleadingly.

```html
<section id="traceability">
  <h2>Traceability</h2>
  <p class="section-gist">Where each section of this report came from in the source.</p>
  <table>
    <thead><tr><th>Report section</th><th>Source</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td>Requirements</td><td>spec.md §3–§5</td><td>Re-grouped by priority</td></tr>
      <tr><td>Checkout flow diagram</td><td>spec.md §4.2 prose</td><td><span class="badge infer">Inferred</span> from step list</td></tr>
      <tr><td>Open Questions</td><td>various</td><td>Flagged by this report, not the source</td></tr>
    </tbody>
  </table>
</section>
```
