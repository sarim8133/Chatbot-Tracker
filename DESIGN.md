---
name: Hi-Tech Sales Intelligence
description: A precision operations console for industrial sales — ink, hot signal-orange, blueprint grid, mono figures
colors:
  ink: "#18181B"
  accent: "#F5471D"
  accent-dark: "#D63A12"
  positive: "#16794C"
  negative: "#B91C1C"
  paper: "#EEEFF0"
  panel: "#FFFFFF"
  line: "#E4E4E7"
  zinc-50: "#FAFAFA"
  zinc-100: "#F4F4F5"
  zinc-200: "#E4E4E7"
  zinc-300: "#D4D4D8"
  zinc-400: "#A1A1AA"
  zinc-500: "#71717A"
  zinc-700: "#3F3F46"
  zinc-900: "#18181B"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 800
    lineHeight: 0.85
    letterSpacing: "-0.035em"
  heading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.16em"
  figure:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
rounded:
  none: "0px"
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    borderColor: "{colors.line}"
    rounded: "{rounded.lg}"
  panel-hover:
    borderColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
  tag:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.panel}"
    borderColor: "{colors.zinc-300}"
    rounded: "{rounded.md}"
    textColor: "{colors.ink}"
---

# Design System: Hi-Tech Sales Intelligence

## Overview

**Creative North Star: "The Control Room"**

This is the operations console for an industrial-equipment dealer's WhatsApp sales assistant — air compressors, injection-molding machines, technical B2B kit. It is read by sales-ops staff at a desk, mid-workday, scanning what customers ask the bot. So it is built like a **precision instrument**, not a consumer app: hairline-bordered panels on concrete-paper, a faint blueprint grid, monospace figures for every number, and a single hot signal-orange accent used the way a warning lamp is used — sparingly, and only where it means something.

The system **explicitly rejects** the saturated 2025–26 "AI premium" costume it used to wear: Stripe-blurple, animated purple mesh gradients, glassmorphism, gradient-filled everything, and grids of identical soft-shadow cards. Those read as "which AI made this?" The Control Room answers the opposite question — "how was this made?" — through structure, restraint, and committed typography.

**Key Characteristics:**
- Ink-on-paper foundation; structure (borders, rules, weight) carries the identity, not color
- Exactly one accent: hot signal-orange `#F5471D`, ≤ ~8% of any surface
- Two typefaces on a contrast axis: **Archivo** grotesque (UI/display) + **Spline Sans Mono** (all figures, labels, timestamps)
- Hairline-bordered panels, near-sharp corners (6–8px), minimal shadow — instrument, not card
- Static blueprint grid background; no ambient motion
- Restrained, state-conveying motion (count-up on boot, fast hovers)

## Colors

A near-monochrome ink/paper system with a single committed accent. Color is information, never decoration.

### Ink (the dominant role)
- **Ink** (#18181B / zinc-900): primary text, structural borders on emphasis, bars, markers, the primary button, equipment tags. Ink *owns* the page — it is the "color" that carries the brand.

### Accent (the signal)
- **Signal Orange** (#F5471D): the hero pulse ("live"), the active nav underline, the leader bar/marker in any ranked set, the top signal strip, focus rings, button hover, the "Assistant" label. Used like a warning lamp — present but never spread. Target ≤ 8% of surface.
- **Accent Dark** (#D63A12): pressed/hover-deep state, the demo-badge text.

### Semantic (deltas only)
- **Positive** (#16794C, muted emerald) with a ▲ glyph; **Negative** (#B91C1C, alert red) with a ▼ glyph. Always paired with the arrow so meaning never rests on color alone. Kept muted so neither competes with the signal accent.

### Neutrals
- **Paper** (#EEEFF0): the body — a cool concrete off-white (deliberately NOT cream/sand). **Panel** (#FFFFFF): lifts off the paper. **Line** (#E4E4E7 / zinc-200): hairline rules and dividers. **zinc-300** for input borders, **zinc-400/500** for secondary and mono metadata (≥4.5:1 on white).

## Typography

**Two families on a contrast axis** — a grotesque sans against a technical mono. Mono is not costume here; this is literally a technical data tool, so monospace figures read as "instrument," not "developer cosplay."

- **Display** (Archivo, 46px, 800, tracking -0.035em): the single hero readout (Total messages). One per view.
- **Heading** (Archivo, 30px, 800): the page title.
- **Title** (Archivo, 14px, 600): panel headings ("Message volume", "Most asked").
- **Body** (Archivo, 13px, 400): message text, queries, descriptions.
- **Figure** (Spline Sans Mono, 700, tabular): every number that isn't the hero — ledger stats, ranks, counts, axis ticks, tooltip values. Always `tnum`.
- **Label** (Spline Sans Mono, 10px, 500, tracking 0.16em, uppercase): the field-tag voice — panel sub-labels, column headers, metadata, timestamps, the wordmark tagline.

No `clamp()`; fixed rem/px at consistent DPI. The Archivo↔mono split *is* the hierarchy — don't add a third family.

## Elevation

**Structure over shadow.** The system is nearly flat; depth comes from hairline borders and the paper/panel tonal step, not drop shadows.

- **Panels**: 1px zinc-200 border on white, `rounded-lg`. No resting shadow.
- **Hover**: the border sharpens to **ink** (120ms) — a crisp, mechanical response, not a soft lift.
- **Tooltip**: the one deliberate shadow — a hard offset block shadow (`3px 3px 0 rgba(24,24,27,0.12)`) with an ink border, like a printed chip. Used only here.
- No blur, no glassmorphism, no colored glows.

## Components

Every interactive element carries default / hover / focus / active states.

### Panel
- Default: white, 1px zinc-200 border, `rounded-lg`. Hover (opt-in): border → ink.
- Clusters of stats live **inside one panel divided by hairlines** (`divide-x`/`divide-y`), never as separate floating cards. This is the anti-pattern fix for identical-card grids.

### Readout cluster (KPI)
- One panel, asymmetric grid `[1.6fr repeat(3,1fr)]`. First cell is the **hero**: mono label, Archivo display number (count-up on boot), inline accent sparkline, signed delta. Remaining cells are **ledger** readouts: mono label + mono figure. Never four identical cells.

### Button (primary)
- Ink background, white text, `rounded-md`, mono-free Archivo 600. Hover → **accent** background (committed, fast `transition-colors`). Focus-visible: 2px ink ring, offset.

### Tag (avatar)
- Ink square chip (`rounded-sm`/`md`), mono initials, white text. Reads as an equipment label, not a profile photo.

### Inputs
- White, 1px zinc-300 border, `rounded-md`. Focus: border → ink + 2px accent ring at 20%. Placeholder zinc-400 (passes AA).

### Charts
- **Line/area**: single accent stroke (2px), faint accent fill fade, dashed zinc-200 horizontal gridlines (datasheet), mono axis ticks, ink dashed cursor.
- **Bars**: solid ink; the leader (rank 1) in accent. Near-sharp corners (2px). No rainbow, no gradient.

### Tab strip (nav)
- Solid paper bar, ink text, full-height tabs. Active = ink text + a 2px **accent underline** (animated `layoutId`). No pill, no glass.

### Activity log
- Mono timestamps, ink diamond markers (`rotate-45`), latest in accent, hairline row separators. A printout/log feel, not glowing rings.

## Do's and Don'ts

### Do's
- Keep the accent scarce — hero pulse, active state, the single leader in a ranked set, focus. If more than ~8% of a view is orange, pull back.
- Put every number in Spline Sans Mono with tabular figures. Numbers are the product; they should read like an instrument.
- Use hairline borders and the paper/panel tonal step for separation. Let structure do the work.
- Pair the Archivo title with a mono `Label` sub-line for panel headers — that contrast is the house voice.
- Animate the hero number up once on load; keep everything else fast (≤200ms) and state-driven.
- Respect `prefers-reduced-motion` (the count-up and any motion must no-op).

### Don'ts
- **No gradients** — not on text, buttons, avatars, bars, or backgrounds. Solid ink or solid accent only. (Gradient text is an absolute ban; here gradients are out entirely as a house rule.)
- **No glassmorphism / backdrop-blur.** The nav and panels are solid.
- **No side-stripe borders** (`border-left`/`right` > 1px as accent). Use full borders or background tint.
- **No identical card grids.** Stats go in one divided panel; if you're stamping the same icon+label+number cell four times, restructure.
- **No third typeface and no second accent.** The whole system is ink + paper + one orange + two fonts. Adding to it dilutes the identity.
- Don't reintroduce Stripe-blurple, purple mesh, neon, or soft floating shadow cards — that is the exact AI-slop costume this redesign removed.
- Don't drop below 4.5:1 on body text or 3:1 on large text; keep mono metadata at zinc-500 on white.
