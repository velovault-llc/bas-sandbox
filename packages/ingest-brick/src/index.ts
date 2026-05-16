import type { IngestPlugin, IngestResult } from '@bas/core';
import { BrickGraph } from '@bas/core';

export const brickTtlPlugin: IngestPlugin = {
  id: 'brick-ttl',
  displayName: 'Brick Schema (TTL)',
  accepts: ['.ttl', '.turtle'],

  async canHandle(file: File): Promise<boolean> {
    const name = file.name.toLowerCase();
    return name.endsWith('.ttl') || name.endsWith('.turtle');
  },

  async ingest(_file: File): Promise<IngestResult> {
    return {
      graph: new BrickGraph(),
      warnings: ['TTL parser not yet wired (Phase 0 Step 3)'],
    };
  },
};
