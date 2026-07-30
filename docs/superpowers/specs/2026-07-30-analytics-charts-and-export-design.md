# More analytics charts + non-technical export — design

**Date:** 2026-07-30
**Status:** Approved, implementing
**Motivation:** Overview and Expenses give a technical reader plenty, but nothing a CEO can act on at
a glance (is spend up or down? is Finance processing receipts promptly?) and nothing they can hand to
someone else without screen-sharing. This adds five charts targeted at that reader and a per-tab
export (PDF + Excel), plus fixes a pre-existing axis-label overflow bug the new trend charts would
otherwise inherit.

## Decision: five charts, most of them free

Four of the five new charts need **no backend change** — `ExpensesTab` already fetches every
`wap_expenses` row client-side and derives `byEmployee`/`byCategory`/`trend` with `useMemo`
(mawavia-dashboard.jsx:4016-4135); the table is 37 rows, so three more `useMemo` derivations cost
nothing. Only the Overview rep-activity-trend needs a `dashboard_stats()` extension, because that RPC
aggregates over the whole `chat_all` table server-side specifically so the client never holds raw chat
rows (db/dashboard-stats.sql's own rationale) — there is no client-side row set to derive a per-rep
trend from.

## 1. Overview tab

### 1a. Rep activity trend (new chart, `charts.jsx`)

Line/area chart, one line per rep, last 30 days, top 5 reps by volume. 6th+ rep is **dropped, not
folded into an "Other" line** — an "Other" bucket on a CEO-facing chart invites "who's in Other?" more
often than it answers anything, and the roster is 8 people today, so top 5 already shows most of the
company.

**Backend — extend `dashboard_stats()`, additive only:**
Two new jsonb keys added to its existing return object (db/dashboard-stats.sql), same conventions as
the rest of the function (security invoker, Asia/Karachi bucketing, zero-filled `generate_series`):

```
'top_reps_daily'   -- [{date, reps:[{ident, name, count}, ...]}] for the top 5 reps by
                    -- total volume in the 30-day window, per day
'active_reps_daily' -- [{date, count}] distinct sender count per day
```

Nothing currently reading `dashboard_stats()` breaks — both keys are additions to the object, not
changes to existing ones. Applied via Supabase MCP `apply_migration`, verified the same way every
migration in this codebase is (RLS impersonation per role, matching db/dashboard-stats.sql's own
verification style): confirm a non-privileged role gets `[]` for both new keys, confirm dev/ceo get
real data, confirm the two new keys sum/match independently-derived totals.

### 1b. Period-over-period comparison (new panel, not a Recharts chart)

A stat row — same visual language as the existing `Delta` component used for "Today vs yesterday" —
showing **messages**, **active reps**, and **hit rate**, each as "this 30 days vs previous 30 days,"
with a % delta.

- Messages and hit rate: derived **client-side** from the existing `volumeDaily`/`cacheDaily` arrays
  (already 90-day, zero-filled) — sum/average the last 30 days vs the 30 before that. No backend
  change.
- Active reps: derived from the new `active_reps_daily` array (1a) the same way.

## 2. Expenses tab (all three, client-side only)

Added to `ExpenseCharts` (charts.jsx) alongside the existing employee/category/trend panels, computed
in the same `useMemo` block in `ExpensesTab` (mawavia-dashboard.jsx) that already builds
`byEmployee`/`byCategory`/`trend`.

| Chart | Derivation | Notes |
|---|---|---|
| **Spend period-over-period** | Sum `total` by `date`, split at the 30-day boundary | Stat row, same pattern as 1b, not a Recharts chart |
| **Approval turnaround** | `approved_at - processed_at` per row, trended | **Approved receipts only.** Both columns exist on `wap_expenses` today. A time-to-*reject* variant would need `wap_expense_events`' `reject`-kind row, which isn't bulk-fetched — explicitly out of scope, noted as a future addition if wanted |
| **Status distribution** | Count by `status` (`logged` / `pending_approval` / `approved` / `rejected`) | Four buckets, not three. `flagged` is a separate boolean column on the same row (a flagged receipt can still end up approved), so it's shown as a **"% ever flagged" callout** next to the bar, not folded in as a fifth status bucket |

Dropped from the original candidate list: a top-vendors/top-employees leaderboard — redundant with
the existing full "Spend by employee" bar chart.

## 3. Export — per tab, both formats

One `ExportTabButton` per tab (Overview, Expenses), not per chart — a CEO wants "send me the report,"
not five separate downloads. Produces **both** outputs from one click:

**PDF (print-to-PDF):** a `@media print` stylesheet that hides nav/chrome and lays out that tab's
panels for print, plus `window.print()`. Zero new dependencies; the user gets the browser's native
"Save as PDF." Print CSS is pure media-query behavior — unlike the CSP/Permissions-Policy headers in
vercel.json (prod-only), this renders identically in `vite dev` and production, so it's directly
testable locally.

**Excel (.xlsx):** extends `export.js` with `exportXLSX(name, sheets)`, `sheets: [{name, columns,
rows}]`. An `.xlsx` file is a zip of XML parts — reuses the hand-rolled `zipStore()` already in
export.js (built there specifically to avoid a zip dependency) instead of adding SheetJS. One sheet
per chart's underlying data, reusing the same `columns`/`get(row)` shape `exportCSV` already takes so
existing formula-injection escaping (`csvCell`'s leading `=+-@` guard) is not being re-derived — the
XML cell writer applies the same rule.

## 4. Chart axis-overflow fix (bundled — the new trend charts would inherit it otherwise)

**Root cause** (charts.jsx): `ChartsRow`'s volume chart and `HitRateTrend` both use a *negative* left
margin (`left:-20`, `left:-12`) to reclaim space the Y-axis reserves. That drags the first X-axis tick
label left until it collides with the Y-axis's `0` tick — the smashed-together label in the reported
screenshot. `HitRateTrend` additionally uses `interval="preserveStartEnd"`, which force-renders the
first and last ticks regardless of spacing, producing the uneven gaps also visible in that screenshot
(a large gap after the first tick, tight uniform gaps after).

**Fix, applied to every trend chart — the two existing ones and the two new ones (1a,
approval-turnaround):**
1. `<XAxis padding={{ left: 12, right: 12 }} />` — guarantees breathing room at both ends so no tick
   can sit flush against the Y-axis or container edge.
2. Replace the negative margin with a small fixed one (`left: 4`) — stops the plot area from being
   pulled left past the Y-axis label column.
3. Standardize on `ChartsRow`'s existing `tickEvery = Math.max(0, Math.ceil(length/8)-1)` interval
   calculation everywhere, replacing `interval="preserveStartEnd"` — evenly-spaced ticks that scale
   with data length, no forced-corner collision.

Verification: visual check at 320/360/412px (per this project's standing mobile-first rule) and at
the expanded-modal width, for all four trend charts, light and dark theme.

## Testing

No test suite exists in this codebase (no test script in package.json) — verification is manual,
matching the pattern every `db/*.sql` migration in this repo already uses:
- New `dashboard_stats()` fields: RLS-impersonate dev/ceo/finance_admin/employee, confirm each gets
  the access level their existing chat-read capability already implies (no new capability function
  needed — this rides `can_read_chats()`, already gating the rest of the function).
- Expense charts: spot-check derived numbers against a manual `sum`/`count` over the same rows.
- Export: open the generated `.xlsx` in a real spreadsheet app; print-preview the PDF path in an
  actual browser (not just inspect the CSS) on both themes.
- Axis fix: visual check per the Verification note in §4.
