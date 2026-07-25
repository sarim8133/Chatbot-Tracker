# SCR: two documents, two sets of dimensions — RESOLVED

> ✅ **Settled 2026-07-25.** Hi-Tech asked SCR: the **booklet is the current
> revision**. Its dimensions were adopted on the 58 dedicated records that had a
> booklet counterpart, in place, changing nothing else — verified byte-identical
> once the dimension field is masked out. The 34 models the booklet never mentions
> keep their catalogue dimensions, because there is nothing to adopt for them.
> Applied by `rag/scr_apply_booklet_dims.py`; restore point in
> `backups/scr-booklet-dims-backup.json`.

**Nothing here was a bug in the pipeline — both readings were correct
transcriptions of what is printed.**

SCR ships the same compressors in two publications, and they disagree about
overall dimensions:

| model | 14-page booklet | dedicated catalogue |
|---|---|---|
| SCR100APM-10 | 1800\*1200\*1550 | 1800\*1300\*1550 |
| SCR75APM-* | 1800\*1200\*1550 | 1800\*1300\*1550 |
| SCR60APM-* | 1300\*950\*1370 | 1320×975×1250 |
| SCR50APM-* | 1300\*900\*1270 | 1320×975×1250 |
| SCR40APM-* | 1200\*800\*1100 | 1180×800×1110 |
| SCR30APM-* | 1200\*800\*1150 | 1180×800×1110 |
| SCR20EPM-7 | 1200\*800\*1100 | 1400×820×1150 |

Verified by reading the source pages directly (`SCR Compressor_Booklet.pdf` p7
and p9; `100APM.pdf` p9; `EPM, EPM2.pdf`). Every other column — kW, HP, capacity,
pressure, weight, connection size — agrees. Only the dimensions move.

Most likely these are different revisions of the same machines, or cabinet
variants. Someone at SCR should be asked which is current before a rep quotes a
footprint to a customer with a fixed plant layout.

## What was done in the meantime

The **dedicated catalogues win**, on two grounds that do not depend on resolving
the conflict:

1. They cover 34 models the booklet never mentions — SCR4APM through SCR20APM,
   and every `T-D` variant.
2. They are what has been live and quoted from for months. Silently changing a
   dimension under a rep who has already sent it out is worse than leaving a
   disputed number in place.

So the 64 booklet records that duplicated them were deleted, after first copying
across the one thing the booklet had and they lacked — `machine_type`:

- `SCR APM Screw Air Compressor` (59) → Permanent-magnet variable-speed-drive (PM VSD) screw air compressor (APM series)
- `SCR EPM / EPM2` (39) → Permanent-magnet variable-speed-drive (PM VSD) screw air compressor (EPM/EPM2 series)

Both descriptions are **printed**, not inferred: booklet p7 is headed
"APM SERIES / PM VSD" with "IE4 efficiency permanent magnet motor" and "High
performance airend"; p9 is "EPM/EPM2 SERIES / EPM 2 Technology PM VSD" with the
same motor line. An airend is a screw element.

The booklet keeps the **43 records that are its own**: the H/HV series
(SCR180H–SCR400H), the LH/LHPM series (SCR530LHPM–SCR2200LHPM), and
`Booster Air Compressor`, which is the only record anywhere in the namespace that
mentions a booster.

Backup: `rag/backups/scr-dedupe-backup.json` holds both the 98 records that were
re-typed and the 64 that were deleted, with full metadata.

If the booklet ever turns out to be the current revision, the fix is to update the
dimension line on the dedicated records — not to re-ingest the booklet, which
would reintroduce the duplication and still miss 34 models.
