# Dark mode — design

**Date:** 2026-07-15
**Status:** Approved, ready for implementation plan
**Motivation:** Sarim uses the dashboard at night and on mobile in the dark. This is a usability
need, not an aesthetic one.

## This deliberately overturns a written product principle

`PRODUCT.md` says:

> **Modern confidence**: Light, airy, high-contrast. Avoid the dark/neon aesthetic that screams
> "tech tool."

That principle stands **for the light theme**, which remains the default. Dark mode is an opt-in
accommodation for night use, not a rebrand. `PRODUCT.md` should be amended to say so, rather than
left silently contradicted.

## The discovery that makes this cheap

The initial estimate was "a day of careful work": ~500 hard-coded light-only colour references (299
`text-zinc-*`, 102 `border-zinc-*`, 52 `bg-zinc-*`, 48 `bg-white`), 78 raw hex literals, and zero
`dark:` variants anywhere.

But **Tailwind v4 compiles every colour utility as a CSS variable reference**:

```css
.text-zinc-500  { color: var(--color-zinc-500) }
.bg-white       { background-color: var(--color-white) }
.border-zinc-200{ border-color: var(--color-zinc-200) }
```

with `--color-zinc-500` etc. declared in `:root`. Overriding those variables inside
`[data-theme="dark"]` therefore flips **all ~500 utilities with zero component edits**.

Likewise the 6 JS colour constants (`INK`, `ACCENT`, `ACCENT_DK`, `BLUE`, `POS`, `NEG`) cover 117
usages. Changing their *values* to `var(--…)` strings flips all 117 at once, because inline
`style={{…}}` resolves `var()` normally.

## Approach: variable remap (chosen)

Rejected alternatives:

- **Full semantic token refactor** (`bg-surface`, `text-muted`, …): honest names, but a ~500-site
  diff across a 3,000-line file with an enormous regression surface, for a result that looks
  *identical* in light mode. Too much risk to buy naming purity.
- **Dark mode only for the Chat tab:** self-defeating — a white header and nav would flash before
  the dark panel.

### The known wart, stated plainly

After the remap, `text-zinc-900` renders **white** in dark mode. The class name is a lie. This is a
deliberate trade: one comment in `index.css` explaining it, versus a 500-site rewrite. The CSS
variable layer is the same foundation either way, so the codebase can migrate to semantic names
incrementally later without redoing this work.

The remap is safe **because the codebase uses the zinc scale semantically** — low numbers are
surfaces, high numbers are text. Spot-checked and it holds. Expect a short tail of places where a
mid-grey was chosen decoratively and looks slightly off in dark; those get fixed individually on
sight. It is a short tail, not a systemic problem.

## Palette — "Console" (blue-tinted near-black)

Chosen from three mocked directions. The neutrals lean toward the blueprint blue, so the dark theme
still reads as *this* brand rather than Generic Dark Dashboard. Deep enough to rest the eyes at
night without the halation that pure black causes (bright text on `#000` smears for tired eyes) and
without flattening the panel shadows the design leans on.

| Role | Light | Dark |
|---|---|---|
| Page background | `#F1F5F9` | `#0F1216` |
| Panel / surface | `#FFFFFF` | `#171B21` |
| Raised surface (user bubble, controls) | `#18181B` (ink) | `#2E3641` |
| Border / line | `#E4E4E7` | `#2A3038` |
| Primary text | `#18181B` | `#E7EAEE` |
| Muted text | `#71717A` | `#98A1AD` |
| Accent (signal orange) | `#F5471D` | `#F5471D` — unchanged |
| Accent as text | `#D63A12` | `#FF7A55` |
| Blue (brand/charts) | `#2258B8` | `#5B8FF9` |
| Positive | `#16794C` | `#34C08A` |
| Negative | `#B91C1C` | `#F87171` |

**The accent survives untouched.** That matters: it is the thing that keeps the dark theme
recognisably Hi-Tech.

**The user bubble inverts, and this is a change in meaning, not just value.** `INK` (`#18181B`) is
invisible on a dark background, so "my message is the dark one" cannot hold. In dark, the user
bubble becomes the *lighter* surface (`#2E3641`) and the assistant bubble is the darker, bordered
one. This falls out of the variable remap automatically.

**Green and red are lightened** — `#16794C` and `#B91C1C` both fail contrast on dark.

All pairings must clear **4.5:1** for body text and **3:1** for large text, per `PRODUCT.md`'s
WCAG 2.1 AA commitment. Verify, don't assume.

## Theme switching

`auto | light | dark`, persisted in `localStorage` under `ht_theme`.

- **auto (default)** — follows `prefers-color-scheme`, with a live `matchMedia` listener so the app
  flips when the phone's night schedule does, without a reload. This is the whole point: opening the
  dashboard at 2am should just *be* dark, with no action taken.
- **light / dark** — forced override, remembered.

Applied by stamping `data-theme="light|dark"` on `<html>`. In `auto`, the resolved value is written,
not the literal `auto`, so CSS only ever sees a concrete theme.

**Flash-of-wrong-theme:** an inline `<script>` in `index.html` reads `localStorage` and sets
`data-theme` on `<html>` **before first paint**. Without it, every night-time load flashes white.
This is a one-liner and it is not optional.

A toggle in the header cycles the three states with a sun/moon/auto icon.

## Charts — the one place the variable trick fails

Recharts sets colours as SVG **attributes** (`fill="#2258B8"`). A CSS `var()` does not resolve inside
an attribute — the browser sees a literal string and renders nothing. Charts therefore consume a
`useThemeColors()` hook returning **resolved hex values** for the current theme.

In scope in `src/charts.jsx` (~50 sites): 4 `CartesianGrid`, 6 `XAxis`, 6 `YAxis`, 7 `Tooltip`
(content/item/label styles), 10 `tick` styles, and the `Bar` / `Line` / `Area` / `Pie` fills.

**Specifically flagged:** lines 160, 303, 390 and 433 hard-code `stroke="#fff"` as a halo around
active dots and pie segments. On a dark canvas that glares like a headlight. It becomes the surface
colour.

## Scope

**In:** the dashboard (all tabs), the charts module, the login page, and the auth/password modals.

Shipping a dark dashboard that flashes a white login screen would defeat the purpose, so login is in
scope and is not negotiable.

**Out:** the n8n workflows (irrelevant), the emails (`supabase/email-templates` — they render in the
recipient's mail client, which has its own theming and is a separate problem).

## Files

| File | Change |
|---|---|
| `src/index.css` | Light + dark variable blocks; override `--color-zinc-*`, `--color-white`, `--color-slate-*` under `[data-theme="dark"]`; declare semantic vars (`--ink`, `--accent`, `--blue`, `--pos`, `--neg`, `--paper`, `--surface`, `--raised`). |
| `src/theme.js` (new) | `useTheme()` (auto/light/dark, localStorage, matchMedia listener) and `useThemeColors()` (resolved hex for charts). One job, no React tree coupling beyond a hook. |
| `index.html` | Pre-paint inline script to stamp `data-theme` before first paint. |
| `src/mawavia-dashboard.jsx` | 6 colour constants → `var(--…)`; the ~78 inline hex literals → vars; header theme toggle. |
| `src/login.jsx` | 2 colour constants → `var(--…)`. |
| `src/charts.jsx` | Consume `useThemeColors()`; replace the 4 `#fff` halos. |
| `PRODUCT.md` | Amend the "light, airy" principle to record that dark mode is an opt-in night accommodation and light remains the default. |

## Verification

- **Contrast:** every text/background pairing in the dark table computed against 4.5:1 (body) and
  3:1 (large). Fix anything that fails; do not eyeball it.
- **Every tab, both themes:** Overview, Conversations, Reps, Cache, Chat, Expenses, Team — plus the
  login page, the password modal, and the receipt/voice cards. The short tail of decorative greys
  surfaces here.
- **No white flash:** hard-reload in dark mode and confirm first paint is dark.
- **Auto tracks the OS live:** flip the OS theme with the app open; it must follow without a reload.
- **Mobile at 320/360/412px in dark**, per the standing rule that mobile is checked before shipping,
  not after.
- **Charts:** grid lines, axis ticks, tooltips and the active-dot halos must all be legible on the
  dark canvas — this is where a half-done dark mode is most obvious.
