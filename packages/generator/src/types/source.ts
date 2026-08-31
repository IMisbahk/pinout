export interface SourceDocument {
  id: string;
  path: string;
  type: string;
  content: string;
  metadata: {
    sizeBytes: number;
    lineCount: number;
    language?: string;
    headings?: string[];
  };
}

export interface IngestOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.pinout',
  '__pycache__',
  '.venv',
  'target',
]);

export const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.ts',
  '.js',
  '.py',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.json',
  '.yaml',
  '.yml',
]);
