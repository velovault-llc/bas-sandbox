import type { IngestPlugin, IngestResult } from '@bas/core';
import { BrickGraph } from '@bas/core';

export const dbexportPlugin: IngestPlugin = {
  id: 'metasys-dbexport',
  displayName: 'Metasys .dbexport',
  accepts: ['.dbexport', '.zip'],

  async canHandle(file: File): Promise<boolean> {
    const name = file.name.toLowerCase();
    return name.endsWith('.dbexport') || name.endsWith('.zip');
  },

  async ingest(_file: File): Promise<IngestResult> {
    return {
      graph: new BrickGraph(),
      warnings: ['Parser not yet wired — extraction from dbexport-viewer pending (Phase 0 Step 2)'],
    };
  },
};
