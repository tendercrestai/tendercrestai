export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT = 100000;

export const MIME = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain"
});

export function validateFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();

  if (!MIME[extension]) {
    throw new Error("Choose a PDF, DOCX, or TXT document.");
  }

  if (!file.size) {
    throw new Error("The document is empty.");
  }

  if (file.size > MAX_BYTES) {
    throw new Error("The document must be 10 MB or smaller.");
  }

  if (file.name.length > 255) {
    throw new Error("Use a file name with at most 255 characters.");
  }

  if (file.type && file.type !== MIME[extension]) {
    throw new Error("The file type does not match its extension.");
  }

  return { extension, mime: MIME[extension] };
}

// Check archive expansion before Mammoth processes DOCX.
export function validateDocx(bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  let end = -1;

  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }

  if (end < 0) {
    throw new Error("This is not a readable DOCX file.");
  }

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let expanded = 0;
  let documentFound = false;

  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count > 2000 ||
    count === 0
  ) {
    throw new Error("This DOCX archive is unsupported.");
  }

  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > end ||
      view.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new Error("The DOCX archive is damaged.");
    }

    if (view.getUint16(offset + 8, true) & 1) {
      throw new Error("Encrypted DOCX files are unsupported.");
    }

    expanded += view.getUint32(offset + 24, true);

    if (expanded > 30 * 1024 * 1024) {
      throw new Error(
        "The expanded DOCX is too large to extract safely."
      );
    }

    const length = view.getUint16(offset + 28, true);

    const next =
      offset + 46 + length +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);

    if (next > end) {
      throw new Error("The DOCX archive is damaged.");
    }

    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + length)
    );

    if (name === "word/document.xml") documentFound = true;
    offset = next;
  }

  if (!documentFound) {
    throw new Error("Choose a DOCX document, not another ZIP archive.");
  }
}

async function loadMammoth() {
  if (globalThis.mammoth) return globalThis.mammoth;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js";

    script.onload = resolve;

    script.onerror = () => {
      script.remove();
      reject(new Error(
        "Document tools could not load. Check your connection and try again."
      ));
    };

    document.head.append(script);
  });

  return globalThis.mammoth;
}

export async function extractText(file) {
  const { extension } = validateFile(file);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let text;

  if (extension === "txt") {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        "Save this TXT document as UTF-8 and try again."
      );
    }

    if (/[\x00-\x08\x0e-\x1f]/.test(text)) {
      throw new Error("This TXT file contains binary data.");
    }
  } else if (extension === "docx") {
    validateDocx(bytes);

    const mammoth = await loadMammoth();
    text = (
      await mammoth.extractRawText({ arrayBuffer: buffer })
    ).value;
  } else {
    if (
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
    ) {
      throw new Error("This is not a valid PDF document.");
    }

    const pdfjs = await import(
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false
    });

    try {
      const pdf = await task.promise;

      if (pdf.numPages > 500) {
        throw new Error(
          "PDFs with more than 500 pages are unsupported."
        );
      }

      const pages = [];
      let length = 0;

      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();

        const value = content.items
          .map(item => item.str + (item.hasEOL ? "\n" : " "))
          .join("");

        length += value.length;

        if (length > 500000) {
          throw new Error(
            "This PDF contains too much text. Upload the relevant sections."
          );
        }

        pages.push(value);
        page.cleanup();
      }

      text = pages.join("\n\n");
    } finally {
      await task.destroy();
    }
  }

  text = text.replace(/\r\n?/g, "\n").trim();

  if (!text) {
    throw new Error(
      "No readable text was found. Scanned PDFs need OCR before uploading."
    );
  }

  if (text.length > 500000) {
    throw new Error(
      "This document contains too much text. Upload the relevant sections."
    );
  }

  return text;
}
