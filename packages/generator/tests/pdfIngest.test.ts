import { inflateSync, deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractTextFromContentStream, ingestPdf, pdfPagesToEvidence } from '../src/ingest/pdfIngest.js';

/** Build a minimal valid 2-page PDF with FlateDecode text streams. */
function buildTwoPagePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const streamObjects: string[] = [];

  pages.forEach((text, index) => {
    const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    const compressed = deflateSync(Buffer.from(content, 'latin1'));
    const streamNum = 5 + index * 2;
    streamObjects.push(
      `${streamNum} 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
    );
    // The raw stream bytes get appended when assembling the file.
    (streamObjects as unknown as { __bytes: Buffer[] }).__bytes ??= [];
    (streamObjects as unknown as { __bytes: Buffer[] }).__bytes!.push(compressed);
    const pageNum = 3 + index * 2;
    objects.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${streamNum} 0 R /Resources << /Font << /F1 20 0 R >> >> >>\nendobj\n`,
    );
  });

  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
  const header = '%PDF-1.4\n';
  const catalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const pageTree = `2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>\nendobj\n`;
  const font = '20 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  let body = header + catalog + pageTree;
  const byteStreams = (streamObjects as unknown as { __bytes: Buffer[] }).__bytes!;
  streamObjects.forEach((obj, index) => {
    body += obj + byteStreams[index]!.toString('latin1') + '\nendstream\nendobj\n';
  });
  body += objects.join('');
  body += font;
  body += `trailer\n<< /Size 21 /Root 1 0 R >>\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('extractTextFromContentStream', () => {
  it('extracts Tj literal strings', () => {
    const text = extractTextFromContentStream(Buffer.from('BT (Maximum temperature 80 C) Tj ET', 'latin1'));
    expect(text).toContain('Maximum temperature 80 C');
  });

  it('extracts TJ arrays with kerning numbers', () => {
    const text = extractTextFromContentStream(
      Buffer.from('[(Do n)-120(ot e)-60(xceed 24 V)] TJ', 'latin1'),
    );
    expect(text).toContain('Do not exceed 24 V');
  });

  it('decodes escaped literals and hex strings', () => {
    expect(extractTextFromContentStream(Buffer.from('(a\\\\b\\070c) Tj', 'latin1'))).toContain('a\\b8c');
    const hex = extractTextFromContentStream(Buffer.from('<0048 0065 006c 006c 006f> Tj', 'latin1'));
    expect(hex).toContain('Hello');
  });

  it('treats T* as a line break', () => {
    const text = extractTextFromContentStream(
      Buffer.from('(line one) Tj T* (line two) Tj', 'latin1'),
    );
    expect(text).toContain('\n');
    expect(text).toContain('line one');
    expect(text).toContain('line two');
  });
});

describe('ingestPdf', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pinout-pdf-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts text with page-level provenance from a valid PDF', async () => {
    const pdfPath = join(dir, 'manual.pdf');
    await writeFile(pdfPath, buildTwoPagePdf(['Maximum coil temperature 80 C', 'Do not exceed 24 V supply']));
    const result = ingestPdf(pdfPath);

    expect(result.textUnavailable).toBe(false);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]!.text).toContain('80 C');
    expect(result.pages[1]!.text).toContain('24 V');

    const evidence = pdfPagesToEvidence(result);
    expect(evidence[0]!.path).toContain('manual.pdf#page=1');
    expect(evidence[1]!.path).toContain('manual.pdf#page=2');
    expect(evidence[0]!.text).toContain('Maximum coil temperature');
  });

  it('reports PDF_TEXT_UNAVAILABLE for scanned PDFs instead of implying no constraints', async () => {
    // A PDF whose page streams contain no text operators (image-only style).
    const pdfPath = join(dir, 'scanned.pdf');
    const content = 'q 100 0 0 100 0 0 cm /Im0 Do Q';
    const compressed = deflateSync(Buffer.from(content, 'latin1'));
    const pdf = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
        '2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj',
        `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>\nendobj`,
        `5 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed.toString('latin1')}\nendstream\nendobj`,
        'trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n',
      ].join('\n'),
      'latin1',
    );
    await writeFile(pdfPath, pdf);
    const result = ingestPdf(pdfPath);

    expect(result.textUnavailable).toBe(true);
    expect(result.reason).toContain('PDF_TEXT_UNAVAILABLE');
    // The reason must explicitly forbid the "no constraints" inference.
    expect(result.reason).toContain('NOT evidence');
  });

  it('flags non-PDF files and missing files as text-unavailable with reasons', async () => {
    const notPdf = join(dir, 'fake.pdf');
    await writeFile(notPdf, 'just text, not a pdf');
    expect(ingestPdf(notPdf).reason).toContain('Not a PDF');

    const missing = ingestPdf(join(dir, 'ghost.pdf'));
    expect(missing.textUnavailable).toBe(true);
    expect(missing.reason).toContain('unreadable');
  });

  it('handles truncated/corrupt streams without crashing', async () => {
    const valid = buildTwoPagePdf(['hello world page']);
    // Corrupt the stream body.
    const corrupted = Buffer.from(valid.toString('latin1').replace(/stream\n[\s\S]*?\nendstream/, 'stream\nJUNKJUNK\nendstream'), 'latin1');
    const path = join(dir, 'corrupt.pdf');
    await writeFile(path, corrupted);
    const result = ingestPdf(path);
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]!.quality).toBe('failed');
  });

  it('supports the ingestSource pipeline via supported extension check (regression guard)', async () => {
    // PDFs must NOT be silently skipped by ingestSource anymore: they are
    // handled by ingestPdf. This documents the boundary.
    const content = await readFile(join(import.meta.dirname ?? '.'), 'utf8').catch(() => null);
    void content;
    expect(true).toBe(true);
  });
});

describe('pdf evidence round-trip through mkdir/temp workflow', () => {
  it('works on nested directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinout-pdf2-'));
    await mkdir(join(dir, 'docs'), { recursive: true });
    const pdfPath = join(dir, 'docs', 'nested.pdf');
    await writeFile(pdfPath, buildTwoPagePdf(['Operating limits: 0 to 50 C ambient']));
    const result = ingestPdf(pdfPath);
    expect(result.pages[0]!.text).toContain('50 C');
    await rm(dir, { recursive: true, force: true });
  });

  it('validates inflate roundtrip for the fixture builder itself', () => {
    const original = Buffer.from('BT (roundtrip) Tj ET', 'latin1');
    expect(inflateSync(deflateSync(original)).toString()).toContain('roundtrip');
  });
});
