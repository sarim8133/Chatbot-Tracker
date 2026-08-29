// Live code for the "Code in JavaScript1" node in Mawavia Whatsapp Chatbot
// (E6Bi8G9MKf8tyVn0). This file is the source of truth — paste it whole.
//
// DO NOT paste the Web Chat version into this node. It ends with
//     session_id: $('Webhook').first().json.body.session_id
// and there is no node called "Webhook" in this workflow — the trigger is
// "WhatsApp Trigger". $() on a name that does not exist THROWS, and that line is
// in the return statement, so it fails on every message and takes the whole bot
// down. That is the only difference between the two files; everything below the
// header is identical.
//
// PREREQUISITE: the AI Agent node must have Options → "Return Intermediate Steps"
// switched ON. Without it the tool results never reach this node, the corpus below
// is empty, and the grounding backstop silently does nothing.
//
// PREREQUISITE 2 (2026-08-29): this node outputs reply_chunks alongside
// reply_text (see "SPLIT FOR WHATSAPP'S HARD 4096-CHAR LIMIT" below). A
// "Split Reply Chunks" node (n8n-nodes-base.splitOut, fieldToSplitOut:
// "reply_chunks", include: "allOtherFields") sits between this node and Send
// Text Message ONLY -- Insert rows in a table, Split Out, Split Out Documents
// and Mark Completed all stay wired directly to this node, so logging/images/
// documents still happen once per turn, not once per WhatsApp message chunk.
// Send Text Message's textBody reads {{ $json.reply_chunks }}, not
// {{ $json.reply_text }}.

// ---- Parse agent output ----
let out = $input.first().json.output;
let parsedData;
if (typeof out === 'string') {
    const m = out.match(/\{[\s\S]*\}/);
    parsedData = m ? JSON.parse(m[0]) : { reply: out, images: [] };
} else if (out && typeof out === 'object') {
    parsedData = (out.reply !== undefined || out.images !== undefined) ? out : (out.output || out);
} else {
    parsedData = { reply: "Here is the information you requested.", images: [] };
}

let replyText = parsedData.reply || "Here is the information you requested.";

// ---- Un-escape literal "\n" ------------------------------------------------
// The agent is told to emit real line breaks, and for short answers it does.
// But when a tool's human_message runs long it stops retyping and copies the
// field straight out of the tool observation -- where the newlines are ALREADY
// JSON escape sequences -- then escapes its own reply again on the way out. Two
// rounds of escaping turn a line break into a backslash and an "n", JSON.parse
// faithfully returns those two characters, and the whole answer lands in
// WhatsApp as one unreadable line. Stock and balance replies are three or four
// lines and never tripped it; a six-order list did.
//
// Fixed here rather than only in the prompt because this is the last point at
// which the reply is still structured data, and -- the same argument the
// grounding backstop below makes -- a prompt rule cannot be enforced by the
// thing it constrains. It runs before the cache INSERT, so a stored reply is
// clean too and a replay cannot resurrect the bug.
//
// Safe to apply unconditionally: a real reply about machines, stock or money has
// no reason to contain a literal backslash-n, and the failure mode if one ever
// did is a line break where a rep expected two characters.
const unescapeBreaks = (s) => String(s)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '    ');
replyText = unescapeBreaks(replyText);
let uniqueImageUrls = Array.isArray(parsedData.images) ? [...new Set(parsedData.images)] : [];

// ---- Turnkey proposal ------------------------------------------------------
// The agent sets this only when search_turnkey_proposal returned status "ok",
// i.e. exactly one proposal matched. A pick-list, a miss, or an unloaded
// catalogue must all leave it empty, so an unsure turn sends words and no file.
const documentFileId = typeof parsedData.document_file_id === 'string'
    ? parsedData.document_file_id.trim()
    : '';
const documentName = typeof parsedData.document_name === 'string'
    ? parsedData.document_name.trim()
    : '';
let droppedDocument = null;

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
// Reply text and image URLs FAIL OPEN: if "Return Intermediate Steps" is off
// there are no tool results here, and blanking every reply would be far worse
// than not checking. FILE IDS FAIL CLOSED -- see the id checks below.
// groundingChecked in the output tells you which mode you were in — if it is
// false in production, the toggle is off and you have no protection.
//
// WhatsApp bold is a single asterisk, the same as the web chat, so the
// "*Model:*" block detection below needs no change between the two channels.
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

// --- 1b. The proposal file id: the same exact test, for a stronger reason ----
// A Drive file id is opaque and exact -- there is no way to derive one, so an id
// that never appeared in a tool result was either invented or lifted from a
// different tool's output. Either way it puts a document nobody chose in front
// of a customer. Dropping it costs one "which one?" round trip; sending it costs
// the wrong proposal. Fails open with the rest of this block: when
// groundingChecked is false there is nothing to check against.
let documentFileIds = [];
if (documentFileId) {
    if (groundingChecked && corpus.includes(documentFileId)) {
        documentFileIds = [documentFileId];
    } else {
        droppedDocument = documentFileId;
    }
}
// ---- Shipment document ------------------------------------------------------
// Same exact-substring grounding check as the turnkey proposal id above, for
// the same reason: a Drive file id is opaque and exact, so one that never
// appeared in a tool result was invented or lifted from a different result.
const shipmentDocumentFileId = typeof parsedData.shipment_document_file_id === 'string'
    ? parsedData.shipment_document_file_id.trim()
    : '';
const shipmentDocumentName = typeof parsedData.shipment_document_name === 'string'
    ? parsedData.shipment_document_name.trim()
    : '';
if (shipmentDocumentFileId) {
    if (groundingChecked && corpus.includes(shipmentDocumentFileId)) {
        documentFileIds.push(shipmentDocumentFileId);
    } else {
        droppedDocument = shipmentDocumentFileId;
    }
}


// --- 2. Model names --------------------------------------------------------
// >>> BEGIN GENERATED FROM scripts/n8n/grounding_scan.js — DO NOT EDIT INLINE
// Edit the source file, run `node --test scripts/n8n/grounding_scan.test.js`,
// then `node scripts/n8n/sync_grounding_scan.js` to write it back here.
// Source of truth for the grounding backstop's model-name scan.
//
// Spliced into the "Code in JavaScript1" node of BOTH workflows by
// sync_grounding_scan.js. Edit HERE, never inline in the workflow JSON:
//   node --test scripts/n8n/            # prove it works
//   node scripts/n8n/sync_grounding_scan.js        # write it into both workflows
//   node scripts/n8n/sync_grounding_scan.js --check # prove they still match
//
// WHY A SECOND PASS EXISTS (2026-08-08). The original scan only inspected blocks
// that OPEN with a bold heading carrying a digit — the "*D100:*" shape a LOOKUP
// answer uses. Comparisons do not use that shape; §6.5 of the system prompt
// mandates "*SPECIFICATIONS* — Tederic D800 vs SOUND UN850EPIII" with the models
// on plain body lines. Every one of those names sat outside the only thing being
// checked, so a comparison could carry an invented model straight to a customer —
// and one did: a "SOUND UN170", whose ladder goes 140 then 180 with nothing in
// between. Comparisons are exactly where invention costs most, because that is
// the answer the rep forwards.
//
// The two passes are deliberately different in what they do about a miss:
//
//   Blocks  — a self-contained "*Model:*" block can be cut out cleanly, so it is.
//   Mentions — a name inside prose or a numbered spec list CANNOT be cut without
//             leaving a mangled sentence or a half comparison, which is worse
//             than the disease. So a mention is only ever REPORTED. That still
//             bites: it feeds `tampered`, which stops the answer being cached
//             (so it can never be replayed the way the HNS answer was) and nulls
//             pdf_content (so it never becomes a document for a customer).
//
// Both passes fail open when there is no corpus — see groundingChecked.

// Normalise away what the catalogue and the agent legitimately disagree about:
// case, spaces, hyphens, dots. "NEO-M1120v" and "neo m1120 V" both become
// NEOM1120V. Note this flattens the corpus into one string, so a code can match
// across a record boundary — that biases us toward MISSING an invention rather
// than destroying a good answer, which is the right way to be wrong here.
function normaliseCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Trailing letters that make a number a MEASUREMENT rather than a model code.
// "8000KN", "100MM", "5060HZ" (from "50/60Hz") are facts about a machine; they
// are never its name, and they are the main thing a naive letters+digits test
// gets wrong.
const MEASUREMENT_UNITS = [
    'KN', 'N', 'MM', 'CM', 'M', 'KM', 'KG', 'G', 'MG', 'T', 'TON', 'TONS', 'OZ', 'LB',
    'KW', 'W', 'KVA', 'V', 'KV', 'A', 'MA', 'HP', 'RPM', 'HZ', 'KHZ', 'MPA', 'PA',
    'BAR', 'PSI', 'L', 'ML', 'CC', 'CM3', 'MM2', 'M2', 'M3', 'S', 'SEC', 'MIN', 'HR',
    'H', 'PCS', 'PC', 'DEG', 'C', 'F', 'K', 'LD', 'KGHR', 'GS',
];

// Leading all-caps words that are units, currencies or materials rather than a
// product line — they must not pair with a following number into a "model code".
// "PKR 90,535,847" is money; "PET 500" is a material and a figure.
const NOT_A_SERIES_PREFIX = new Set([
    'PKR', 'USD', 'EUR', 'GBP', 'AED', 'INR', 'RS', 'RMB', 'CNY',
    'PET', 'PVC', 'UPVC', 'CPVC', 'ABS', 'PP', 'PE', 'HDPE', 'LDPE', 'PS', 'PC', 'PA',
    'POM', 'PMMA', 'TPU', 'EVA', 'WPC', 'SAN',
    'KN', 'MM', 'CM', 'KG', 'KW', 'HP', 'RPM', 'HZ', 'MPA', 'BAR', 'PSI', 'PCS', 'TON',
    'NO', 'QTY', 'ID', 'PO', 'SO', 'GST', 'NTN', 'CNIC', 'AM', 'PM', 'AS', 'AT', 'IN',
    'OF', 'ON', 'TO', 'BY', 'IS', 'IT', 'AND', 'THE', 'FOR', 'PDF', 'SAP', 'AI', 'OK',
]);

const MEASUREMENT_RE = new RegExp('^\\d+(X\\d+)*(' + MEASUREMENT_UNITS.join('|') + ')?$');

// Ordinary words that survive normalisation into something code-shaped once a
// two-digit number is stuck to them: "top-10" -> TOP10, "Phase/50Hz" ->
// PHASE50HZ. The digit-run rule below catches the one-digit forms ("top-3") and
// the pair regex in extractModelCandidates demands caps, which catches the
// spaced forms ("top 10") -- the hyphenated two-digit form takes neither path
// out, which is how a marketing phrase suppressed a whole comparison PDF on
// 12 Aug 2026.
//
// Guard the LEADING LETTER RUN rather than the whole token, so a genuine code
// that merely starts with these letters is untouched. Checked against every
// catalogue workbook (395k tokens): the only collision is "Phase/50Hz" itself,
// which is mains supply, not a machine. If a machine really were called TOP10 it
// would be IN the corpus and so never reported as invented -- meaning the only
// thing this list gives up is flagging an INVENTED machine named after a prose
// word, which is both unlikely and the safe direction to be wrong in. A mention
// is never cut from the reply, only reported.
const NOT_A_MODEL_PREFIX = new Set([
    'TOP', 'TIER', 'RANK', 'LEVEL', 'GRADE', 'CLASS', 'TYPE', 'PHASE', 'STEP', 'STAGE',
    'PAGE', 'ITEM', 'NOTE', 'FIG', 'LINE', 'ROW', 'SLOT', 'UNIT', 'YEAR', 'WEEK', 'DAY',
]);

// The mirror image of NOT_A_MODEL_PREFIX, and the same bug in the other
// direction. That list guards LETTERS-then-digits ("top-10" -> TOP10). This
// guards DIGITS-then-letters: "13-point ejection" normalises to 13POINT, which
// has a letter and a two-digit run and so passed every test above. On
// 25 Aug 2026 it cost a rep the PDF of a 400-ton comparison -- the answer was
// fine, the phrase was "13-point ejection", and an ungrounded mention nulls
// pdf_content. "9-pin", "2-cavity", "4-zone", "3-stage" are all the same shape.
//
// FIRST ATTEMPT, AND WHY IT WAS WRONG. This originally fired on any digit-led
// token whose letters were all lowercase, on the reasoning that catalogue codes
// are capitalised. That measurement was taken against the wrong side: the rule
// runs on the AGENT'S REPLY, where casing is the model's choice, not the
// catalogue's. It let "250xy" and "1200abc" through -- narrow, but a hole in a
// safety control, and mine.
//
// So the test is the trailing WORD, listed explicitly, exactly how
// NOT_A_MODEL_PREFIX is written. Measured against all 4,115 codes in
// data/model_map.json: exactly ONE collides, "100POINT". That code grounds
// normally whenever it is in the corpus; the only thing given up is flagging an
// INVENTED "100POINT", which is the same trade NOT_A_MODEL_PREFIX already
// makes. Re-run that measurement before adding to this list.
const NOT_A_MODEL_SUFFIX = new Set([
    'POINT', 'POINTS', 'PIN', 'PINS', 'CAVITY', 'CAVITIES', 'ZONE', 'ZONES',
    'STAGE', 'STAGES', 'AXIS', 'CORE', 'CORES', 'PLATEN', 'PLATENS', 'STEP',
    'STEPS', 'LAYER', 'LAYERS', 'COLOR', 'COLORS', 'COLOUR', 'COLOURS',
    'DAY', 'DAYS', 'WEEK', 'WEEKS', 'MONTH', 'MONTHS', 'YEAR', 'YEARS',
    'PIECE', 'PIECES', 'SET', 'SETS', 'UNIT', 'UNITS', 'HOLE', 'HOLES',
]);

function isDigitLedProse(token, normalised) {
    if (!normalised || !/^\d/.test(normalised)) return false;
    return NOT_A_MODEL_SUFFIX.has((normalised.match(/[A-Z]+$/) || [''])[0]);
}

// Is this code actually in the corpus, or merely a PREFIX of something that is?
//
// Both passes used a raw `corpusNorm.includes(code)`. The corpus is flattened
// to alphanumerics, so that made every prefix of a real code count as grounded:
// NEO-H170 rode in on NEO-H1700, at a tenth of the tonnage, and rendered onto
// the letterhead for a rep to forward. That is the confusion runbook 2.5 exists
// for, and the scan was blind to it while catching the far less likely case of
// a wholly unrelated invention.
//
// The anchor is deliberately one-sided: the match must not be followed by a
// DIGIT. It cannot require a non-alphanumeric, because the flattening is what
// lets multi-part codes match at all -- the catalogue writes "CONICAL TWIN
// 45/100 SB-PVC SET" and the code 45/100SB runs straight into the next word.
//
// Measured against all 4,115 codes in data/model_map.json: ZERO stop being
// grounded by their own catalogue record. The known residual is a LETTER
// truncation (UN850EPII inside UN850EPIII), which a test records rather than
// leaves to be rediscovered.
function groundedIn(corpusNorm, code) {
    if (!code) return false;
    let at = corpusNorm.indexOf(code);
    while (at !== -1) {
        const after = corpusNorm[at + code.length];
        if (after === undefined || !/[0-9]/.test(after)) return true;
        at = corpusNorm.indexOf(code, at + 1);
    }
    return false;
}

// A model code carries at least one letter AND a run of at least two digits.
// One digit is not enough: "top-3" and "2-cavity" are prose, not machines.
function looksLikeModelCode(normalised) {
    if (normalised.length < 3) return false;
    if (!/[A-Z]/.test(normalised)) return false;
    if (!/\d{2}/.test(normalised)) return false;
    if (MEASUREMENT_RE.test(normalised)) return false;
    if (NOT_A_MODEL_PREFIX.has((normalised.match(/^[A-Z]+/) || [''])[0])) return false;
    return true;
}

// Pull every candidate model code out of a stretch of reply text, as
// {shown, normalised} so a report can quote what the rep would actually read.
function extractModelCandidates(text) {
    const found = [];
    const seen = new Set();
    const push = (shown, normalised) => {
        if (seen.has(normalised)) return;
        seen.add(normalised);
        found.push({ shown, normalised });
    };

    // 1. Single tokens: "UN170", "D170Db", "m900", "HSS-230", "NEO-E850II".
    for (const raw of String(text).split(/\s+/)) {
        const token = raw.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
        if (!token) continue;
        const normalised = normaliseCode(token);
        // Checked here rather than inside looksLikeModelCode because the signal
        // is the ORIGINAL capitalisation, which normalisation has thrown away.
        if (isDigitLedProse(token, normalised)) continue;
        if (looksLikeModelCode(normalised)) push(token, normalised);
    }

    // 2. Split names: "DD 170", "UN 170". A series label is printed in caps, so
    // requiring caps keeps "top 10" and "Type 1" out. The number needs two
    // digits for the same reason.
    const pairRe = /\b([A-Z]{2,6})[  ]+(\d{2,4}[A-Za-z]{0,3})\b/g;
    let m;
    while ((m = pairRe.exec(String(text))) !== null) {
        if (NOT_A_SERIES_PREFIX.has(m[1])) continue;
        const normalised = normaliseCode(m[1] + m[2]);
        if (looksLikeModelCode(normalised)) push(m[1] + ' ' + m[2], normalised);
    }

    return found;
}

// The whole scan. Returns the (possibly repaired) reply plus both verdicts.
//   ungrounded         - invented "*Model:*" blocks, already cut from replyText
//   ungroundedMentions - invented names left in place, for tampered/diagnostics
function scanModelNames(replyText, corpus, groundingChecked) {
    const result = {
        replyText: replyText,
        ungrounded: [],
        ungroundedMentions: [],
        clearImages: false,
    };
    if (!groundingChecked) return result;

    const corpusNorm = normaliseCode(corpus);

    // --- pass 1: whole "*Model:*" blocks, which can be removed cleanly -------
    // The prompt's own format: machines are "*Model Name:*" blocks separated by
    // blank lines. Openers and closers carry no bold heading and are left alone.
    const kept = String(replyText).split(/\n\n+/).filter((block) => {
        const h = block.match(/^\*([^*\n]+?):?\*/);
        if (!h) return true;                   // opener, closer, plain paragraph

        // A model code is the token carrying a digit. "Tederic" is a brand and
        // "Specifications" is a section heading; neither is a code, and a
        // heading with no digit at all is not a machine block.
        const codes = h[1].split(/[\s,/]+/).filter((t) => /\d/.test(t) && normaliseCode(t).length >= 3);
        if (!codes.length) return true;

        // One real code is enough — a heading usually carries brand AND model.
        if (codes.some((c) => groundedIn(corpusNorm, normaliseCode(c)))) return true;

        result.ungrounded.push(h[1].trim());
        return false;
    });

    if (result.ungrounded.length) {
        result.replyText = kept.join('\n\n').trim();

        // If every machine in the reply was invented, the leftovers are just a
        // warm opener wrapped around nothing. Say so plainly instead of
        // shipping an empty message.
        if (!/\*[^*\n]+\*/.test(result.replyText)) {
            result.replyText = "I couldn't find those in our catalog. Could you double-check the model or series name, or tell me what you need (e.g. tonnage range, application type)?";
            result.clearImages = true;
        }
    }

    // --- pass 2: names anywhere else, which can only be reported -------------
    // Runs on what SURVIVED pass 1, so a block already cut is not counted twice.
    for (const c of extractModelCandidates(result.replyText)) {
        if (!groundedIn(corpusNorm, c.normalised)) result.ungroundedMentions.push(c.shown);
    }

    return result;
}

const groundingScan = scanModelNames(replyText, corpus, groundingChecked);
replyText = groundingScan.replyText;
const ungrounded = groundingScan.ungrounded;
const ungroundedMentions = groundingScan.ungroundedMentions;
if (groundingScan.clearImages) uniqueImageUrls = [];
// <<< END GENERATED

// Known limit: if SOME blocks were stripped, the agent's opener may still claim
// a count it no longer delivers ("here are four options"). Rewriting prose
// deterministically is worse than leaving it, so the answer is degraded but
// honest about the machines themselves — and never cached (below).
const tampered = badImages.length > 0 || ungrounded.length > 0 || ungroundedMentions.length > 0;

const imageUrlsJson = JSON.stringify(uniqueImageUrls);

// ============================================================================
// SPLIT FOR WHATSAPP'S HARD 4096-CHAR LIMIT
// ----------------------------------------------------------------------------
// Meta rejects any Send Text Message call whose text.body exceeds 4096
// characters (fbtrace error code 100, "Param text.body must be at most 4096
// characters long") and the whole message is simply never delivered — nothing
// reaches the rep, no partial text, no error visible to them. Execution 20365
// (2026-08-29) hit this: a correct 3-model brand comparison came out to 4539
// characters and silently died at Send Text Message. Because that node is the
// last one on this path, the turn never reached Insert rows in a table either
// — the exchange doesn't even show up in Conversations.
//
// This is a delivery-layer cap, not a content-quality problem — the fix is to
// split into several sequential WhatsApp text messages, not to shorten what
// the agent says. WA_LIMIT sits well under 4096 because JS string length
// counts UTF-16 code units and an astral emoji (🔹 etc.) is 2 of those; the
// margin absorbs that without needing to reason about it per-message.
const WA_LIMIT = 3800;

function chunkReply(text, limit) {
    if (text.length <= limit) return [text];

    // Split on the agent's own paragraph breaks first, so a machine's spec
    // block (or a WHY/SPECIFICATIONS section) never gets torn in half.
    const blocks = text.split(/\n\n+/);
    const chunks = [];
    let cur = '';
    for (const block of blocks) {
        const joined = cur ? cur + '\n\n' + block : block;
        if (joined.length <= limit) { cur = joined; continue; }

        if (cur) chunks.push(cur);

        if (block.length <= limit) {
            cur = block;
        } else {
            // A single block bigger than the whole limit (rare) — hard-wrap
            // on line breaks instead, never mid-word.
            let rest = block;
            while (rest.length > limit) {
                let cut = rest.lastIndexOf('\n', limit);
                if (cut < limit * 0.5) cut = limit; // no usable line break nearby
                chunks.push(rest.slice(0, cut));
                rest = rest.slice(cut).replace(/^\n+/, '');
            }
            cur = rest;
        }
    }
    if (cur) chunks.push(cur);
    return chunks;
}

// (i/n) marker only when there actually is more than one message, so a normal
// reply is untouched.
const rawChunks = chunkReply(replyText, WA_LIMIT);
const replyChunks = rawChunks.length > 1
    ? rawChunks.map((c, i) => `${c}\n\n(${i + 1}/${rawChunks.length})`)
    : rawChunks;

// ---- PDF content (any register the agent judged document-worthy) ----------
// Captured once, in this SAME generation pass, per the "no second pass" design
// (see the briefing-pdf-export design doc): "send as PDF" later reads this back
// verbatim rather than asking the model to reconstruct anything, so it can never
// drift from what the rep already read on WhatsApp. Whether this turn gets one
// is entirely a prompt-level judgment call (system prompt §3.6) -- this code
// does not check register, it only checks that the model actually populated it.
//
// image_urls is deliberately the post-backstop uniqueImageUrls, not a second
// list the agent invented — a PDF built from an ungrounded image url would
// defeat the entire point of capturing structured content grounded the same
// way as the reply.
//
// If the backstop had to repair anything this turn (an invented model, a bad
// image), the pdf_content captured in the same pass is not proven clean either
// — it was produced by the same generation that got the reply wrong. This is
// GATE 3 (below) applied to the second field: nothing we had to repair is fit
// to be handed to a customer as a forwardable document.
// The DOCUMENT register (system prompt 3.6) has the agent relay a tool's
// human_message "lines exactly", and the renderer draws its OWN bullet for every
// entry in a section's bullets array. So a relayed line that already carries its
// own "•" or "1." arrives double-marked, and the blank spacer lines between
// groups arrive as bullets with nothing after them -- which is exactly how the
// 08 Aug 2026 Karim Containers statement came out. Strip the marker the renderer
// is about to redraw rather than asking the model to remember not to emit one:
// deterministic beats hopeful, and it holds even when a tool changes its layout.
function tidyBullet(s) {
    return String(s == null ? '' : s)
        // The model escapes quotes inside the JSON string value and they survive
        // all the way into the PDF as \"Still open\".
        .replace(/\\"/g, '"')
        // One leading marker only. "-" and "*" count as markers only when a space
        // follows, so a negative figure survives and "**SUMMARY**" keeps both of its
        // bold asterisks -- the renderer honours **bold**, and eating one wrecks it.
        .replace(/^\s*(?:[•·]|[-*](?=\s)|\d+\.)\s*/, '')
        .trim();
}

let pdfContent = null;
if (!tampered && parsedData.pdf_content && typeof parsedData.pdf_content === 'object') {
    const rawSections = Array.isArray(parsedData.pdf_content.sections) ? parsedData.pdf_content.sections : [];
    pdfContent = {
        title: parsedData.pdf_content.title,
        sections: rawSections.map(sec => Object.assign({}, sec, {
            bullets: (Array.isArray(sec && sec.bullets) ? sec.bullets : [])
                .map(tidyBullet)
                .filter(Boolean),
        })),
        table: parsedData.pdf_content.table || null,
        image_urls: uniqueImageUrls
    };
}

// Diagnostic only, since 2026-08-26. This used to be GATE 4 of the semantic
// cache -- "nothing that came from live SAP is ever cacheable", for two
// independent reasons: a replayed SAP number is stale on arrival, and a stored
// balance would be served to reps the SAP-side scoping would have refused. The
// cache is gone, so the gate is gone with it; the flag itself stays because
// sapLiveAnswer below is the only signal that separates "this answer came from
// live SAP" from "the check never ran".
const sapLive = /human_message|rows_by_category|resolved_codes|sellable_|available_credit|credit_limit|card_code|last_payment|total_owed/.test(corpus);

return {
    json: {
        reply_text: replyText,
        // What Send Text Message actually sends — 1 entry for a normal reply,
        // 2+ for one over WA_LIMIT. reply_text above stays the full, unsplit
        // text: that's what gets logged to Insert rows in a table, not the
        // per-message slices.
        reply_chunks: replyChunks,
        image_urls: uniqueImageUrls,
        image_urls_json: imageUrlsJson,
        // Split Out feeds the Drive download from this. An empty array produces
        // zero items, so the download and the document send are skipped
        // entirely -- the same mechanism image_urls already relies on.
        document_file_ids: documentFileIds,
        document_name: documentName || shipmentDocumentName,
        // The WhatsApp counterpart of the web node's session_id. Send Text
        // Message and Insert rows both read the number straight off the trigger
        // rather than from here, so this is carried for parity and for anything
        // added later — but it must NOT be the web version's $('Webhook') line.
        user_phone: $('WhatsApp Trigger').first().json.messages[0].from,
        // Captured document-worthy structure for "send as PDF" -- read back
        // verbatim by the export_pdf sub-workflow, never regenerated. null when
        // the model judged this turn had nothing document-worthy, or when the
        // backstop had to repair the reply this turn.
        pdf_content: pdfContent,
        // Diagnostics — visible in the n8n execution, and the only way to tell
        // "nothing was invented" from "the check never ran".
        groundingChecked,
        sapLiveAnswer: sapLive,
        ungroundedModels: ungrounded,
        // Names left in place because cutting them would mangle the prose --
        // reported only, but they still set tampered above, so the answer is
        // neither cached nor turned into a PDF.
        ungroundedMentions,
        droppedImages: badImages,
        droppedDocument
    }
};
