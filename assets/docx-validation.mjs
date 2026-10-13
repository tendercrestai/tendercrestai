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

