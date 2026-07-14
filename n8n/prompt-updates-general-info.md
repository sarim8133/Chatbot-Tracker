# Prompt changes: make the agent use the General Information guides

Why: the agent answered "which screw diameter for thin-wall parts?" from training data
(inventing "L/D typically 25:1") and never called search_pinecone, because the prompt
classified it as a GENERAL CONCEPT. The index now contains reference guides
(catalogue = "General Information"), so these questions must route to the tool.

Apply in the n8n UI. 4 edits + 1 SQL.

---

## 1. Web Chat -> "AI Agent" node -> System Message

REPLACE the whole `KNOWLEDGE BOUNDARIES` block (everything from `KNOWLEDGE BOUNDARIES`
up to but NOT including `EXACT MATCH FILTERING RULE`) with:

```
KNOWLEDGE BOUNDARIES
🔹 COMPANY DATA (specific machines, models, specs, prices, availability, recommendations): You have ZERO internal knowledge. Never invent or recall a company machine, model name, specification, or number from training data. For ANY request about a specific machine, a recommendation, or a spec, you MUST call search_pinecone and answer ONLY from its results.
🔹 TECHNICAL / PROCESS GUIDANCE (how to choose or apply equipment, e.g. "which screw diameter for thin wall parts?", "what happens to injection pressure if screw diameter increases?", "what shot volume should I run?", "which screw for HDPE crates?"): The index ALSO contains company reference guides — their catalogue is "General Information". These questions are NOT general concepts. You MUST call search_pinecone FIRST. If a General Information guide is returned, answer ONLY from that guide and include its image_url in the images array. Never answer these from training data when a guide exists.
🔹 GENERAL CONCEPTS (plain terminology only, e.g. "what does clamping force mean?", "what is tonnage?", "hydraulic vs electric injection molding"): You MAY define the term in 1-3 sentences from general engineering knowledge to help new sales staff learn — but ONLY after search_pinecone has returned nothing relevant. You must NEVER state a specific number, ratio, dimension, threshold or spec from training data (for example, never assert "L/D is typically 25:1"). Every number you output must come from a tool result. After explaining a concept, proactively end with: "Would you like me to search for machines with [that property]?"
RULE OF THUMB: Defining a word, with no numbers = allowed. Any number, spec, selection rule, or recommendation = tool only.
```

---

## 2. Web Chat -> "AI Agent" node -> System Message -> CACHEABILITY RULE

The current rule lets a pure general-knowledge answer be cached, which is how the bad
screw answer got stored. REPLACE point 2 with:

```
2. Stable & reusable - the answer came from a search_pinecone result (a machine record or a General Information guide). Set false when you returned an "I couldn't find [model] / double-check the name" fallback, since the catalog changes and the miss is often a user typo. Set false when you answered a general concept from your own knowledge WITHOUT a tool result - those must never be cached.
```

---

## 3. Web Chat AND WhatsApp -> "Search Pinecone" node -> Description of data (toolDescription)

REPLACE the whole description with:

```
Use this tool to search the company machinery catalogues AND the company's technical reference guides. Call it whenever the user asks for equipment recommendations, specific machine models, technical specifications, OR any process/selection guidance (e.g. which screw diameter to use, L/D ratio, shot weight, clamping force sizing, material suitability, thin-wall molding, cycle time). This tool searches the Pinecone vector database and returns the best matching records. Each result includes the model_name, a highly accurate summary of the specifications or guide content, and the image_url linking to the spec sheet or reference chart. Use the returned data to write your reply, and use the image_url to populate the images array in your final JSON output. NOTE: results whose catalogue is "General Information" are company reference guides, not purchasable machines — present them as technical guidance and still show their image_url.
```

---

## 4. WhatsApp -> "AI Agent" node -> System Message

ADD this line at the end of the `KNOWLEDGE BOUNDARIES ZERO INTERNAL KNOWLEDGE` paragraph
(before `EXACT MATCH FILTERING RULE`):

```
TECHNICAL / PROCESS GUIDANCE: The index ALSO contains company reference guides (their catalogue is "General Information") covering how to choose and apply equipment - e.g. "which screw diameter for thin wall parts?", "what happens to injection pressure if screw diameter increases?", "what shot volume should I run?". These are NOT general knowledge questions: call search_pinecone and answer ONLY from the returned guide, including its image_url in the images array.
```

---

## 5. Purge the poisoned cache row (REQUIRED)

The hallucinated answer is already in `semantic_cache`. Until it is deleted, any question
within 0.90 cosine of it is served the old answer and the agent never runs — so the prompt
fix alone will NOT fix the bot. Run in the Supabase SQL editor:

```sql
delete from semantic_cache
where id = '3641f06d-a4b5-4739-bfd2-f760fbe41fbf';
```

To confirm it is the right row first:

```sql
select query_text, reply_text from semantic_cache
where id = '3641f06d-a4b5-4739-bfd2-f760fbe41fbf';
-- expect: "what screw diameter for thin-wall parts?" / the "L/D ... 25:1" answer
```

---

## 6. Retest

Ask the web chat: **"what screw diameter for thin-wall parts?"**

Expect: an answer sourced from the guide (small screw, Ø25-50 mm, PC/PA/POM/PBT/PMMA/ABS/PPS/LCP/TPU/TPE,
precision + thin wall parts), WITH the guide image attached:
`.../catalouge-images/General_Information/Screw_Diameter_Selection_Guide_Injection_Molding.jpeg`

Red flags that it is still broken: no image in the reply, or any number that is not in the guide
(e.g. "25:1").
