# Patches for the "HiTech Machinery Lookup Assistant" prompt

Three edits, against the rewritten system message (the one with numbered rule
precedence). Each exists because the DATA changed under the prompt, not because
the prompt was badly written.

---

## 1. §4 Routing — articles are no longer concepts-only

**Why.** §4 currently ends:

> Quick reference: machines/models/specs → search_pinecone. Concepts/how/why/background → search_articles.

That split was true of 61 blog posts. The `knowledge` namespace now also holds the
research compendium, which contains *High Tech-600HH High Speed Injection Moulding
Machine*, *HiTech Plastic PET Preform Molding Machine*, the *APM compressor series*
overview and *Decoding the Pricing of Injection Molding Machines in Pakistan* —
machine families, spec talk and pricing. A rule that says articles are concepts-only
means the tool never gets called for the open-ended questions it answers best:
"which machine suits my product", "what drives the price", "what makes APM efficient".

**Replace that last bullet of §4 with:**

```
- Quick reference: a SPECIFIC model — its specs, price, or availability → search_pinecone, and its numbers are final. Concepts, how/why, background, and "which TYPE of machine suits my product" → search_articles. Open-ended, comparison, or "which should I buy" questions → call BOTH, then lead with the catalogue's numbers and cite the article's source_url for the reasoning. Numbers from training data → never.
- The catalogue also knows what a machine DOES, not just what it measures: process family, automation level, clamp design, what it produces. A user describing a machine by behaviour ("air-cooled screw chiller", "heatless desiccant dryer", "two-platen") can be answered by search_pinecone directly.
```

The second bullet is new capability, not a correction: `machine_type` went from 138
records to 1,598 (90% of the namespace), so behavioural queries now retrieve properly.

---

## 2. §6 Filtering — collapse duplicate records for one machine

**Why.** Tederic brochures print each machine's spec table early and a shared
standard/optional equipment list at the back covering a whole span of models. Those
lists were attached to each member machine as a SEPARATE record, because merging them
into the spec record halved the weight of the clamping numbers and broke spec search.

The consequence for this prompt: **128 equipment records carry the same `model_name`
AND the same `image_url` as their spec record.** One query can return `NEO-T90` twice.
Under §7 ("if 3 machines are discussed, images MUST contain 3 URLs") that becomes
either the same machine listed twice or the same URL emitted twice.

**Add to §6:**

> ⚠️ **Corrected 2026-07-25.** The first version of this bullet cost images and
> caused invented URLs. It said equipment records "share a model_name and an
> image_url" without saying how to DECIDE two results are the same machine, so the
> agent merged aggressively — `D210Db Type 1` with `D210Db Type 2`, `NEO-T90` with
> `NEO-T90II` — and every wrong merge dropped an image. Use the wording below,
> which makes the test an exact string match, and apply the §7 patch with it.

```
- De-duplicate by model: two results are the SAME machine ONLY when their model_name strings are identical, character for character. This happens because one machine can have both a specification record and a standard/optional equipment record; those carry the same model_name and the same image_url. Merge those into a single entry and use that image_url once. NEVER merge results whose model_name differs in any way — NEO-T90 and NEO-T90II are different machines, and so are D210Db Type 1 (m150) and D210Db Type 2 (m150). When in doubt, treat them as separate.
```

---

## 2b. §7 — images must be copied, never constructed

**Why.** §7 says *"Image count must match: if 3 machines are discussed, images MUST
contain 3 URLs."* That is a hard count mandate with no escape hatch. The moment the
agent has fewer URLs than machines — because a record genuinely has no `image_url`,
or because it merged two records — the only way to satisfy `MUST` is to fabricate
one. And nothing in the prompt forbids it: §2 grounds *facts and numbers*, and a URL
reads like neither.

**Replace the "Image count must match" bullet in §7 with:**

```
- Images: every URL in the images array must be copied character-for-character from an image_url field in a tool result. NEVER construct, guess, complete, shorten or edit a URL, and never assemble one from a pattern you have seen. If a machine you discuss has no image_url in the results, omit it from images — a shorter images array is always correct, an invented URL never is.
- Aim for one image per machine discussed, in the same order the machines appear in the reply. This is a target, not a licence to invent: if you can only supply 2 URLs for 3 machines, send 2.
```

---

## 3. §2 Grounding — one sentence worth adding

**Why.** A cached reply once described MG-SSH2L as "semi-automatic". A namespace-wide
check now confirms **no record anywhere describes a semi-automatic machine**, and 62
describe fully automatic ones. That description was invented. §2 already forbids
inventing numbers; automation level, process family and clamp design are the same
class of claim and are worth naming, because they read like description rather than
data and slip through.

**Add to §2:**

```
- A machine's TYPE is a product fact, not a description: automation level (semi-automatic / fully automatic), process family (extrusion vs injection blow), and layout (rotary / linear / toggle / two-platen) must come from a tool result exactly like a number does. If the results do not state it, do not assert it — and never infer it from the model code.
```

---

## Not a prompt change: what to ask SCR

`rag/scr-source-conflict.md` — the booklet and the dedicated catalogues print
different dimensions for the same compressors. Both readings are correct; SCR
publishes both. Worth settling before a footprint is quoted into a fixed plant layout.
