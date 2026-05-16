import { Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const BRICK = 'https://brickschema.org/schema/Brick#';

export type BrickEntity = {
  readonly uri: string;
  readonly type: string;
};

export class BrickGraph {
  private readonly store = new Store();

  addEntity(uri: string, brickClass: string): void {
    this.store.addQuad(namedNode(uri), namedNode(RDF_TYPE), namedNode(`${BRICK}${brickClass}`));
  }

  addRelation(subject: string, predicate: string, object: string): void {
    this.store.addQuad(
      namedNode(subject),
      namedNode(predicate.startsWith('http') ? predicate : `${BRICK}${predicate}`),
      namedNode(object),
    );
  }

  size(): number {
    return this.store.size;
  }

  entities(): BrickEntity[] {
    const result: BrickEntity[] = [];
    for (const quad of this.store.match(null, namedNode(RDF_TYPE), null, null)) {
      result.push({ uri: quad.subject.value, type: quad.object.value });
    }
    return result;
  }
}
