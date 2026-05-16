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

/**
 * Plugin-agnostic tree of the imported topology. Each plugin produces its
 * own tree from its native format (dbexport hierarchy, Brick SPARQL traversal,
 * BACnet discovery scan). The UI renders without knowing which plugin built it.
 */
export type TopologyNode = {
  /** Stable id, unique within the topology. */
  readonly id: string;
  /** Display label (segment name, device name, or descriptive label). */
  readonly label: string;
  /** Semantic kind: engine, fieldbus, equipment, point, schedule, alarm, ... */
  readonly kind: string;
  /** JCI class ID (or vendor-equivalent), if known. */
  readonly classid?: string;
  /** Full vendor reference path, if known. */
  readonly ref?: string;
  /** Total objects in this subtree, including this node. */
  readonly objectCount: number;
  /** Direct children, ordered. */
  readonly children: readonly TopologyNode[];
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
  topology?: readonly TopologyNode[];
};
