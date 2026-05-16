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

export type EngineSummary = {
  /** Engine reference, e.g. "DACC-NAE35-BCC". */
  name: string;
  /** Total objects under this engine, including all nested children. */
  objectCount: number;
};

export type IngestResult = {
  graph: import('./brick.js').BrickGraph;
  warnings: readonly string[];
  metadata?: {
    sourceName?: string;
    deviceCount?: number;
    objectCount?: number;
    engines?: readonly EngineSummary[];
  };
};
