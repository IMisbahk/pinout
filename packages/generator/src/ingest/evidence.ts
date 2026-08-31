import type { EvidenceReference } from '../types/ir.js';
import type { SourceDocument } from '../types/source.js';

export function evidenceFromMatch(
  document: SourceDocument,
  matchIndex: number,
  excerpt: string,
): EvidenceReference {
  const before = document.content.slice(0, matchIndex);
  const startLine = before.split('\n').length;
  const endLine = startLine + excerpt.split('\n').length - 1;
  return {
    sourceId: document.id,
    path: document.path,
    lines: { start: startLine, end: Math.max(startLine, endLine) },
    excerpt: excerpt.trim().slice(0, 200),
  };
}

export function findLineEvidence(
  document: SourceDocument,
  pattern: RegExp,
): { evidence: EvidenceReference; match: RegExpMatchArray } | undefined {
  const match = document.content.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  return {
    match,
    evidence: evidenceFromMatch(document, match.index, match[0]),
  };
}

export function allDocumentsText(documents: SourceDocument[]): string {
  return documents.map((doc) => `# ${doc.path}\n${doc.content}`).join('\n\n');
}
