# HiTech Machinery — Expense Statistics Dashboard: Handoff

> Purpose of this doc: everything a fresh chat needs to **build the employee-expense
> statistics website** (pie/bar charts, per-employee monthly totals). The data
> pipeline that feeds it is already built and running.

---

## 1. What the system does (context)

Employees send a photo of a receipt over **WhatsApp** → an **n8n** workflow
("HiTech Receipt Processor (Final)", id `LWBG3wrnirRbdG99`) validates the sender,
runs **Gemini OCR** to extract the fields, categorizes it, and writes one row to
the Supabase table **`wap_expenses`**. There is **no approval step** — every logged
receipt counts. The dashboard just visualizes what's in the database.

Boss's ask (verbatim intent): *track each individual employee's expense record;
receipts categorized (food, petrol, etc.); at month-end the accounts team sees how
much each employee spent; show it on the website with pie charts / bar graphs, in a
descriptive, good-looking way.*

---

## 2. Supabase connection

- **Project API URL:** `https://oocmjiuymmvwvyvwlfpd.supabase.co`
- **Keys:** get them from Supabase Dashboard → **Project Settings → API**
  - `anon` (public) key — for a client-side dashboard behind login
  - `service_role` key — for a server-side dashboard (bypasses RLS). **Never ship the service key to the browser.**
- Tables have **RLS enabled**. See the security note in §6.

---

## 3. The data — read from the VIEW, not raw rows

A Postgres view was created specifically for this dashboard:

### `public.wap_expense_monthly`  ← use this
Pre-aggregated, one row per **month × employee × department × category**.
Already grouped by **submission date** (`processed_at`), which is the reliable
date (see §6). Excludes rejected/bad-image rows. Uses `security_invoker` (respects
RLS) — see the security note in §6 for how to read it.

| column | type | notes |
|---|---|---|
| `month` | text | `'YYYY-MM'`, e.g. `2026-07` |
| `month_start` | date | first day of month (for sorting/x-axis) |
| `employee_name` | text | who spent it |
| `department` | text | e.g. ai, media, sales |
| `category` | text | one of: Food, Fuel, Travel, Supplies, Utilities, Repairs, Other |
| `receipt_count` | int | # receipts in that bucket |
| `total_spend` | numeric | sum of totals (PKR) |
| `avg_receipt` | numeric | average receipt value (PKR) |
| `currency` | text | always `'PKR'` |

Supabase REST example:
```
GET https://oocmjiuymmvwvyvwlfpd.supabase.co/rest/v1/wap_expense_monthly?month=eq.2026-07
Headers: apikey: <key>, Authorization: Bearer <key>
```
supabase-js example:
```js
const { data } = await supabase
  .from('wap_expense_monthly')
  .select('*')
  .eq('month', '2026-07');
```

### Raw table `public.wap_expenses` (for the receipt drill-down list)
Useful columns: `expense_id`, `employee_name`, `department`, `sender_phone`,
`vendor_name`, `category`, `total`, `subtotal`, `tax`, `currency`, `payment_method`,
`items` (jsonb), `date` (printed receipt date — unreliable), `processed_at`
(submission time — reliable), `drive_link` (image URL, may be null),
`ai_confidence`, `ai_flag` (contains `OVER_LIMIT:` when over the sender's limit),
`status`. Filter out bad images with `status <> 'rejected'`.

### `public.wap_allowed_senders` (the employee roster)
`phone`, `employee_name`, `department`, `spending_limit`, `active`. This is the
source of truth for who's an employee and their monthly limit.

---

## 4. Chart-by-chart query recipes (all from the view)

**Bar — spend per employee, this month** (the headline chart)
```sql
SELECT employee_name, SUM(total_spend) AS spend
FROM wap_expense_monthly
WHERE month = '2026-07'
GROUP BY employee_name
ORDER BY spend DESC;
```

**Pie — spend by category, this month**
```sql
SELECT category, SUM(total_spend) AS spend
FROM wap_expense_monthly
WHERE month = '2026-07'
GROUP BY category
ORDER BY spend DESC;
```

**Line — monthly spend trend (whole company or one employee)**
```sql
SELECT month, SUM(total_spend) AS spend
FROM wap_expense_monthly
-- WHERE employee_name = 'sarim'
GROUP BY month
ORDER BY month;
```

**Per-employee drill-down: their categories this month**
```sql
SELECT category, receipt_count, total_spend
FROM wap_expense_monthly
WHERE month = '2026-07' AND employee_name = 'sarim'
ORDER BY total_spend DESC;
```

**Receipt-level list for an employee (with image links)** — from the raw table:
```sql
SELECT processed_at::date AS date, vendor_name, category, total, drive_link
FROM wap_expenses
WHERE employee_name = 'sarim' AND status <> 'rejected'
ORDER BY processed_at DESC;
```

Suggested dashboard controls: a **month picker** and an **employee/department
filter**. Default view = current month, all employees.

---

## 5. Suggested build (dashboard chat can choose)

- **Simplest:** a single-page React (or plain HTML) app using `supabase-js` +
  a chart lib (Recharts / Chart.js). Reads the view directly. Host on Vercel/Netlify/
  the same server. Put it behind a login (Supabase Auth) if it uses the anon key.
- **Server-rendered:** Next.js with the service_role key server-side (keeps data
  private, no RLS wrangling).
- Keep the color palette consistent; label money as `PKR`.

---

## 6. Data-quality rules already enforced (so charts are clean)

- **Category** is constrained to a fixed 7-value list in the workflow
  (Food / Fuel / Travel / Supplies / Utilities / Repairs / Other) and never null.
  → pie chart groups cleanly. *(Note: a few OLD rows still say "Groceries" etc.
  from before this rule — see §7 cleanup.)*
- **Currency** is forced to **PKR** on every new receipt, so totals are summable.
- **Reporting date = `processed_at`** (when the employee submitted), NOT the printed
  receipt `date`. The AI often reads old/blank printed dates (you'll see 2017–2021
  and nulls in old rows), so never group by `date`.

**SECURITY:** The view uses **`security_invoker = on`**, so it respects RLS on
`wap_expenses` (this cleared the "SECURITY DEFINER" advisor warning). Because the
base table has RLS enabled with no public read policy, the `anon`/`authenticated`
roles will get **zero rows** through the view. Two ways to read it:
- **Recommended:** build the dashboard **server-side** and query with the
  **`service_role`** key (bypasses RLS). Never expose that key to the browser.
- **Client-side:** add an RLS `SELECT` policy on `wap_expenses` for `authenticated`
  (and grant table SELECT), then read with the anon key behind Supabase Auth login.
Decide this in the dashboard chat before wiring up data.

---

## 7. Current state & housekeeping (as of 2026-07-04)

- **Pipeline is live and working** (active workflow version tested end-to-end in
  production by the user).
- **Two pending items on the workflow (do NOT block dashboard work):**
  1. **Category + PKR tweaks are saved as a DRAFT but not yet published**, because
     publishing is blocked by a broken **Google Drive credential** (leftover from
     switching between OAuth and a service account). They go live the moment the
     Drive credential is fixed and the workflow is saved/published. Until then, new
     receipts still use the old (free-text category, detected-currency) logic.
  2. **Google Drive image upload returns 403** (service accounts can't write to a
     personal My Drive). Fix = publish the Google OAuth consent screen (Testing →
     In production) so the OAuth token stops expiring, set the Drive node to OAuth2,
     and reconnect. Drive is non-blocking, so this only affects receipt-image backup,
     not the expense data.
- **Test/messy data to clean before a demo:** a handful of old rows are test
  receipts with foreign currencies (USD/THB), category "Groceries", and 2017–2021
  dates. Optionally delete rows where `employee_name IN ('Mawavia','sarim')` that are
  clearly tests, or just filter to the current month for the demo.
- The unused approval columns (`status='approved'/'rejected'`, `approved_by`,
  `sap_*`) can be ignored — no approval flow is in use.

---

## 8. Quick sanity check (run this to see the view working)
```sql
SELECT month, employee_name, category, receipt_count, total_spend
FROM wap_expense_monthly
ORDER BY month DESC, total_spend DESC;
```
