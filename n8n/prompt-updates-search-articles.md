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

```
- De-duplicate by model: results may contain more than one record for the same machine — a specification record and a standard/optional equipment record share a model_name and an image_url. Treat them as ONE machine. Merge their content into a single entry, and include that machine's image_url exactly ONCE. The image count in §7 counts machines, never records.
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
