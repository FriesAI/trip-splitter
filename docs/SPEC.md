# Euro Trip Splitter — Build Spec v2

An expense splitter for a 12-person trip across London, Iceland and Paris
(22 Nov – 6 Dec), where almost nothing is split twelve ways. It nets debts as
they accrue, reads receipts from a photo, and guesses who paid before you tell
it.

Scoped against the existing *Euro Trip* Google Sheet and Drive voucher folder.

- 12 travellers, 15 days, 4 currencies
- 16 booked line items, 13 priced, ~RM 116,823 committed pre-departure
- Settlement currency: MYR

> Figures below are read from the Euro Trip sheet as of 2026-09-09 and are
> unverified against the WhatsApp group. See §13 Open questions.

---

## 1. The real problem

Splitwise and Settle Up assume a stable group whose default split is
"everyone, equally". For this trip that default is wrong for **every single
booked line item**. Six distinct participant sets already exist before anyone
has bought a coffee:

| Participant set | Items | People |
|---|---|---|
| Hotels D1–D9, Blue Lagoon, main car rental | 10 | 12 |
| Akureyri domestic flight, 1 Dec | 1 | 10 (not Stephenie Lee, Steven) |
| Second Iceland car, 1–3 Dec | 1 | 8 |
| Long-haul KUL→LDN→ICE→PARIS→KUL | 1 | 7 |
| London Aparthotel, 22–25 Nov | 1 | 6 |
| Paris: Airbnb, Disneyland, 5–6 Dec hotel | 3 | unknown / unpriced |

Members: Teoh Siew Chin, Tan Chin Yong, Lim Thye Wei, Chan Yong Hoay,
Stephenie Lee, Steven, Yap Sin Yin, Kok Khong Ming, Dexter Lee Jia Chuen,
Joel Goh Zong Yao, Chua Chung Li, Ling Chui Yung.

### Two gaps in the current sheet

1. **No payer.** The matrix records who *owes* but never who *paid*. The Drive
   folder shows at least four different accounts uploading vouchers, so it was
   not one person fronting everything. Balances cannot be computed until this
   is captured.
2. **Hidden decimals.** Each displayed per-person total is one sen below the sum
   of that person's displayed line items (Chan Yong Hoay foots to 11,931.77;
   the cell reads 11,931.76). The offset is consistent across all twelve rows,
   so it is hidden decimals in a shared column rather than a typo — but it is
   exactly how a spreadsheet quietly loses money, and the reason §6 forbids
   floats.

### Three jobs the app must do

| Job | Today | In the app |
|---|---|---|
| Prepaid bookings | Sheet matrix, no payer | Seeded once via import, payer attached, frozen |
| On-trip spending | Nothing — WhatsApp messages | Photograph the receipt, or log it in seconds offline |
| Settling up | Manual, after the fact | Continuously netted, then a minimised transfer list |

---

## 2. Scope and non-goals

**In scope.** Expense capture with arbitrary participant subsets; receipt OCR
with automatic currency and rate lookup; continuous netting of debts; smart
payer and split suggestions; multiple trips; multi-currency with frozen rates;
balances and simplified settle-up; offline-first PWA; voucher shelf mirroring
the Drive folder; import of the existing sheet; WhatsApp-shaped sharing.

**Explicit non-goals.**

| Not doing | Why |
|---|---|
| In-app payments / payment rails | Group already uses DuitNow and TNG. Record, don't move, money. |
| Bank or card statement import | 12 people, 6 banks, 3 countries. Not worth it for 15 days. |
| Native iOS / Android apps | PWA installs to the home screen and updates without store review — which is also what lets the smart layer ship mid-trip. |
| Budgets, alerts, forecasting | Nobody will use them mid-trip. Reporting is retrospective only. |

---

## 3. Concepts

Eight nouns. Getting these right is most of the design; the screens fall out of
them.

| Concept | Definition |
|---|---|
| **Trip** | The container, and there are many. Each has its own base currency, date range, members and expenses. A trip switcher sits at the top of the app; balances never cross trips. |
| **Person** | An identity that persists *across* trips, so Joel is the same Joel in Iceland and in next year's Japan trip, with his settings and device carried over. |
| **Member** | A person's participation in one trip. Everyone is an admin (GRP-02): anyone can invite, edit and set the trip's default currency. |
| **Segment** | London / Iceland / Paris / In transit. Supplies the default currency for new expenses and drives every filter. Derived from date, overridable. |
| **Squad** | A named, saved participant subset — "Everyone (12)", "London stay (6)", "Second car (8)". Turns a 12-checkbox chore into one tap. Editing a squad never rewrites past expenses. |
| **Household** | Two or more members who share a wallet — a couple. Splitting *by household* divides among wallets rather than heads, and the pair settles as one. This is the "or by couple" split mode. |
| **Expense** | Money spent by one or more payers on behalf of a set of participants. Carries original amount + currency, a frozen FX rate, a split rule, optional receipt. |
| **Transfer** | A settle-up payment between two members. Deliberately *not* an expense — it moves balance without changing what the trip cost. |

Squads and households are why this beats Splitwise for this trip: Splitwise
makes subset splitting a per-expense chore, so people stop doing it and the
numbers drift. Here the subsets are first-class, pre-seeded from the sheet, and
offered as one-tap chips.

---

## 4. Feature list

P0 must work on 22 November. P1 can land as a mid-trip update — a PWA updates
silently, so the smart layer does not have to be finished before departure.
P2 is after the trip.

### Capturing expenses

| ID | Requirement | Pri |
|---|---|---|
| EXP-01 | Add an expense in under ten seconds. Amount keypad focused on open; description, payer, squad and category pre-filled from context; Save reachable without scrolling. | P0 |
| EXP-02 | Any member can be the payer. Defaults to the smart suggestion (SMT-01); changing it is one tap. | P0 |
| EXP-03 | Participants chosen by squad chip or individually. | P0 |
| EXP-04 | Categories: Accommodation, Transport, Fuel, Food, Groceries, Activity, Shopping, Fees, Other. Icon row, single tap, no dropdown. | P0 |
| EXP-05 | Edit and soft-delete with an audit trail. Load-bearing now that everyone is an admin. | P0 |
| EXP-06 | Attach a receipt photo or PDF. Compressed client-side; thumbnail on the expense row. | P0 |
| EXP-07 | Multiple payers on one expense; payer rows must sum to the total. | P1 |
| EXP-08 | Itemised receipts — assign individual OCR'd line items to individual people. | P2 |

### Receipt OCR

| ID | Requirement | Pri |
|---|---|---|
| OCR-01 | Photograph a receipt, get a filled form. Extracts merchant, date, total and currency and pre-fills the add-expense screen. The user confirms rather than types. | P1 |
| OCR-02 | Currency detected from the receipt — from the symbol, tax wording and merchant locale (`kr`/`VSK` means ISK, `TVA` means EUR). Falls back to the segment default. | P1 |
| OCR-03 | Rate looked up for the receipt's own date, not today's. See §8. | P1 |
| OCR-04 | **OCR never blocks logging.** Offline, or when OCR is slow or wrong, the photo is stored and the expense is saved by hand; recognition is queued and fills in later as a suggestion. A failed scan must never cost someone their expense. | P0 |

### Splitting

| ID | Requirement | Pri |
|---|---|---|
| SPL-01 | Split equally among selected participants. Remainder distributed deterministically (§6). | P0 |
| SPL-02 | Split by household — "by couple". Divides among wallets, not heads: six couples split a RM 600 dinner six ways at RM 100 per couple, not twelve ways. | P0 |
| SPL-03 | Split by exact amounts. Required by the sheet import. | P0 |
| SPL-04 | Split by shares (whole-number weights), for uneven room occupancy. | P0 |
| SPL-05 | Live remaining indicator. Exact and share modes refuse to save until remaining is zero. No silently unbalanced expenses, ever. | P0 |
| SPL-06 | Save any custom selection as a new squad, offered inline after a custom split. | P1 |

### Netting and settling up

| ID | Requirement | Pri |
|---|---|---|
| NET-01 | Debts net continuously and visibly. Owe someone RM 100, then pay RM 50 for the two of you, and the figure becomes RM 75 immediately — with the arithmetic shown, not just the answer. Worked example in §6. | P0 |
| NET-02 | Every pairwise figure is expandable. Tap any "you owe RM 75" to see the expenses that built it, each with its contribution. Trust in the number comes from being able to open it. | P0 |
| BAL-01 | Personal position above everything — one netted number, "You are owed RM 3,240.15", in semantic colour. | P0 |
| BAL-02 | Full group balance sheet, sorted by magnitude. Must always sum to zero; asserted in tests and shown as a footer check. | P0 |
| SET-01 | Simplified settle-up: minimum-cash-flow reduction across the whole group, on top of pairwise netting. | P0 |
| SET-02 | Record a transfer as paid: payer, payee, amount, date, method (bank/cash/TNG), optional screenshot. Partial payments allowed. | P0 |
| SET-03 | Households settle as one — a couple receives one transfer, not two. | P1 |
| SET-04 | Interim settle-up mid-trip. Requires dated transfers and point-in-time balances. | P1 |

### Trips, group and sharing

| ID | Requirement | Pri |
|---|---|---|
| TRP-01 | Multiple trips, switchable. Trip list and a switcher in the header; each trip has its own members, currency and balances, and nothing leaks between them. | P0 |
| TRP-02 | Anyone can create a trip and set its base currency, dates and segments. Creating a trip makes you a member of it, nothing more. | P0 |
| TRP-03 | Duplicate a trip's roster — start the next trip with the same people, squads and households already set up. Most of the value of multi-trip. | P1 |
| GRP-01 | Invite by link, claim by name. A link into the WhatsApp group; each person taps their name and that device is bound to them. | P0 |
| GRP-02 | **Everyone is an admin.** Any member can invite people, edit or delete any expense, manage households and set the trip's default currency. Flat by request — safety rails are the audit trail (EXP-05), recoverable deletes, and a trip creator who cannot be removed. | P0 |
| GRP-03 | Households editable by anyone. Changing a household does not rewrite past expenses. | P0 |
| SHR-01 | Copy balances as WhatsApp-ready plain text, aligned, under the message length limit. One button, not a screenshot. | P0 |
| DOC-01 | Voucher shelf: every booking PDF from the Drive folder, date-ordered, cached offline. | P1 |
| RPT-01 | Trip summary and CSV export — total spend, per person, by category, by segment, prepaid vs on-trip. | P1 |

### Infrastructure

| ID | Requirement | Pri |
|---|---|---|
| SYN-01 | Offline capture with a sync queue. Every write succeeds locally and drains on reconnect; pending badge on unsynced items. | P0 |
| SYN-02 | Client-generated UUIDs so offline creates never collide. | P0 |
| SYN-03 | Installable PWA — home-screen icon, no browser chrome, cold start with no network. | P0 |
| SYN-04 | Live updates when online; balances move without a refresh. | P1 |
| IMP-01 | Import the Euro Trip sheet (§11). | P0 |

---

## 5. Screens

Phone-first, thumb-reachable, one primary action per screen. Everything else is
a bottom sheet.

**Home — Balances.** Trip switcher in the header. Your net position, large,
coloured by sign. Segmented control: Balances / Expenses / Settle up. Member
rows reading "you owe Sin Yin RM 75.00" — already netted. Footer assertion that
the group nets to zero. Persistent "+ Add expense" button, bottom right.

**Add expense** — the screen that decides adoption. Amount focused with keypad
open, currency chip beside it defaulting from the segment. Live "≈ RM 118.40"
conversion beneath. "Paid by" pre-filled with the smart guess and marked as a
guess. "Split between" showing squad and household chips. Camera button for OCR
beside the amount, not behind a menu.

```
┌──────────────────────────────────────┐
│  ✕      Euro Trip ▾        Add expense│  ← trip switcher
│        ISK ▾   14,900        [📷]    │  ← keypad open; camera = OCR
│              ≈ RM 478.20             │  ← rate frozen on save
│  Dinner at Reykjavík                 │
│  Paid by      Khong Ming     ✨ ▾   │  ← ✨ = suggested, one tap to change
│  Split        Everyone (12)       ▾  │  ← squad chip
│               ⚭ By couple            │  ← household mode
│  🏨  🚗  ⛽  🍽  🛒  🎟  🛍  💳      │
│  ⌄ More — date, receipt, notes       │
│  ┌────────────────────────────────┐  │
│  │             Save               │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Common case: type the amount, tap a category, tap Save — or photograph the
receipt and confirm.

**Receipt capture.** Camera with an edge-detect frame. Extracted fields shown
as editable chips, each tappable to correct. Low-confidence fields visibly
flagged rather than silently guessed. Detected currency and the rate used, both
shown. Offline: photo saved, form manual, recognition queued.

**Person detail** — where netting earns trust. The netted figure at the top,
large; beneath it the derivation (what you owe, what they owe, the difference);
every line expandable to the expense behind it; a "Settle up" action for just
this person.

**Expenses.** Grouped by day with sticky date headers. Segment filter chips.
Row: icon, description, "Sin Yin paid RM 240 · you owe RM 20". Prepaid bookings
visually distinct from on-trip spending. Unsynced and pending-OCR rows carry
badges.

**Settle up.** Headline: "8 transfers clear all 12 balances". Transfer cards
each with "Mark as paid" and "Copy for WhatsApp". Toggle simplified / direct
debts. Households shown as a single counterparty.

---

## 6. Money and netting

The part that must be provably correct. Twelve people will check these numbers
against a spreadsheet, and one wrong sen destroys trust in the whole app.

**Representation.** All money is stored and computed as integer minor units —
sen, pence, aurar, cents. Never a float, never a decimal string, at any layer
including JSON on the wire. Conversion to a display string happens only at the
last moment.

### Netting — the RM 75 case

You owe Sin Yin RM 100. You then pay RM 50 for a meal split between the two of
you, so her share is RM 25 and she now owes you that. The app must show RM 75,
immediately, without anyone doing arithmetic:

```
You & Sin Yin
  You owe her                      RM 100.00
    Blue Lagoon ticket, 25 Nov
  She owes you                    − RM  25.00
    ½ of the RM 50 meal you paid, 26 Nov
  ─────────────────────────────────────────
  You pay her                      RM  75.00
```

This is not a special mode — it is what a correct balance engine does by
default, and the spec's contribution is that the *derivation is always one tap
away* (NET-02). People argue with a bare number; they accept a number they can
open. Netting applies to every pair automatically, at every moment, with no
"reconcile" button to press.

### Equal split with remainders

RM 100.00 across three people is 3,333.33 sen each, which is not an integer.

1. Base share = `total / n`, integer division. Everyone gets this.
2. Remainder = `total mod n` minor units are left over.
3. Distribute one extra unit each to the first *remainder* participants,
   ordered by member ID ascending — deterministic, reproducible, not random.
4. Rotate the starting offset by expense ID so the same person is not always
   the one paying the extra sen.

For shares, households and percentages use the **largest-remainder method**:
floor every allocation, then hand out leftover units to the largest fractional
parts, ties broken by member ID.

**Invariants — the first two tests written.**

- `sum(splits) == expense.amount` for every expense, in every split mode, always.
- `sum(all member balances) == 0` for the trip.

**Balance.** For each member:
`net = Σ(paid) − Σ(owed) + Σ(transfers received) − Σ(transfers sent)`.
Positive means the group owes them. Pairwise netting is the same formula
restricted to two people.

**Settlement minimisation.** Split members into creditors and debtors, then
greedily match the largest creditor against the largest debtor, settling
`min(|credit|, |debt|)` and repeating. Yields at most `n − 1` transfers, in
practice around eight for twelve people. Not provably optimal — that problem is
NP-hard — but fast, deterministic, and close enough that nobody will notice.

---

## 7. The smart layer

"Usually one person pays." The app should notice that and stop asking. Every
suggestion here is deterministic and explainable — no model, no black box, and
always one tap to override.

| ID | Requirement | Pri |
|---|---|---|
| SMT-01 | Suggest the payer. Ranked by who paid the last expense in this category and segment, who has been paying most often on this trip, and who is currently owed least — so the burden rotates instead of landing on one person. Shown with a ✨ marker so it reads as a guess, never as fact. | P1 |
| SMT-02 | Suggest the split. Defaults to the squad and method most used for this category in this segment. | P1 |
| SMT-03 | Detect couples and offer "by couple". When two members are repeatedly in the same subset and one always pays for both, offer to pair them into a household. Suggested, never applied silently. | P1 |
| SMT-04 | Nudge when one person is carrying the group: "Sin Yin has paid the last 6 expenses and is owed RM 1,240 — someone else should take the next one." The most useful smart behaviour on a 15-day trip. | P1 |
| SMT-05 | Flag likely duplicates — same amount, same day, same payer, entered twice, which happens constantly when two people both log the group dinner. Offer to merge. | P1 |

**Why rules and not a model.** These suggestions have to work offline in an
Icelandic dead zone, run instantly on a phone, and be explainable when someone
disputes them. A handful of counting rules over the trip's own history does all
of that; an LLM does none of it. If a smarter layer is ever wanted, it belongs
behind these rules as a fallback, not in front of them.

---

## 8. Currency

Four currencies in fifteen days. The hard rule: **an exchange rate is frozen at
the moment the expense is saved and never recalculated.** If rates moved
retroactively, everyone's balance would drift daily and the app would become
unusable.

| Currency | Where | Note |
|---|---|---|
| `MYR` | Base for this trip | All balances, settlements and reports. Each trip picks its own base (TRP-02). |
| `GBP` | London, 22–25 Nov | Default for expenses in that segment. |
| `ISK` | Iceland, 25 Nov – 3 Dec | **Zero decimal places** — the minor unit is the króna itself; the aurar was abolished. Hard-code this; a generic ×100 will be wrong by a factor of a hundred. |
| `EUR` | Paris, 3–6 Dec | Default for that segment. |

### On using Google for rates

Google has no public exchange-rate API — the figure in a Google search result is
not available through any supported endpoint, and scraping it would break
without warning and cannot run offline. What Google displays *is* the ECB /
mid-market rate, which is available properly and free.

So: use **Frankfurter** (European Central Bank data — free, no API key,
historical rates by date). It returns the same number people see when they
Google it, which is what actually matters for the group trusting the
conversion. Use **Google Cloud Vision** for the OCR itself, where Google
genuinely is the strongest option.

### Rate resolution, in order

1. Manually entered on the expense — always wins, for when someone wants the
   rate their card actually gave.
2. ECB rate for the expense's own date. Fetched on save, or on OCR (OCR-03)
   using the receipt's printed date rather than today's.
3. Cached daily rate table, refreshed whenever online. Covers the whole trip
   offline.
4. Last known rate for that pair — final offline fallback. Flags the expense so
   the rate can be corrected once back online.

Both figures are always shown — **ISK 14,900** with **≈ RM 478.20** beneath —
so nobody has to trust a conversion they cannot see. Correcting a rate on a
single expense is allowed and audit-logged.

---

## 9. Data model

Amounts are integers throughout; timestamps are UTC ISO-8601.

| Table | Columns |
|---|---|
| `people` | `id, display_name, avatar_color, device_token, created_at` — persists across trips |
| `trips` | `id, name, base_currency, starts_on, ends_on, created_by, created_at` |
| `members` | `id, trip_id, person_id, household_id, joined_at` — every member is an admin |
| `households` | `id, trip_id, name, settle_to_member` — the couple that receives the transfer |
| `segments` | `id, trip_id, name, starts_on, ends_on, default_currency, sort_order` |
| `squads` | `id, trip_id, name, member_ids (json), sort_order` |
| `expenses` | `id (uuid), trip_id, segment_id, description, amount_minor, currency, fx_rate, fx_rate_date, fx_source, amount_base_minor, category, split_method, spent_at, is_prepaid, notes, created_by, created_at, updated_at, deleted_at` |
| `expense_payers` | `id, expense_id, member_id, amount_minor` — sums to the expense total |
| `expense_splits` | `id, expense_id, member_id, share_weight, amount_minor, amount_base_minor` — sums to the expense total |
| `transfers` | `id (uuid), trip_id, from_member, to_member, amount_base_minor, method, paid_at, note, attachment_id` |
| `attachments` | `id, trip_id, expense_id, kind (receipt\|voucher), filename, mime, storage_path, drive_url, cached_offline` |
| `ocr_jobs` | `id, attachment_id, status (queued\|done\|failed), raw_text, parsed (json), confidence, completed_at` — queued offline, drained online |
| `fx_rates` | `base, quote, rate_date, rate, source` — cached ECB table, unique on the first three |
| `audit_log` | `id, trip_id, entity, entity_id, action, actor_member, before (json), after (json), at` |

Both `expense_payers` and `expense_splits` carry a database-level check that
they sum to the parent expense — the §6 invariant enforced in two places, not
one.

---

## 10. Offline and access

**Offline.** The local IndexedDB store is the source of truth for the UI. Writes
apply optimistically and enqueue; the queue drains on reconnect. Because
expenses are append-mostly, conflicts are rare — resolve with last-write-wins
per field using `updated_at`, and surface anything genuinely contested rather
than silently picking a winner. The app shell, member list, all squads, the
cached rate table and every cached voucher must work from a cold start with the
radio off. OCR is the one feature that legitimately needs network, which is
exactly why OCR-04 makes it non-blocking.

**Access.** Passwords are the wrong shape for a WhatsApp group of twelve.
Instead: someone creates the trip and adds the members; an invite link goes into
the group chat; each person opens it, taps their own name, and the device holds
a long-lived token bound to that member. Re-claiming from a new device requires
a tap from any existing member, which stops someone accidentally claiming
Steven.

**The cost of a flat admin model.** Everyone being an admin (GRP-02) is the
right call for a group of friends and removes a whole category of "can you add
this for me" friction. The trade-off is real though: any member can delete any
expense. It is made safe by three things — deletes are soft and recoverable,
every change is attributed in the audit log, and the trip creator cannot be
removed. Worth knowing rather than discovering.

**Privacy.** The trip link is a capability. Treat it as
unlisted-but-not-secret: no search indexing, no contact details stored beyond a
display name, receipts served only to claimed devices. Receipt images go to a
private bucket, never a public URL — a receipt can carry a card's last four
digits.

---

## 11. Importing the sheet

A one-time importer that turns the existing matrix into seeded expenses. This
is what makes the app credible on day one instead of an empty shell asking
people to re-enter RM 116,823.

1. Upload the sheet as CSV or XLSX. Detect the person × line-item shape: first
   column is names, remaining headers are line items, cells are per-person
   amounts.
2. Create one member per row and one expense per column with a non-empty cell.
3. Expense amount = column sum. Split method = `exact`. Participants = members
   with a non-empty cell — this is what preserves all six participant sets
   automatically.
4. Parse the date prefix in each header (`25/11`, `1-3/12`) into `spent_at` and
   infer the segment. Mark every row `is_prepaid = true`.
5. **Prompt for the payer of each line item.** The one thing the sheet does not
   record and the one thing balances cannot be computed without. Present all
   thirteen priced items in a single list with a member picker each.
6. Offer to save the distinct participant sets found as named squads,
   pre-filling Everyone (12), Akureyri flight (10), Second car (8), Long-haul
   (7) and London stay (6).
7. Show a reconciliation screen: imported total against each person's sheet
   total, with any difference called out. Expect the one-sen discrepancies from
   §1 to surface here — that is the importer working correctly.

---

## 12. Stack

Chosen for a hard deadline and twelve concurrent users, not for elegance.

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + TypeScript + Vite | Matches the existing `webapp/` in this repo — same tooling, same deploy path. |
| Styling | Tailwind | Fast iteration on a phone-first layout. |
| Local store | Dexie (IndexedDB) | Typed queries over IndexedDB; the offline requirement is non-negotiable. |
| PWA | `vite-plugin-pwa` | Service worker, offline shell, installable, and silent updates — which is what lets P1 ship mid-trip. |
| Backend | Supabase (Postgres) | Auth, row-level security, realtime and private file storage without writing a server. Realtime gives SYN-04 nearly free. |
| OCR | Google Cloud Vision | Document text detection, called from a server function so the API key never reaches a phone. Strong on thermal receipts; free tier covers a trip comfortably. |
| FX rates | Frankfurter (ECB) | Free, keyless, historical rates by date. Matches the figure Google shows. See §8. |
| Hosting | Vercel | `vercel.json` already present in this repo. |
| Money | Hand-rolled integer helpers | Small enough to own and test. No float arithmetic anywhere. |

---

## 13. Phases

Ten weeks to departure, and the scope above is roughly twelve weeks of work.
Rather than cutting features, the plan below ships everything the trip *needs*
by 22 November and lets the smart layer land as a silent PWA update during the
trip itself.

| Phase | Length | Deliverable |
|---|---|---|
| 1 | ~1 wk | **Money engine, headless.** Integer arithmetic, all four split modes including households, pairwise netting, balance computation, settlement minimisation. Unit-tested against the real sheet figures — including the RM 75 case — before a pixel is drawn. |
| 2 | ~2 wk | **Core app online.** Schema, multi-trip shell and switcher, invite links, flat admin, add/edit/delete expense, squads, households, netted balances with visible derivations, settle-up. |
| 3 | ~1 wk | **Sheet import.** Matrix importer, payer prompts, squad seeding, reconciliation. At the end the app holds the real RM 116,823 and the group can check it. |
| 4 | ~2 wk | **Offline and PWA.** Local store, sync queue, service worker, cached rate table, install flow. Tested with the radio genuinely off. **Last hard P0.** |
| 5 | ~1.5 wk | **OCR and receipts.** Camera capture, Vision behind a server function, field extraction with confidence flags, rate lookup by receipt date, the offline queue that makes it non-blocking. |
| 6 | ~1 wk | **Group rehearsal.** All twelve installed and logging real pre-trip spending. Finds the usability problems solo testing never will, while there is still time to fix them. |
| 7 | during the trip | **Smart layer and vouchers.** Payer and split suggestions, couple detection, the carrying-the-group nudge, duplicate flagging, voucher shelf, reports and CSV. Each of these gets *better* with real trip history behind it. |

**The honest read on schedule.** OCR, multi-trip and the smart layer roughly
double the original build. Phases 1–4 and 6 are what must exist on 22 November;
they fit, with about a week of slack. Phase 5 is the one genuine risk — if it
slips, the trip runs on manual entry, which is exactly what OCR-04 is designed
to make survivable. Phase 7 deliberately ships live, because a PWA can.

---

## 14. Open questions

Answers needed before Phase 2. Most of them live in the WhatsApp group rather
than in any document.

1. **Is the sheet in MYR?** Assumed throughout, from the totals and the group.
   If it is anything else, the base currency and every worked figure changes.
2. **Who paid each of the thirteen booked items?** The single biggest gap. Drive
   shows at least four different accounts uploading vouchers, so it was not one
   person fronting everything.
3. **Who are the couples?** Needed for "split by couple" and household
   settle-up. The app can suggest them later (SMT-03), but seeding them at
   import is far better than discovering them in Iceland.
4. **Chan Yong Hoay is on the long-haul flight but not in the London
   Aparthotel.** Staying elsewhere in London, or an omission in the sheet?
5. **Paris is unpriced.** Airbnb 3–5 Dec, Disneyland 5 Dec and the 5–6 Dec hotel
   have columns but no amounts. Still being booked, or already paid and not yet
   recorded — and who is in each?
6. **Settle once at the end, or per segment?** Settling Iceland before Paris
   keeps the final numbers small, but promotes SET-04 to P0.

---

## 15. Design references wanted

Not blocking — the direction above is clear enough to build from.

- **Most useful.** Screenshots of the *add-expense* screen from whichever app
  the group has actually used. That screen decides whether people log a EUR 4
  coffee or give up; matching a flow they already know beats anything invented.
- Whether anyone in the twelve has strong feelings about Splitwise. The
  complaints people already have are the best possible spec for what to do
  differently.
- Phone mix across the group — iPhone versus Android. PWA install is a
  genuinely different flow on each, and GRP-01 needs instructions for both.
- Any colour, name or icon preference. Otherwise the palette follows the trip:
  cold Nordic neutrals with a warm amber accent.
