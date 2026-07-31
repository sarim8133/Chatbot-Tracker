// Download helpers: CSV, safe filenames, and a minimal ZIP writer.
//
// WHY A HAND-ROLLED ZIP AND NOT JSZip
//
// Everything we put in a zip here is a receipt photo — JPEG, already compressed.
// DEFLATE buys ~0-2% on those and costs a ~100KB dependency plus a supply-chain
// surface on a page that handles financial records. So this writes STORE-only
// (method 0) zips: the archive is the sum of its files plus ~80 bytes of header
// each. Every OS unzipper reads them.
//
// Deliberately NOT ZIP64, which caps an archive at 4GB and 65535 entries. The
// caller enforces MAX_ZIP_FILES well below that; a receipt is ~500KB, so the
// real ceiling is the phone's memory long before the format's.

// ── CSV ───────────────────────────────────────────────────────────────────────
// Neutralize spreadsheet formula injection (CWE-1236): a cell starting with
// = + - @ (or tab/CR) can execute as a formula when opened in Excel/Sheets.
// Prefix with an apostrophe so it's forced to plain text.
//
// This matters more here than anywhere else in the app: vendor names are OCR'd
// off a photo the submitter chose, so the text in that cell is attacker-typed
// in the most literal sense — someone can write a formula on a paper receipt.
//
// The plain-number exemption is load-bearing for the receipt export: a refund
// exports as "-1500", which the guard would otherwise quote into text and
// silently drop out of every SUM() in the accountant's spreadsheet. A leading
// minus followed by nothing but digits cannot be a formula.
//
// Shared with xlsx.js's cell writer — the trigger characters are an Excel/
// Sheets formula-engine property, not something specific to CSV's container,
// so both writers guard against the same rule from this one place.
export function guardFormula(s) {
  return (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
}

// Quote fields containing commas, quotes, or newlines (double internal quotes).
export const csvCell = v => {
  const s = guardFormula(v == null ? '' : String(v));
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// columns: [{label, get(row)}]. Prepends a BOM so Excel reads UTF-8 (emoji) right.
export function buildCSV(columns, rows) {
  const head = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(c.get(r))).join(',')).join('\n');
  return '﻿' + head + '\n' + body;
}

export function exportCSV(name, columns, rows) {
  const blob = new Blob([buildCSV(columns, rows)], { type: 'text/csv;charset=utf-8;' });
  saveBlob(blob, `hitech-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Saving ────────────────────────────────────────────────────────────────────
// The <a download> dance. Note for anyone auditing the CSP in vercel.json: this
// is a download, not a navigation, so no fetch directive governs it — but that
// is also why it can only be proven in production, where the headers exist at
// all (they are absent in both `vite dev` and `vite preview`).
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately races the download in older Safari; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Filenames ─────────────────────────────────────────────────────────────────
// Reduce arbitrary text to something every filesystem and unzipper accepts.
//
// Vendor and employee names reach this straight from OCR, so treat them as
// hostile: a name containing "/" or ".." would otherwise write outside the
// extraction directory (zip-slip) on a careless unzipper. Restricting to a
// known-good alphabet — rather than blacklisting separators — closes that, plus
// Windows' reserved characters and trailing-dot rule, in one pass.
//
// The allow-list is letters/digits/marks in ANY script, not just ASCII. An
// ASCII-only rule reduced "محمد" and every Urdu vendor name to "untitled",
// which for a Pakistani supplier list is most of them. Zip entry names are
// flagged UTF-8 (see zipStore), and Windows, macOS and Linux have all handled
// Unicode filenames for two decades. What stays banned is what actually causes
// harm: path separators, drive colons, wildcards, quotes and control characters.
export function safeName(s, max = 48) {
  const out = String(s ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, '-')   // allow-list; everything else becomes "-"
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')            // no leading/trailing dots, dashes
    .slice(0, max)
    .replace(/[-._]+$/g, '');                   // slice() may have left one behind
  return out || 'untitled';
}

// ── ZIP (STORE only) ──────────────────────────────────────────────────────────

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return (CRC_TABLE = t);
}

function crc32(bytes) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS packed date/time. The format predates 1980 being a lower bound, so
// clamp rather than emit a negative year that unzippers render as garbage.
function dosDateTime(d) {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Build a STORE-method zip.
 *
 * @param files [{ name, blob }] — name may contain "/" for folders.
 * @returns Blob
 *
 * Memory: each file's bytes are read once to checksum it and then dropped; what
 * the archive holds on to is the original Blob, which the browser keeps out of
 * the JS heap. That is the whole reason this takes Blobs rather than
 * Uint8Arrays — a 200MB export never materialises 200MB of JS objects.
 */
export async function zipStore(files, { onProgress } = {}) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const parts = [];      // local headers + file data, in archive order
  const central = [];    // central-directory records
  let offset = 0;
  let n = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed to extract (2.0)
    local.setUint16(6, 0x0800, true);       // flags: filename is UTF-8
    local.setUint16(8, 0, true);            // method: 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);        // compressed size == uncompressed
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);           // extra field length

    // Push the Blob, not `bytes` — see the memory note above.
    parts.push(local.buffer, nameBytes, f.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // central directory header signature
    cd.setUint16(4, 20, true);              // version made by
    cd.setUint16(6, 20, true);              // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);              // extra length
    cd.setUint16(32, 0, true);              // comment length
    cd.setUint16(34, 0, true);              // disk number start
    cd.setUint16(36, 0, true);              // internal attributes
    cd.setUint32(38, 0, true);              // external attributes
    cd.setUint32(42, offset, true);         // offset of local header
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
    onProgress?.(++n, files.length);
  }

  const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory signature
  end.setUint16(4, 0, true);                // this disk number
  end.setUint16(6, 0, true);                // disk with central directory
  end.setUint16(8, files.length, true);     // entries on this disk
  end.setUint16(10, files.length, true);    // entries total
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);          // central directory offset
  end.setUint16(20, 0, true);               // comment length

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
