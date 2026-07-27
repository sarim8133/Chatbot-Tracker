// Live code for the "Code in JavaScript1" node in Hi-Tech Web Chat (JOBpBMBz05ZVmQ79).
// This file is the source of truth — paste it whole rather than patching in place.
//
// PREREQUISITE: the AI Agent node must have Options → "Return Intermediate Steps"
// switched ON. Without it the tool results never reach this node, the corpus below
// is empty, and the grounding backstop silently does nothing.

// ---- Parse agent output ----
let out = $input.first().json.output;
let parsedData;
if (typeof out === 'string') {
    const m = out.match(/\{[\s\S]*\}/);
    parsedData = m ? JSON.parse(m[0]) : { reply: out, images: [], cacheable: false };
} else if (out && typeof out === 'object') {
    parsedData = (out.reply !== undefined || out.images !== undefined) ? out : (out.output || out);
} else {
    parsedData = { reply: "Here is the information you requested.", images: [], cacheable: false };
}

let replyText = parsedData.reply || "Here is the information you requested.";
let uniqueImageUrls = Array.isArray(parsedData.images) ? [...new Set(parsedData.images)] : [];

// ============================================================================
// GROUNDING BACKSTOP
// ----------------------------------------------------------------------------
// The system prompt forbids inventing a model name or a URL. On 2026-07-27 it
// did both anyway: asked for "all tederic series one machine each" the agent
// decided from training data what Tederic's series are, searched for each one,
// and reported a "Tederic DH510" that does not exist. What makes that land as a
// confident answer is that a vector search is NEVER empty — querying a series
// that does not exist still returns real machines from other series, which the
// agent reads as confirmation. The tool launders the invention.
//
// A prompt rule cannot be enforced by the thing it constrains. This compares
// the finished reply against what the tools actually returned, which is the one
// place the question has a yes/no answer.
//
// It FAILS OPEN. If "Return Intermediate Steps" is off, there are no tool
// results here, and blanking every reply would be far worse than not checking.
// groundingChecked in the output tells you which mode you were in — if it is
// false in production, the toggle is off and you have no protection.
// ============================================================================

const steps = [];
for (const item of $input.all()) {
    const j = item.json || {};
    const s = j.intermediateSteps || (j.output && j.output.intermediateSteps);
    if (Array.isArray(s)) steps.push(...s);
}

// Every character the tools returned this turn, as one blob. Which tool said it
// does not matter — only whether the catalogue said it at all.
let corpus = '';
for (const s of steps) {
    try {
        corpus += '\n' + JSON.stringify(s && s.observation !== undefined ? s.observation : s);
    } catch (e) { /* unserialisable step — skip it rather than fail the turn */ }
}
const groundingChecked = corpus.length > 0;

// --- 1. Images: an exact substring test, because a URL is exact -------------
const badImages = groundingChecked ? uniqueImageUrls.filter(u => !corpus.includes(u)) : [];
if (badImages.length) {
    uniqueImageUrls = uniqueImageUrls.filter(u => corpus.includes(u));
}

// --- 2. Model names --------------------------------------------------------
// Normalise away what the catalogue and the agent legitimately disagree about:
// case, spaces, hyphens, dots. "NEO-M1120v" and "neo m1120 V" both become
// NEOM1120V. Note this flattens the corpus into one string, so a code can match
// across a record boundary — that biases us toward MISSING an invention rather
// than destroying a good answer, which is the right way to be wrong here.
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const corpusNorm = norm(corpus);

// The prompt's own format: machines are "*Model Name:*" blocks separated by
// blank lines. Openers and closers carry no bold heading and are left alone.
//
// The whole scan is inside the groundingChecked guard on purpose. With an empty
// corpus every model looks invented, so running it anyway would fill the
// diagnostics with false positives and — via tampered, below — quietly stop
// caching every answer in the workflow. Failing open has to mean not looking.
const ungrounded = [];
if (groundingChecked) {
    const kept = replyText.split(/\n\n+/).filter(block => {
        const h = block.match(/^\*([^*\n]+?):?\*/);
        if (!h) return true;                   // opener, closer, plain paragraph

        // A model code is the token carrying a digit. "Tederic" is a brand and
        // "Specifications" is a section heading; neither is a code, and a
        // heading with no digit at all is not a machine block.
        const codes = h[1].split(/[\s,/]+/).filter(t => /\d/.test(t) && norm(t).length >= 3);
        if (!codes.length) return true;

        // One real code is enough — a heading usually carries brand AND model.
        if (codes.some(c => corpusNorm.includes(norm(c)))) return true;

        ungrounded.push(h[1].trim());
        return false;
    });

    if (ungrounded.length) {
        replyText = kept.join('\n\n').trim();

        // If every machine in the reply was invented, the leftovers are just a
        // warm opener wrapped around nothing. Say so plainly instead of
        // shipping an empty bubble.
        if (!/\*[^*\n]+\*/.test(replyText)) {
            replyText = "I couldn't find those in our catalog. Could you double-check the model or series name, or tell me what you need (e.g. tonnage range, application type)?";
            uniqueImageUrls = [];
        }
    }
}

// Known limit: if SOME blocks were stripped, the agent's opener may still claim
// a count it no longer delivers ("here are four options"). Rewriting prose
// deterministically is worse than leaving it, so the answer is degraded but
// honest about the machines themselves — and never cached (below).
const tampered = badImages.length > 0 || ungrounded.length > 0;

const imageUrlsJson = JSON.stringify(uniqueImageUrls);

// ---- GATE 1: deterministic backstop (free, predictable) ----
const userMessage = ($('Guardrails').first().json.guardrailsInput || "").trim().toLowerCase();
const stop = ["yes","no","ok","okay","sure","yeah","nope","haan","han","ji","jee","nahi","nai","g","acha","achha","theek","thik","done","k"];
const bareConfirmation = stop.includes(userMessage.replace(/[^\w]/g, ""));

// ---- GATE 2: agent judgment (defaults false if the flag is missing) ----
const agentCacheable = parsedData.cacheable === true;

// ---- GATE 3: nothing we had to repair is fit to be replayed to someone else.
// A cached bad answer is served BEFORE the agent runs, so it would outlive any
// prompt fix.
const storeable = !bareConfirmation && agentCacheable && !tampered;

// ---- Build the cache INSERT here, so n8n never comma-splits the values ---
const escSql = (s) => String(s ?? '').replace(/'/g, "''");
const embedding = $('Embed Query').first().json.embedding.values;
const vectorLiteral = '[' + embedding.join(',') + ']';

const insert_sql =
  "INSERT INTO semantic_cache (query_embedding, query_text, reply_text, image_urls) VALUES (" +
  "'" + vectorLiteral + "'::vector, " +
  "'" + escSql($('Guardrails').first().json.guardrailsInput) + "', " +
  "'" + escSql(replyText) + "', " +
  "'" + escSql(imageUrlsJson) + "')";

return {
    json: {
        reply_text: replyText,
        image_urls: uniqueImageUrls,
        image_urls_json: imageUrlsJson,
        session_id: $('Webhook').first().json.body.session_id,
        from_cache: false,
        storeable,
        insert_sql,
        // Diagnostics — visible in the n8n execution, and the only way to tell
        // "nothing was invented" from "the check never ran".
        groundingChecked,
        ungroundedModels: ungrounded,
        droppedImages: badImages
    }
};
