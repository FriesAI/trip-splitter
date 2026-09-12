# Trip Splitter

A group travel expense splitter for trips where **almost nothing is split evenly**.

Built for a 12-person trip across London, Iceland and Paris (22 Nov – 6 Dec 2026),
but designed to handle any trip: the data model is multi-trip from the start.

## Why not just use Splitwise

The trip this was designed for has **six distinct participant sets across 16
booked line items** — the hotels are all 12 people, the Akureyri flight is 10,
the second Iceland car is 8, the long-haul flight is 7, the London apartment is
6. "Split equally among everyone" is wrong for every single row.

Splitwise and Settle Up both treat subset splitting as a per-expense chore, so
people stop doing it and the numbers drift. Here, named participant subsets
(**squads**) and couples (**households**) are first-class objects, seeded once
and then chosen with a single tap.

## What it does

- **Arbitrary participant subsets** per expense, saved and reusable
- **Split by couple** — divides among wallets rather than heads
- **Continuous netting** — owe someone RM 100, pay RM 50 split two ways, and the
  figure becomes RM 75 immediately, with the arithmetic always one tap away
- **Receipt OCR** — photograph a receipt, get a filled form, with the currency
  detected and the FX rate looked up for the receipt's own date
- **Multi-currency** with rates frozen at entry, so balances never drift
- **Offline-first PWA** — built for Icelandic dead zones; OCR never blocks logging
- **Simplified settle-up** — minimum-cash-flow reduction across the whole group
- **Smart suggestions** — who probably paid, how it's probably split, and a nudge
  when one person is carrying the group

## Status

**Specification stage.** No application code yet.

- [`docs/SPEC.md`](docs/SPEC.md) — the full build spec (read this first)
- [`docs/spec.html`](docs/spec.html) — the same spec as a standalone page

The spec defines 45 requirements with stable IDs (`EXP-01`, `NET-01`, `SMT-03`
…), so commits and issues can cite them directly.

## Getting started

Nothing to install yet. When Phase 1 begins:

```bash
cp .env.example .env    # then fill in your own credentials
npm install
npm run dev
```

## Build order

Phases are defined in [§13 of the spec](docs/SPEC.md#13-phases). The first one
matters most:

1. **Money engine, headless** — integer arithmetic, all four split modes
   including households, pairwise netting, balance computation, settlement
   minimisation. Unit-tested against real figures *before any UI exists*.
   If the maths is wrong, nothing else matters.

## Non-negotiables

- **Money is integers.** Minor units (sen, pence, aurar) everywhere, including
  JSON on the wire. No floats, at any layer. See §6.
- **`sum(splits) == expense.amount`** for every expense, in every split mode.
  And `sum(all member balances) == 0`. These are the first two tests written.
- **Rates freeze on save.** Never recalculated, or everyone's balance drifts daily.
- **ISK has zero decimal places.** A generic ×100 is wrong by a factor of a hundred.
- **No credentials in the repo.** Everything comes from the environment;
  `.env.example` documents every variable with placeholders.
- **Receipts are private.** Private storage bucket only, never a public URL —
  a receipt can carry a card's last four digits.

## Open questions

Six of them, in [§14](docs/SPEC.md#14-open-questions). The blocking one:
**who paid each of the booked items?** The original planning sheet records who
*owes* but never who *paid*, so no balance is computable until that is answered.
