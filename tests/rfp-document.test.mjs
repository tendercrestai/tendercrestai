import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  validateFile,
  validateDocx,
  extractText,
  MAX_BYTES
} from "../assets/rfp-document.mjs";

function file(
  text,
  name = "requirements.txt",
  type = "text/plain"
) {
  const blob = new Blob([text], { type });

  return {
    name,
    type,
    size: blob.size,
    arrayBuffer: () => blob.arrayBuffer()
  };
}

test("TXT extraction preserves readable UTF-8 and line breaks", async () => {
  assert.equal(
    await extractText(file(" Scope\r\nEvaluation – delivery\r\n ")),
    "Scope\nEvaluation – delivery"
  );
});

test("rejects empty, binary and invalid UTF-8 TXT documents", async () => {
  await assert.rejects(extractText(file("")), /empty/);
  await assert.rejects(extractText(file(" \n ")), /No readable text/);
  await assert.rejects(extractText(file("binary\0data")), /binary/);

  await assert.rejects(
    extractText(file(new Uint8Array([255, 254]))),
    /UTF-8/
  );
});

test("extension, MIME and exact size boundaries are enforced", () => {
  assert.throws(
    () => validateFile(file("x", "malware.exe")),
    /PDF, DOCX, or TXT/
  );

  assert.throws(
    () => validateFile(file("x", "fake.pdf")),
    /type does not match/
  );

  assert.equal(
    validateFile({
      name: "RFP.PDF",
      type: "application/pdf",
      size: MAX_BYTES
    }).extension,
    "pdf"
  );

  assert.throws(
    () => validateFile({
      name: "RFP.pdf",
      type: "application/pdf",
      size: MAX_BYTES + 1
    }),
    /10 MB/
  );
});

test("rejects forged PDFs and invalid DOCX archives before loading document tools", async () => {
  await assert.rejects(
    extractText(file("fake", "fake.pdf", "application/pdf")),
    /valid PDF/
  );

  assert.throws(
    () => validateDocx(new Uint8Array(10)),
    /readable DOCX/
  );

  const zip = new Uint8Array(22);
  new DataView(zip.buffer).setUint32(0, 0x06054b50, true);

  assert.throws(
    () => validateDocx(zip),
    /unsupported/
  );
});

test("ZIP expansion limit and required document entry are checked", () => {
  const zip = new Uint8Array(46 + 17 + 22);
  const view = new DataView(zip.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint32(24, 100, true);
  view.setUint16(28, 17, true);

  zip.set(new TextEncoder().encode("word/document.xml"), 46);

  view.setUint32(63, 0x06054b50, true);
  view.setUint16(73, 1, true);
  view.setUint32(79, 0, true);

  assert.doesNotThrow(() => validateDocx(zip));

  view.setUint32(24, 31 * 1024 * 1024, true);

  assert.throws(
    () => validateDocx(zip),
    /too large/
  );

  view.setUint32(24, 100, true);
  zip[46] = 88;

  assert.throws(
    () => validateDocx(zip),
    /not another ZIP/
  );
});

test("all page scripts parse and existing workspace retains pricing and upload navigation", async () => {
  for (const name of ["index.html", "auth.html", "rfp-upload.html"]) {
    const html = await readFile(
      new URL("../" + name, import.meta.url),
      "utf8"
    );

    for (
      const match of html.matchAll(
        /<script([^>]*)>([\s\S]*?)<\/script>/g
      )
    ) {
      const code = match[1].includes('type="module"')
        ? match[2]
            .replace(
              /import\s+\{[^}]*\}\s+from\s+["'][^"']+["'];/g,
              ""
            )
            .replace("await initializePage();", "initializePage();")
        : match[2];

      new vm.Script(code);
    }
  }

  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8"
  );

  assert.ok(html.includes('href="/rfp-upload.html"'));
  assert.ok(html.includes("billing.stripe.com/p/login/"));
  assert.ok(html.includes("Enterprise Trial Pass"));
  assert.ok(html.includes("Authorization"));
});
