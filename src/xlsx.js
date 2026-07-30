// Minimal, dependency-free .xlsx (OOXML spreadsheet) writer, reusing the
// hand-rolled zip writer already in export.js instead of adding SheetJS —
// same rationale as that file's zipStore: everything this writes is small,
// and a real dependency buys nothing but supply-chain surface for a page that
// handles financial and chat records.
//
// An .xlsx is a zip of XML parts. This writes the minimum Excel/Sheets/
// LibreOffice all agree on: no shared-strings table (cells carry inline
// strings instead — fully valid OOXML, one less part to get wrong), one
// worksheet per input sheet, a single default cell style.
import { zipStore, saveBlob } from './export';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML text-node escaping. Distinct from export.js's csvCell escaping — a
// different container with different special characters.
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Same rule as export.js's csvCell: a cell whose text starts with = + - @ (or
// tab/CR) can execute as a formula when opened in Excel. Force it to plain
// text with a leading apostrophe, except a bare negative number ("-1500"),
// which must stay numeric-looking text so it still sums correctly.
function guardFormula(s) {
  return (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
}

// 0-indexed column number -> spreadsheet column letters ("A", "Z", "AA", ...).
function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXML(colIdx, rowNum, value) {
  const ref = `${colLetter(colIdx)}${rowNum}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = guardFormula(value == null ? '' : String(value));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function sheetXML(columns, rows) {
  const headerRow = `<row r="1">${columns.map((col, i) => cellXML(i, 1, col.label)).join('')}</row>`;
  const bodyRows = rows.map((row, r) =>
    `<row r="${r + 2}">${columns.map((col, i) => cellXML(i, r + 2, col.get(row))).join('')}</row>`
  ).join('');
  return XML_HEADER +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${headerRow}${bodyRows}</sheetData>` +
    '</worksheet>';
}

// Excel sheet-name rules: <=31 chars, none of : \ / ? * [ ]. Dedupes if two
// input names collide after sanitizing.
function safeSheetName(name, taken) {
  const base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base, n = 2;
  while (taken.has(out)) out = `${base.slice(0, 28)} ${n++}`;
  taken.add(out);
  return out;
}

const contentTypesXML = (n) => XML_HEADER +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  Array.from({length:n},(_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
  '</Types>';

const ROOT_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const STYLES_XML = XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
  '<cellXfs count="1"><xf/></cellXfs>' +
  '</styleSheet>';

function workbookXML(names) {
  const sheets = names.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  return XML_HEADER +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets>` +
    '</workbook>';
}

function workbookRelsXML(n) {
  const sheetRels = Array.from({length:n},(_,i)=>
    `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
  return XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels +
    `<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
}

/**
 * Build an .xlsx Blob from `sheets: [{name, columns:[{label,get(row)}], rows}]`
 * — the same columns/get(row) shape export.js's exportCSV already takes, so a
 * chart's data feeds both without a second mapping.
 */
export async function buildXLSX(sheets) {
  const taken = new Set();
  const names = sheets.map(s => safeSheetName(s.name, taken));
  const xml = (s) => new Blob([s], { type: 'application/xml' });
  const files = [
    { name: '[Content_Types].xml', blob: xml(contentTypesXML(sheets.length)) },
    { name: '_rels/.rels', blob: xml(ROOT_RELS) },
    { name: 'xl/workbook.xml', blob: xml(workbookXML(names)) },
    { name: 'xl/_rels/workbook.xml.rels', blob: xml(workbookRelsXML(sheets.length)) },
    { name: 'xl/styles.xml', blob: xml(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i+1}.xml`, blob: xml(sheetXML(s.columns, s.rows)) })),
  ];
  return zipStore(files);
}

export async function exportXLSX(name, sheets) {
  const blob = await buildXLSX(sheets);
  saveBlob(blob, `hitech-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
