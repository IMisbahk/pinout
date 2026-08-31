import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { SourceDocument } from '../types/source.js';
import { DEFAULT_IGNORED_DIRS, SUPPORTED_EXTENSIONS, type IngestOptions } from '../types/source.js';

const BINARY_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.bin', '.o']);

export function hashSourceContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function ingestSource(inputPath: string, options: IngestOptions = {}): SourceDocument[] {
  const absolute = resolve(inputPath);
  const stat = lstatSync(absolute);
  const maxFileBytes = options.maxFileBytes ?? 512_000;
  const maxTotalBytes = options.maxTotalBytes ?? 2_000_000;
  const documents: SourceDocument[] = [];
  let totalBytes = 0;

  const ingestFile = (filePath: string): void => {
    const ext = extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return;
    }
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return;
    }
    const content = readFileSync(filePath, 'utf8');
    if (content.includes('\0')) {
      return;
    }
    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
      return;
    }
    totalBytes += content.length;
    if (totalBytes > maxTotalBytes) {
      return;
    }
    const relPath = relative(resolve(inputPath, '..'), filePath);
    documents.push(normalizeDocument(relPath || basename(filePath), filePath, ext, content));
  };

  if (stat.isFile()) {
    ingestFile(absolute);
    return documents;
  }

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        ingestFile(fullPath);
      }
    }
  };

  walk(absolute);
  return documents.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeDocument(
  relPath: string,
  absolutePath: string,
  ext: string,
  content: string,
): SourceDocument {
  const lines = content.split('\n');
  const headings =
    ext === '.md' ? lines.filter((line) => line.startsWith('#')).map((line) => line.trim()) : [];
  const lang = languageFromExtension(ext);
  const metadata: SourceDocument['metadata'] = {
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    lineCount: lines.length,
  };
  if (lang) {
    metadata.language = lang;
  }
  if (headings.length > 0) {
    metadata.headings = headings;
  }

  return {
    id: hashSourceContent(`${relPath}:${content.length}`),
    path: relPath,
    type: ext.slice(1),
    content,
    metadata,
  };
}

function languageFromExtension(ext: string): string | undefined {
  const map: Record<string, string> = {
    '.md': 'markdown',
    '.txt': 'text',
    '.ts': 'typescript',
    '.js': 'javascript',
    '.py': 'python',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
  };
  return map[ext];
}
