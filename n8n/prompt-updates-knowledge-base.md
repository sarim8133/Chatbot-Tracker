# n8n changes: expose the Knowledge Base articles to the bot

The 61 Knowledge Base blog posts are now in Pinecone `hitech-v2`, namespace **`knowledge`**
(191 chunks). They are in a SEPARATE namespace from the 1,888 machine records so that article
prose can never compete with spec tables in a machine lookup.

The bot cannot see them until you add a second tool node. 3 edits.

---

## 1. Add the new tool node (Web Chat, and WhatsApp if you want it there too)

In the n8n canvas:

1. Right-click the existing **Search Pinecone** node -> **Duplicate**.
2. Rename the copy to **Search Articles**.
3. Open it and change ONLY these:
   - **Pinecone Namespace** (under Options): `hitech` -> **`knowledge`**
   - **Description of data** (toolDescription): replace with the text in section 2 below.
   - Leave index (`hitech-v2`), topK (10), and reranker as they are.
4. Connect its **ai_tool** output to the **AI Agent** (same as Search Pinecone).
5. Connect the SAME `Embeddings Google Gemini` and `Reranker Cohere` sub-nodes to it
   (drag from their outputs to the new node — sub-nodes can feed both tools).

Result: the agent now has two tools — `search_pinecone` (machines) and `search_articles` (guides).

---

## 2. "Search Articles" -> Description of data (toolDescription)

```
Use this tool to search HiTech Machinery's published knowledge-base articles: technical explainers, how-to guides, and industry background. Call it for CONCEPTUAL and EDUCATIONAL questions - how something works, why one option differs from another, how to calculate something, what a term means, industry history, material properties, or how to start manufacturing a particular product. Examples: "how do I calculate clamping force?", "hydraulic vs electric injection molding", "what are the parts of an injection molding machine?", "what is the clamp factor for ABS?", "how do I start a thin-wall food container business?". Each result includes model_name (the article title), text (the article passage), and source_url (the article link). This tool does NOT contain machine models, prices, or spec sheets - for those you MUST use the machinery catalogue tool instead. When you answer from this tool, cite the source_url at the end of your reply so the user can read the full article.
```

---

## 3. AI Agent -> System Message -> KNOWLEDGE BOUNDARIES

You already replaced this block once (for the General Information guides). Replace it again with
this version, which adds the articles tool. It is a superset — it keeps the screw-guide routing.

```
KNOWLEDGE BOUNDARIES
🔹 COMPANY DATA (specific machines, models, specs, prices, availability, recommendations): You have ZERO internal knowledge. Never invent or recall a company machine, model name, specification, or number from training data. For ANY request about a specific machine, a recommendation, or a spec, you MUST call search_pinecone and answer ONLY from its results.
🔹 TECHNICAL / PROCESS GUIDANCE (how to choose or apply equipment, e.g. "which screw diameter for thin wall parts?", "what happens to injection pressure if screw diameter increases?"): The catalogue index also contains company reference guides (catalogue = "General Information"). You MUST call search_pinecone FIRST. If a General Information guide is returned, answer ONLY from that guide and include its image_url in the images array.
🔹 CONCEPTS, HOW-TO AND BACKGROUND (how something works, why options differ, how to calculate something, what a term means, material properties, industry history, how to start manufacturing a product): Call search_articles. These are answered from HiTech's published knowledge-base articles. Answer ONLY from the returned article text, and end your reply with the article's source_url so the user can read more. Do NOT put source_url in the images array - it is a link, not an image; the images array stays empty for article answers.
🔹 GENERAL KNOWLEDGE: Only if BOTH tools return nothing relevant may you define a plain term in 1-3 sentences from general engineering knowledge. You must NEVER state a specific number, ratio, dimension, threshold or spec from training data (for example, never assert "L/D is typically 25:1"). Every number you output must come from a tool result.
RULE OF THUMB: Machines, models, specs -> search_pinecone. Concepts, how-to, why, background -> search_articles. Numbers from training data -> never.
```

---

## 4. Retest

Ask the web chat these and check the behaviour:

| Ask | Expect |
|---|---|
| "how do I calculate clamping force for an ABS part?" | Formula + worked example from the article, ending with the article link. No machine models. |
| "hydraulic vs electric injection molding machines?" | Comparison from the article + link. |
| "Tederic DT-250 specs" | Machine spec sheet + spec image. NO article link — proves the split works. |
| "what screw diameter for thin wall parts?" | The screw-diameter guide + its image (unchanged from before). |

Red flags: an article link attached to a machine spec answer, a machine model quoted in an
article answer, or any number that is not in a tool result.

---

## Note on the semantic cache

Cached replies are served BEFORE the agent runs. Any question you already asked and got a bad
answer for will keep returning the old answer until its row is deleted:

```sql
select id, query_text, left(reply_text, 80) from semantic_cache
where query_text ilike '%clamping force%';
-- delete the rows you want regenerated
```
