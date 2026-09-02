/**
 * PDF text ingestion for the hardware-document generator.
 *
 * Extracts embedded text per page (page-level provenance is mandatory: every
 * claim from a PDF must cite `page`). Uses no external dependencies: parses
 * the PDF object structure directly and inflates FlateDecode content streams
 * via node:zlib, then extracts text operators (Tj, TJ, ') from content
 * streams.
 *
 * Honest limits, enforced:
 * - Scanned/image-only PDFs yield `PDF_TEXT_UNAVAILABLE` — never an empty
 *   "no constraints found" result.
 * - Extraction quality varies by generator; extracts are treated as evidence
 *   with a lower trust weight than structured sources.
 */
import { inflateSync, inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export interface PdfPageText {
  page: number;
  text: string;
  /** Extraction confidence: 'good' | 'partial' | 'failed'. */
  quality: 'good' | 'partial' | 'failed';
}

export interface PdfIngestResult {
  fileName: string;
  pageCount: number;
  pages: PdfPageText[];
  /** True when the PDF exists but yielded no extractable text (scanned). */
  textUnavailable: boolean;
  reason?: string;
}

interface PdfObject {
  dict: Map<string, unknown>;
  stream?: Buffer;
}

export function ingestPdf(filePath: string): PdfIngestResult {
  const fileName = filePath.split('/').pop() ?? filePath;
  let raw: Buffer;
  try {
    raw = readFileSync(filePath);
  } catch (error) {
    return {
      fileName,
      pageCount: 0,
      pages: [],
      textUnavailable: true,
      reason: `PDF unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!raw.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    return {
      fileName,
      pageCount: 0,
      pages: [],
      textUnavailable: true,
      reason: 'Not a PDF (missing %PDF header).',
    };
  }

  const objects = parseObjects(raw);
  const pageObjects = objects.filter((object) => object.dict.get('Type') === '/Page');

  if (pageObjects.length === 0) {
    return {
      fileName,
      pageCount: 0,
      pages: [],
      textUnavailable: true,
      reason: 'No page objects found — encrypted or malformed PDF.',
    };
  }

  const pages: PdfPageText[] = [];
  let extractedAny = false;

  pageObjects.forEach((page, index) => {
    const contents = page.dict.get('Contents');
    const streams = collectContentStreams(contents, objects);
    let text = '';
    for (const stream of streams) {
      text += extractTextFromContentStream(stream);
    }
    text = text.replace(/[ \t]+\n/g, '\n').trim();
    if (text.length > 0) extractedAny = true;
    pages.push({
      page: index + 1,
      text,
      quality: text.length > 80 ? 'good' : text.length > 0 ? 'partial' : 'failed',
    });
  });

  if (!extractedAny) {
    return {
      fileName,
      pageCount: pages.length,
      pages,
      textUnavailable: true,
      reason:
        'PDF_TEXT_UNAVAILABLE: no embedded text (likely scanned). Human/OCR review required — this is NOT evidence that no constraints exist.',
    };
  }

  return { fileName, pageCount: pages.length, pages, textUnavailable: false };
}

// ---------------------------------------------------------------------------
// PDF object parsing (minimal, robust to the common generators)
// ---------------------------------------------------------------------------

function parseObjects(raw: Buffer): PdfObject[] {
  const objects: PdfObject[] = [];
  const latin = raw.toString('latin1');
  const objectRegex = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(latin)) !== null) {
    const objectNumber = Number.parseInt(match[1]!, 10);
    const bodyStart = match.index + match[0].length;
    const streamMarker = latin.indexOf('stream', bodyStart);
    const endObjMarker = latin.indexOf('endobj', bodyStart);
    if (endObjMarker === -1) continue;

    const dictEnd =
      streamMarker !== -1 && streamMarker < endObjMarker ? streamMarker : endObjMarker;
    const dictText = latin.slice(bodyStart, dictEnd);
    const dict = parseDictionary(dictText);

    let stream: Buffer | undefined;
    if (streamMarker !== -1 && streamMarker < endObjMarker) {
      let dataStart = streamMarker + 'stream'.length;
      if (latin[dataStart] === '\r') dataStart += 1;
      if (latin[dataStart] === '\n') dataStart += 1;
      const endStream = latin.indexOf('endstream', dataStart);
      if (endStream !== -1) {
        stream = raw.subarray(dataStart, endStream);
      }
    }
    dict.set('__num', objectNumber);
    objects.push(stream !== undefined ? { dict, stream } : { dict });
  }
  return objects;
}

function parseDictionary(text: string): Map<string, unknown> {
  const dict = new Map<string, unknown>();
  // /Key followed by one of: /Name, [refs], "N M R", number, true/false.
  const entryRegex =
    /\/([A-Za-z][A-Za-z0-9]*)\s*(\/\.[A-Za-z0-9.]+|\/[A-Za-z0-9]+|\[[^\]]*\]|\d+\s+\d+\s+R\b|-?\d+(?:\.\d+)?|true|false)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(text)) !== null) {
    const key = match[1]!;
    const valueText = match[2]!.trim();
    if (valueText.startsWith('[')) {
      const refs = [...valueText.matchAll(/(\d+)\s+\d+\s+R/g)].map((ref) =>
        Number.parseInt(ref[1]!, 10),
      );
      dict.set(key, refs);
    } else {
      const ref = /^(\d+)\s+\d+\s+R$/.exec(valueText);
      if (ref) {
        dict.set(key, Number.parseInt(ref[1]!, 10));
      } else if (valueText.startsWith('/')) {
        dict.set(key, valueText);
      } else if (valueText.length > 0) {
        dict.set(key, valueText);
      }
    }
  }
  return dict;
}

function resolveObject(reference: unknown, objects: PdfObject[]): PdfObject | undefined {
  if (typeof reference !== 'number') return undefined;
  // Object numbers are 1-based and appear in order; index by object number.
  return objects.find((object) => object.dict.get('__num') === reference) ?? objects[reference - 1];
}

function collectContentStreams(contents: unknown, objects: PdfObject[]): Buffer[] {
  const streams: Buffer[] = [];
  const push = (object: PdfObject | undefined): void => {
    if (object?.stream) streams.push(decodeStream(object));
  };
  if (typeof contents === 'number') {
    push(resolveObject(contents, objects));
  } else if (Array.isArray(contents)) {
    for (const ref of contents) {
      push(resolveObject(ref, objects));
    }
  }
  return streams.filter((stream) => stream.length > 0);
}

function decodeStream(object: PdfObject): Buffer {
  const filter = object.dict.get('Filter');
  let data = object.stream!;
  try {
    if (filter === '/FlateDecode') {
      data = inflateSync(data);
    } else if (typeof filter === 'string' && filter.includes('FlateDecode')) {
      data = inflateSync(data);
    }
  } catch {
    try {
      data = inflateRawSync(data);
    } catch {
      // Undecodable stream: return whatever we have; page quality reflects it.
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Content-stream text extraction
// ---------------------------------------------------------------------------

/**
 * Extract human-readable text from a PDF content stream by handling the text
 * operators: `Tj`, `'`, `"` and `TJ` arrays. Handles both `(...)` literal
 * strings and `<hex>` strings, plus escape sequences.
 */
export function extractTextFromContentStream(stream: Buffer): string {
  const content = stream.toString('latin1');
  const out: string[] = [];

  const tjRegex =
    /(?:\[((?:[^\]\\]|\\.)*)\]\s*TJ)|((?:\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>)\s*(?:Tj|'|"))|(T\*)|(Td|TD|Tm)/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(content)) !== null) {
    if (match[1] !== undefined) {
      // TJ array: concatenated show-text segments
      out.push(decodeShowTextArray(match[1]));
    } else if (match[2] !== undefined) {
      const decoded = decodeShowTextElement(match[2]);
      out.push(decoded);
      if (/\s(?:'|")$/.test(match[2].trimEnd() + ' ')) out.push('\n');
      if (match[2].includes("'") || match[2].includes('"')) out.push('\n');
    } else if (match[3] !== undefined) {
      out.push('\n');
    } else if (match[4] !== undefined) {
      out.push(match[4] === 'Td' || match[4] === 'TD' ? ' ' : ' ');
    }
  }

  const text = out
    .join('')
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');
  return text;
}

function decodeShowTextArray(arrayBody: string): string {
  let result = '';
  const elementRegex = /\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = elementRegex.exec(arrayBody)) !== null) {
    const element = match[0];
    if (element.startsWith('(')) {
      result += decodePdfStringLiteral(element);
    } else if (element.startsWith('<')) {
      result += decodeHexString(element);
    }
    // Numbers in TJ arrays are kerning adjustments; large negative gaps hint
    // at spaces but decoding that heuristically produces noise — skip.
  }
  return result;
}

function decodeShowTextElement(element: string): string {
  const trimmed = element.trim();
  if (trimmed.startsWith('(')) return decodePdfStringLiteral(trimmed);
  if (trimmed.startsWith('<')) return decodeHexString(trimmed);
  return '';
}

function decodePdfStringLiteral(literal: string): string {
  const inner = literal.slice(1, -1);
  let result = '';
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if (char === '\\') {
      const next = inner[++i];
      if (next === undefined) break;
      if (next === 'n') result += '\n';
      else if (next === 'r') result += '\n';
      else if (next === 't') result += ' ';
      else if (next >= '0' && next <= '7') {
        let octal = next;
        let lookahead = inner[i + 1];
        while (
          octal.length < 3 &&
          lookahead !== undefined &&
          lookahead >= '0' &&
          lookahead <= '7'
        ) {
          octal += lookahead;
          i += 1;
          lookahead = inner[i + 1];
        }
        const code = Number.parseInt(octal, 8);
        result += code >= 32 && code < 127 ? String.fromCharCode(code) : '';
      } else {
        result += next;
      }
    } else if (char >= ' ' && char !== '\x7f') {
      result += char;
    }
  }
  return result;
}

function decodeHexString(hexLiteral: string): string {
  const hex = hexLiteral.slice(1, -1).replace(/\s+/g, '');
  let result = '';
  // Try UTF-16BE (common for CID-keyed) then fall back to latin1 pairs.
  if (hex.length % 4 === 0 && hex.length >= 4) {
    let utf16 = '';
    let printable = 0;
    for (let i = 0; i < hex.length; i += 4) {
      const code = Number.parseInt(hex.slice(i, i + 4), 16);
      if (code >= 32 && code < 0xfffd) {
        utf16 += String.fromCharCode(code);
        printable += 1;
      }
    }
    if (printable >= hex.length / 8) return utf16;
  }
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16);
    if (code >= 32 && code < 127) result += String.fromCharCode(code);
  }
  return result;
}

/**
 * Build a SourceDocument-like evidence set from a PDF: one document per page
 * with page-provenance path `file.pdf#page=N`. Short excerpts only.
 */
export function pdfPagesToEvidence(
  result: PdfIngestResult,
  maxExcerptChars = 1200,
): Array<{ path: string; page: number; text: string; quality: PdfPageText['quality'] }> {
  return result.pages
    .filter((page) => page.text.length > 0)
    .map((page) => ({
      path: `${result.fileName}#page=${page.page}`,
      page: page.page,
      text: page.text.slice(0, maxExcerptChars),
      quality: page.quality,
    }));
}
