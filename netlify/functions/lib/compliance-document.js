const { inflateRawSync } = require("node:zlib");
const { RequestError } = require("./rfp-security");
const MAX_TEXT = 100000;
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
      const heading = /^(?:section\s+[A-Z0-9]+\b|[A-Z]\.[0-9]+\b|\d+(?:\.\d+)*[.)]?\s+[A-Z]|scope of work\b|evaluation criteria\b|submission instructions\b|vendor qualifications\b|commercial conditions\b|technical specifications\b|service.level requirements\b)/i.test(line.trim());
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

async function extractDocument(source, adapters = {}) {
  const { bytes, extension, metadata } = source;
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
      const pdfjs = adapters.pdfjs || await import("pdfjs-dist/legacy/build/pdf.mjs");
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
          if (length > MAX_TEXT) throw new RequestError(413, "Combined extracted text exceeds 100,000 characters. Select smaller documents.");
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
  if (pages.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) throw new RequestError(413, "Combined extracted text exceeds 100,000 characters.");
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
    if (total > MAX_TEXT) throw new RequestError(413, "Combined extracted text exceeds 100,000 characters.");
    if (length + segment.text.length > 10000 && current.length) { chunks.push(current); current = []; length = 0; }
    current.push(segment); length += segment.text.length;
  }
  if (current.length) chunks.push(current);
  if (!chunks.length || chunks.length > 16) throw new RequestError(413, "Document set exceeds the supported analysis size.");
  return chunks;
}
module.exports = { extractDocument, segmentsFor, chunkDocuments, docxText };
