export const VERSION = '0.0.0';

export { BrickGraph } from './brick.js';
export type { BrickEntity } from './brick.js';

export type IngestPlugin = {
  readonly id: string;
  readonly displayName: string;
  readonly accepts: readonly string[];
  canHandle(file: File): Promise<boolean>;
  ingest(file: File): Promise<IngestResult>;
};

export type IngestResult = {
  graph: import('./brick.js').BrickGraph;
  warnings: readonly string[];
};
