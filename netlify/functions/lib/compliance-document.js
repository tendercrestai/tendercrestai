const { inflateRawSync } = require("node:zlib");
const { RequestError } = require("./rfp-security");
const MAX_TEXT = 300000;
const MAX_CHUNKS = 32;
const clean = text => text.replace(/\r\n?/g, "\n").trim();

// Use the same browser archive expansion validation, plus bounded inflation
// of only document.xml. Do not execute macros, relationships or embedded files.
async function docxText(bytes) {
  const { validateDocx } = await import("../../../assets/docx-validation.mjs");
  validateDocx(new Uint8Array(bytes));
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), xml, unsupported = false;
  for (let i = 0; i < count; i++) {
    const size = bytes.readUInt32LE(offset + 20);
    const expanded = bytes.readUInt32LE(offset + 24);
    const n = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + n).toString("utf8");
    if (/^word\/(header|footer|footnotes|endnotes|media)/.test(name)) unsupported = true;
    if (name === "word/document.xml") {
      const local = bytes.readUInt32LE(offset + 42);
      if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw Error("Invalid ZIP");
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + size > offset) throw Error("Invalid ZIP");
      const compressed = bytes.subarray(start, start + size);
      const method = bytes.readUInt16LE(offset + 10);
      const result = method === 0 ? compressed : method === 8
        ? inflateRawSync(compressed, { maxOutputLength: 30 * 1024 * 1024 }) : null;
      if (!result || result.length !== expanded) throw Error("Invalid ZIP");
      xml = new TextDecoder("utf-8", { fatal: true }).decode(result);
    }
    offset += 46 + n + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("Unsupported XML");
  const parser = require("sax").parser(true);
  let text = "", inText = false;
  parser.onopentag = node => {
    if (node.name === "w:t") inText = true;
    if (node.name === "w:tab") text += "\t";
    if (node.name === "w:br" || node.name === "w:cr") text += "\n";
    if (["w:drawing", "w:pict", "w:object", "w:altChunk", "w:del", "w:ins", "w:txbxContent"].includes(node.name)) unsupported = true;
  };
  parser.ontext = value => { if (inText) text += value; };
  parser.onclosetag = name => {
    if (name === "w:t") inText = false;
    if (name === "w:p") text += "\n";
    if (name === "w:tc") text += "\t";
  };
  parser.write(xml).close();
  return { text: clean(text), unsupported };
}

// Section headings are short title-case lines: a section code ("Section L",
// "Section 4.2"), a clause number ("2. Submission Instructions"), or a known
// section phrase. The old loose pattern also matched numbered list items
// ("1. One (1) PDF copy of the invoice ...") and running text containing the
// word "section" ("section of the System for Award Management ..."), so whole
// form lines became section labels that then rode on dozens of citations
// (sweep finding #18, Nov 18, 2026). A heading title may only contain
// capitalized words, numbers and a small set of lowercase connectors, and it
// needs at least one real title word; anything else is body text, not a
// heading.
const HEADING_CONNECTORS = new Set(["and", "or", "of", "for", "the", "to", "in", "on", "with", "by", "per", "a", "an", "from", "at"]);
const HEADING_KEYWORDS = ["scope of work", "evaluation criteria", "submission instructions", "vendor qualifications", "commercial conditions", "technical specifications", "service level requirements"];
function headingTitleOk(rest) {
  const words = String(rest || "").split(/\s+/).filter(Boolean);
  const content = words.map(w => w.replace(/[^A-Za-z]/g, "")).filter(w => w.length >= 3);
  if (!content.length) return false;
  return content.every(w => HEADING_CONNECTORS.has(w.toLowerCase()) || /^[A-Z]/.test(w));
}
function looksLikeHeading(line) {
  const text = String(line || "").trim();
  if (!text || text.length > 80) return false;
  if (/^(?:[Ss]ection|SECTION)\s+(?:[A-Z]\.?|[0-9]+(?:\.[0-9]+)*)\b/.test(text)) return true;
  if (/^[A-Z]\.[0-9]+\b/.test(text)) return headingTitleOk(text.replace(/^[A-Z]\.[0-9]+\s*/, ""));
  const numbered = text.match(/^\d+(?:\.\d+)*[.)]?\s+(.+)$/);
  if (numbered) return headingTitleOk(numbered[1]);
  const lower = text.toLowerCase();
  for (const keyword of HEADING_KEYWORDS) {
    if (lower.startsWith(keyword)) {
      const rest = text.slice(keyword.length).replace(/^[:.\-–—\s]+/, "");
      return rest ? headingTitleOk(rest) : true;
    }
  }
  return false;
}

function segmentsFor(documentId, pages) {
  const segments = [];
  let section = null;
  for (const { page, text } of pages) {
    // Source headings come only from extracted source, never model output.
    let value = "", start = 0, sectionAtStart = section;
    function flush() {
      if (value.trim()) segments.push({
        id: documentId + ":" + segments.length, document_id: documentId,
        page, section: sectionAtStart, offset: start, text: value.trim()
      });
      value = "";
    }
    let position = 0;
    for (const line of text.split("\n")) {
      const heading = looksLikeHeading(line.trim());
      if (heading || value.length + line.length > 8000) {
        flush();
        if (heading) section = line.trim().slice(0, 300);
        sectionAtStart = section;
        start = position;
      }
      // Long lines split without inventing page/section references.
      for (let n = 0; n < line.length; n += 8000) {
        if (n) { flush(); start = position + n; sectionAtStart = section; }
        value += line.slice(n, n + 8000);
      }
      value += "\n";
      position += line.length + 1;
    }
    flush();
  }
  return segments;
}

async function extractDocument(source, options = {}) {
  const { bytes, extension, metadata } = source;
  // Knowledge documents may be much larger than a free-tool RFP: the caller
  // may raise the cap (the knowledge worker does, for long winning
  // proposals). The compliance/free-tool paths keep the 300,000 default,
  // which bounds AI analysis cost. chunkDocuments enforces its own bound.
  const maxText = Number.isSafeInteger(options.maxText) && options.maxText > 0 ? options.maxText : MAX_TEXT;
  const warnings = [], pages = [];
  try {
    if (extension === "txt") {
      const text = clean(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw Error("Binary text");
      pages.push({ page: null, text });
    } else if (extension === "docx") {
      const result = await docxText(bytes);
      pages.push({ page: null, text: result.text });
      if (result.unsupported) warnings.push("DOCX contains supplementary or unsupported content. Review headers, footers, changes and images separately.");
    } else if (extension === "pdf") {
      if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid PDF");
      const pdfjs = options.pdfjs || await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdfjs.getDocument({
        data: Uint8Array.from(bytes), isEvalSupported: false,
        useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0,
        standardFontDataUrl: require("node:path").join(require.resolve("pdfjs-dist/package.json"), "../standard_fonts/")
      });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 500) throw Error("Page limit");
        if (await pdf.getFieldObjects?.()) warnings.push("PDF contains form fields. Review form values separately.");
        let length = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n), content = await page.getTextContent();
          const text = clean(content.items.map(x => x.str + (x.hasEOL ? "\n" : " ")).join(""));
          length += text.length;
          if (length > maxText) throw new RequestError(413, "Combined extracted text exceeds " + maxText.toLocaleString("en-US") + " characters. Select smaller documents.");
          if (text.replace(/\s/g, "").length < 20) warnings.push("PDF page " + n + " has little or no readable text; OCR/source review required.");
          const operators = await page.getOperatorList?.();
          if (operators && operators.fnArray.some(op => [
            pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintImageMaskXObject
          ].filter(x => x !== undefined).includes(op)))
            warnings.push("PDF page " + n + " contains images; check for scanned requirements needing OCR.");
          if ((await page.getAnnotations?.())?.length) warnings.push("PDF page " + n + " contains annotations. Review their content separately.");
          pages.push({ page: n, text });
          page.cleanup();
        }
      } finally { await task.destroy(); }
    } else throw Error("Unsupported document");
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(422, "Document could not be extracted safely. Check PDF/DOCX structure or UTF-8 encoding; scanned PDFs require OCR.");
  }
  if (!pages.some(x => x.text)) throw new RequestError(422, "No readable text found. Scanned PDFs require OCR.");
  if (pages.reduce((n, p) => n + p.text.length, 0) > maxText) throw new RequestError(413, "Combined extracted text exceeds " + maxText.toLocaleString("en-US") + " characters.");
  return {
    id: metadata.id, name: metadata.file_name, sha256: metadata.sha256,
    format: extension, warnings,
    segments: segmentsFor(metadata.id, pages)
  };
}

function chunkDocuments(documents) {
  const chunks = [];
  let current = [], length = 0, total = 0;
  for (const document of documents) for (const segment of document.segments) {
    total += segment.text.length;
    if (total > MAX_TEXT) throw new RequestError(413, "Combined extracted text exceeds " + MAX_TEXT.toLocaleString("en-US") + " characters.");
    if (length + segment.text.length > 10000 && current.length) { chunks.push(current); current = []; length = 0; }
    current.push(segment); length += segment.text.length;
  }
  if (current.length) chunks.push(current);
  if (!chunks.length || chunks.length > MAX_CHUNKS) throw new RequestError(413, "Document set exceeds the supported analysis size.");
  return chunks;
}
module.exports = { extractDocument, segmentsFor, chunkDocuments, docxText, looksLikeHeading, headingTitleOk, MAX_TEXT, MAX_CHUNKS };
