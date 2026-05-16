import { BrickGraph, type IngestPlugin, type IngestResult, type EngineSummary } from '@bas/core';
import {
  parseDbexport,
  buildHierarchy,
  type HierarchyNode,
  type ParsedArchive,
} from '@velovault/dbexport-parser';

export const dbexportPlugin: IngestPlugin = {
  id: 'metasys-dbexport',
  displayName: 'Metasys .dbexport',
  accepts: ['.dbexport', '.zip'],

  async canHandle(file: File): Promise<boolean> {
    const name = file.name.toLowerCase();
    return name.endsWith('.dbexport') || name.endsWith('.zip');
  },

  async ingest(file: File): Promise<IngestResult> {
    const buf = await file.arrayBuffer();
    const archive = await parseDbexport(buf, file.name);
    const hierarchy = buildHierarchy(archive);

    const graph = new BrickGraph();
    const engines: EngineSummary[] = [];

    for (const [engineName, engineNode] of hierarchy) {
      const engineUri = `urn:bas:engine:${encodeURIComponent(engineName)}`;
      graph.addEntity(engineUri, 'Controller');
      walkAndAdd(engineNode, engineUri, graph);
      engines.push({ name: engineName, objectCount: engineNode.totalCount });
    }
    engines.sort((a, b) => b.objectCount - a.objectCount);

    const objectCount = archive.devices.reduce((sum, d) => sum + d.objects.length, 0);

    return {
      graph,
      warnings: [],
      metadata: {
        sourceName: archive.name,
        deviceCount: archive.devices.length,
        objectCount,
        engines,
      },
    };
  },
};

function walkAndAdd(node: HierarchyNode, parentUri: string, graph: BrickGraph): void {
  for (const [seg, child] of node.children) {
    const childUri = `${parentUri}/${encodeURIComponent(seg)}`;
    const brickType = brickTypeForKind(child.kind);
    graph.addEntity(childUri, brickType);
    graph.addRelation(parentUri, 'hasPart', childUri);
    walkAndAdd(child, childUri, graph);
  }
}

function brickTypeForKind(kind: string): string {
  switch (kind) {
    case 'engine':
      return 'Controller';
    case 'fieldbus':
    case 'n2trunk':
    case 'bacnettrunk':
    case 'lontrunk':
      return 'Network';
    case 'equipment':
      return 'Equipment';
    case 'point':
      return 'Point';
    case 'schedule':
    case 'schedules':
      return 'Schedule';
    case 'alarm':
      return 'Alarm';
    default:
      return 'Equipment';
  }
}

export type { ParsedArchive };
