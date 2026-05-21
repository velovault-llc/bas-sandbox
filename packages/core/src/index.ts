export const VERSION = '0.0.0';

export { BrickGraph } from './brick.js';
export type { BrickEntity } from './brick.js';

export {
  geocodeCity,
  fetchCurrentWeather,
  fetchForecastHourly,
  fetchHistoricalHourly,
  sampleAt,
  OPEN_METEO_ATTRIBUTION,
  _resetWeatherCache,
} from './weather.js';
export type {
  GeocodedLocation,
  WeatherSample,
  WeatherSeries,
  WeatherResult,
} from './weather.js';

export {
  compile,
  tokenize,
  parse,
  runProgram,
  makeEnv,
  LexError,
  ParseError,
  RuntimeError,
} from './st/index.js';

export {
  VENDOR_CATALOG,
  findControllerModel,
  controllerCatalogByVendor,
  totalPoints,
  fixedOnboardPoints,
  generateTerminals,
  formatPointBreakdown,
} from './equipment/catalog.js';
export type {
  ControllerModel,
  ControllerRole,
  ProgrammingLanguage,
  Protocol,
  PointCount,
  TerminalLabel,
} from './equipment/catalog.js';

export {
  SENSOR_CATALOG,
  findSensorModel,
  sensorCatalogBySubject,
} from './equipment/sensors.js';
export type {
  SensorModel,
  SensorSubject,
  SensorSignal,
  SensorMounting,
} from './equipment/sensors.js';

export {
  SAFETY_CATALOG,
  findSafetyDevice,
  safetyCatalogByKind,
} from './equipment/safeties.js';
export type {
  SafetyDevice,
  SafetyKind,
  SafetyResetBehavior,
} from './equipment/safeties.js';

export {
  EXPANSION_CATALOG,
  findExpansionModule,
  expansionsByVendor,
  expansionsForVendor,
} from './equipment/expansions.js';
export type { ExpansionModule } from './equipment/expansions.js';

export { SCENARIO_LIBRARY, findScenario } from './scenarios/index.js';
export type {
  ScenarioDefinition,
  EquipmentRequirement,
  WireRequirement,
  ProgramSpec,
  RuntimeCheck,
  ScenarioDifficulty,
} from './scenarios/index.js';

export { BLOCK_LIBRARY, compileFbd } from './fbd/index.js';
export type {
  BlockTypeDef,
  BlockPort,
  PortType,
  FbdGraph,
  FbdNode,
  FbdEdge,
  FbdCompileResult,
} from './fbd/index.js';
export type {
  CompileResult,
  Env as StEnv,
  Program as StProgram,
  Token as StToken,
} from './st/index.js';

export type IngestPlugin = {
  readonly id: string;
  readonly displayName: string;
  readonly accepts: readonly string[];
  /** Validators that operate on the plugin-specific `vendor` data in the ingest result. */
  readonly validators?: readonly Validator[];
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
  /** Plugin-specific raw data made available to validators. Opaque to the UI. */
  vendor?: unknown;
};

export type Severity = 'error' | 'warning' | 'info';

export type ValidationFinding = {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly title: string;
  readonly description?: string;
  /** Subject (usually a ref or URI) the finding pertains to. */
  readonly subject?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

export type ValidationCategory = 'integrity' | 'config' | 'safety' | 'design';

export type ValidationContext = {
  readonly graph: import('./brick.js').BrickGraph;
  readonly vendor: unknown;
};

export type Validator = {
  readonly id: string;
  readonly displayName: string;
  readonly category: ValidationCategory;
  validate(ctx: ValidationContext): readonly ValidationFinding[];
};
