# Design Doc: Payments Service v2

Status: Draft · Author: platform-team · Last updated: 2026-04-30

## Overview

The Payments Service v2 replaces the monolithic `billing` module with a
standalone service that handles charge authorization, capture, refunds, and
idempotent retries. This document specifies the data model, the
charge/authorize/capture flow, the failure handling, and the public API.

## Goals & non-goals

Goals:
- A charge MUST be idempotent: replaying the same `Idempotency-Key` MUST return
  the original result, never double-charge.
- Authorization and capture MUST be separable (auth-now, capture-later).
- Refunds (full and partial) MUST be supported.

Non-goals:
- Subscriptions / recurring billing (handled by `billing-recurring`, out of scope).
- Multi-currency conversion (assume a single settlement currency per merchant).

## Data model

Entities:
- A **Merchant** has many **Payment Methods** and many **Charges**.
- A **Charge** belongs to one Merchant and one Payment Method, and has many
  **Refunds**.
- A **Charge** moves through states: `created → authorized → captured → settled`,
  with `failed` and `voided` as terminal off-ramps. A `captured` charge may go to
  `refunded` (fully) or `partially_refunded`.
- Each **Refund** belongs to one Charge and carries an amount and a reason code.

Key fields on Charge: `id`, `merchant_id`, `amount_minor` (integer, minor units),
`currency`, `status`, `idempotency_key`, `provider_ref`, `created_at`.

## Charge flow

When a client calls `POST /v2/charges` with an `Idempotency-Key` header:

1. The API gateway authenticates the merchant and forwards to the Charge Service.
2. The Charge Service looks up the idempotency key. If a prior charge exists for
   that key, it returns the stored result immediately (no provider call).
3. Otherwise it persists a `created` Charge, then calls the Provider Adapter to
   authorize against the upstream PSP (e.g. Stripe).
4. The PSP responds with an authorization. On success the Charge becomes
   `authorized` and a `provider_ref` is stored. On decline it becomes `failed`.
5. If `capture=true` was requested, the service immediately calls capture and the
   Charge becomes `captured`. Otherwise it stays `authorized` until a later
   `POST /v2/charges/{id}/capture`.
6. The result is returned to the client; webhooks are emitted asynchronously.

## Failure handling

- Provider timeouts: retry up to 3 times with exponential backoff. The
  idempotency key passed to the PSP MUST be stable across retries so the PSP
  dedupes.
- If all retries fail, the Charge is marked `failed` and an alert is raised.
- Partial captures are NOT supported in v2 (capture is all-or-nothing). This is a
  known limitation; see Open Items.

## Public API

| Method | Path | Purpose |
|---|---|---|
| POST | `/v2/charges` | Create (and optionally capture) a charge |
| POST | `/v2/charges/{id}/capture` | Capture a previously authorized charge |
| POST | `/v2/charges/{id}/refunds` | Refund (full or partial) |
| GET  | `/v2/charges/{id}` | Fetch a charge |

Error codes: `400` (validation), `401` (auth), `402` (payment declined), `409`
(idempotency conflict — same key, different payload), `422` (unprocessable),
`502` (provider error).

## Open items

- SLA for capture-later: how long can an authorization stay open before it
  expires? Not yet decided.
- Should partial capture be added in v2.1? TBD.
