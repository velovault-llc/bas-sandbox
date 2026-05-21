// Curated catalog of real-world BAS controllers.
//
// Each entry mirrors a shipping product as faithfully as public data allows:
//   - JCI Metasys family (NCE, SNE, FEC, FAC) — JCI's modern engine + field
//     controllers. Programmed in CCT block-graph (the .caf / .dbexport
//     format the sister project parses).
//   - Tridium JACE — the supervisor running the Niagara framework. Plus a
//     Spyder field controller (Niagara wiresheet under the hood).
//   - Beckhoff CX — DIN-rail IPCs running TwinCAT, full IEC 61131-3.
//   - Wago 750 / PFC — open-PLC field controllers, IEC 61131-3.
//   - Siemens PXC — Apogee BAS controller, programmed in PPCL.
//   - Distech ECY — VAV controller, GFX block + ECx script.
//   - Reliable MACH-Pro — Reliable Controls site supervisor, GCL+ script.
//
// Specs come from each vendor's published datasheets at the time of writing.
// The sandbox uses them for: palette labels, point-capacity hints,
// protocol-support pills, and an ST-portability check (real CCT/Niagara
// blocks won't run on a Beckhoff PLC and vice-versa).

export type ProgrammingLanguage =
  | 'IEC-61131-3 ST'
  | 'IEC-61131-3 (ST + LD + FBD)'
  | 'JCI CCT (block graph)'
  | 'Niagara Wiresheet'
  | 'Niagara Wiresheet + Sedona'
  | 'Siemens PPCL'
  | 'Distech GFX + ECx'
  | 'Reliable GCL+';

export type Protocol = 'BACnet/IP' | 'BACnet MS/TP' | 'BACnet SC' | 'N2' | 'LON' | 'Modbus TCP' | 'Modbus RTU' | 'KNX' | 'Niagara Fox' | 'EtherCAT' | 'Sox';

export type ControllerRole = 'supervisor' | 'field' | 'plant' | 'unitary';

/**
 * Breakdown of onboard I/O points by ASHRAE point-type convention.
 * UI = Universal Input (configurable: AI or BI per channel)
 * AI = Analog Input (fixed)
 * BI = Binary Input (fixed)
 * UO = Universal Output (configurable: AO or BO)
 * AO = Analog Output (fixed)
 * BO = Binary Output (fixed, relay or triac)
 *
 * `expansion` counts the additional points reachable via vendor expansion
 * modules (Beckhoff bus terminals, JCI XPM extensions, etc.). On a
 * field-controller with FIXED onboard I/O, `expansion` is typically 0.
 * On a modular IPC (Beckhoff CX, Wago PFC) the onboard UI/AI/etc. are 0
 * and `expansion` carries the bus-capacity number.
 */
export interface PointCount {
  readonly UI?: number;
  readonly AI?: number;
  readonly BI?: number;
  readonly UO?: number;
  readonly AO?: number;
  readonly BO?: number;
  readonly expansion?: number;
}

export interface ControllerModel {
  /** Stable id for palette / scenarios. */
  readonly id: string;
  /** Vendor name as marketed. */
  readonly vendor: string;
  /** Product model number. */
  readonly model: string;
  /** Marketing family / line. */
  readonly family: string;
  /** Functional role. */
  readonly role: ControllerRole;
  /** Native programming language. */
  readonly programmingLanguage: ProgrammingLanguage;
  /** Whether IEC 61131-3 Structured Text programs from this sandbox can be
   *  considered "portable" to this controller (true for IEC-native gear;
   *  false for block-graph / proprietary stacks where ST is non-native). */
  readonly stPortable: boolean;
  /** Hard point capacity (vendor-published max universal I/O + extensions).
   *  Headline number used when the breakdown isn't useful (supervisors). */
  readonly maxPoints: number;
  /** Onboard I/O breakdown by point type. Optional — supervisors typically
   *  omit and rely on maxPoints as the total via downstream field
   *  controllers. */
  readonly points?: PointCount;
  /** Protocols the controller speaks natively. */
  readonly protocols: readonly Protocol[];
  /** Short marketing-grade description. */
  readonly notes: string;
}

/** Total onboard points (UI + AI + BI + UO + AO + BO + expansion). */
export function totalPoints(p: PointCount | undefined): number {
  if (!p) return 0;
  return (p.UI ?? 0) + (p.AI ?? 0) + (p.BI ?? 0) + (p.UO ?? 0) + (p.AO ?? 0) + (p.BO ?? 0) + (p.expansion ?? 0);
}

/** Total FIXED onboard points (excludes `expansion`). The terminal-handle UI
 *  only renders dots for these; expansion points are accessed via separate
 *  expansion-module nodes. */
export function fixedOnboardPoints(p: PointCount | undefined): number {
  if (!p) return 0;
  return (p.UI ?? 0) + (p.AI ?? 0) + (p.BI ?? 0) + (p.UO ?? 0) + (p.AO ?? 0) + (p.BO ?? 0);
}

/** Generate the list of per-point terminal labels for a controller. The
 *  caller decides whether to render them — if the count is large the UI
 *  falls back to a single generic handle. */
export interface TerminalLabel {
  /** Terminal id like "UI-1", "BO-3". */
  readonly id: string;
  /** Type tag for grouping. */
  readonly kind: 'UI' | 'AI' | 'BI' | 'UO' | 'AO' | 'BO';
  /** 1-indexed channel number within the kind. */
  readonly n: number;
  /** Whether this is an input or output on the node side. */
  readonly direction: 'in' | 'out';
}

export function generateTerminals(p: PointCount | undefined): TerminalLabel[] {
  if (!p) return [];
  const out: TerminalLabel[] = [];
  const kinds: { kind: TerminalLabel['kind']; count: number; direction: 'in' | 'out' }[] = [
    { kind: 'UI', count: p.UI ?? 0, direction: 'in' },
    { kind: 'AI', count: p.AI ?? 0, direction: 'in' },
    { kind: 'BI', count: p.BI ?? 0, direction: 'in' },
    { kind: 'UO', count: p.UO ?? 0, direction: 'out' },
    { kind: 'AO', count: p.AO ?? 0, direction: 'out' },
    { kind: 'BO', count: p.BO ?? 0, direction: 'out' },
  ];
  for (const k of kinds) {
    for (let n = 1; n <= k.count; n++) {
      out.push({ id: `${k.kind}-${n}`, kind: k.kind, n, direction: k.direction });
    }
  }
  return out;
}

/** Single-line "12 UI · 4 BO · 2 AO" summary for inspector + CLI surfaces. */
export function formatPointBreakdown(p: PointCount | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.UI) parts.push(`${p.UI} UI`);
  if (p.AI) parts.push(`${p.AI} AI`);
  if (p.BI) parts.push(`${p.BI} BI`);
  if (p.UO) parts.push(`${p.UO} UO`);
  if (p.AO) parts.push(`${p.AO} AO`);
  if (p.BO) parts.push(`${p.BO} BO`);
  if (p.expansion) parts.push(`${p.expansion} via expansion`);
  return parts.join(' · ');
}

export const VENDOR_CATALOG: readonly ControllerModel[] = [
  // ── JCI Metasys ────────────────────────────────────────────────────────
  {
    id: 'jci-fec2611',
    vendor: 'Johnson Controls',
    model: 'FEC2611',
    family: 'Metasys FEC',
    role: 'field',
    programmingLanguage: 'JCI CCT (block graph)',
    stPortable: false,
    maxPoints: 17,
    points: { UI: 7, BI: 4, AO: 2, BO: 4 },
    protocols: ['BACnet MS/TP'],
    notes: 'Generic field equipment controller; common AHU/VAV duty. Programs in CCT block-graph (the .caf format).',
  },
  {
    id: 'jci-nce25',
    vendor: 'Johnson Controls',
    model: 'NCE25',
    family: 'Metasys NCE',
    role: 'plant',
    programmingLanguage: 'JCI CCT (block graph)',
    stPortable: false,
    maxPoints: 33,
    points: { UI: 10, BI: 8, AO: 4, BO: 4, expansion: 7 },
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes: 'Network Control Engine — combo engine + onboard I/O for small plant rooms.',
  },
  {
    id: 'jci-sne10500',
    vendor: 'Johnson Controls',
    model: 'SNE10500',
    family: 'Metasys SNE',
    role: 'supervisor',
    programmingLanguage: 'JCI CCT (block graph)',
    stPortable: false,
    maxPoints: 1500,
    points: { expansion: 1500 },
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'BACnet SC', 'N2'],
    notes: 'Smart Network Engine — site supervisor, BACnet/IP + MS/TP, hosts FEC trunks. Points are reachable via downstream field controllers (no native onboard I/O).',
  },

  // ── Tridium / Niagara ──────────────────────────────────────────────────
  {
    id: 'tridium-jace-8000',
    vendor: 'Tridium',
    model: 'JACE 8000',
    family: 'Niagara',
    role: 'supervisor',
    programmingLanguage: 'Niagara Wiresheet',
    stPortable: false,
    maxPoints: 5000,
    points: { expansion: 5000 },
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'Modbus TCP', 'Niagara Fox'],
    notes: 'Java Application Control Engine — the supervisor running the Niagara framework. No onboard I/O; points reachable via JENEsys IO modules + downstream field controllers.',
  },
  {
    id: 'tridium-spyder-econ-t19',
    vendor: 'Honeywell',
    model: 'CIPer Spyder T19',
    family: 'Spyder',
    role: 'field',
    programmingLanguage: 'Niagara Wiresheet + Sedona',
    stPortable: false,
    maxPoints: 19,
    points: { UI: 8, BI: 3, AO: 4, BO: 4 },
    protocols: ['BACnet MS/TP'],
    notes: 'Honeywell field controller running Niagara/Sedona under the hood; 19 onboard points.',
  },

  // ── Beckhoff (open IEC-61131-3) ────────────────────────────────────────
  {
    id: 'beckhoff-cx9020',
    vendor: 'Beckhoff',
    model: 'CX9020',
    family: 'Embedded PC',
    role: 'plant',
    programmingLanguage: 'IEC-61131-3 (ST + LD + FBD)',
    stPortable: true,
    maxPoints: 1024,
    points: { expansion: 1024 },
    protocols: ['BACnet/IP', 'Modbus TCP', 'EtherCAT', 'KNX'],
    notes: 'DIN-rail IPC running TwinCAT 3. No fixed onboard I/O — uses Beckhoff bus terminals (KL/EL series) clipped on to the right side. Full IEC 61131-3 — ST programs from this sandbox transfer cleanly.',
  },
  {
    id: 'beckhoff-cx5230',
    vendor: 'Beckhoff',
    model: 'CX5230',
    family: 'Embedded PC',
    role: 'supervisor',
    programmingLanguage: 'IEC-61131-3 (ST + LD + FBD)',
    stPortable: true,
    maxPoints: 4096,
    points: { expansion: 4096 },
    protocols: ['BACnet/IP', 'Modbus TCP', 'EtherCAT', 'KNX', 'Niagara Fox'],
    notes: 'Atom x6-class IPC, larger plant duty. No fixed onboard I/O — modular via bus terminals. Runs TwinCAT 3 + can host Niagara Framework as a guest.',
  },

  // ── Wago / Phoenix Contact (open IEC) ──────────────────────────────────
  {
    id: 'wago-pfc200',
    vendor: 'Wago',
    model: '750-8212 PFC200',
    family: 'PFC',
    role: 'field',
    programmingLanguage: 'IEC-61131-3 ST',
    stPortable: true,
    maxPoints: 250,
    points: { expansion: 250 },
    protocols: ['BACnet/IP', 'Modbus TCP', 'KNX'],
    notes: 'Compact open-PLC field controller. No fixed onboard I/O — uses Wago 750-series modules. Programmed in e!COCKPIT (Codesys 3.5) — pure ST.',
  },

  // ── Siemens Apogee ─────────────────────────────────────────────────────
  {
    id: 'siemens-pxc-100',
    vendor: 'Siemens',
    model: 'PXC100-E.D',
    family: 'Apogee',
    role: 'field',
    programmingLanguage: 'Siemens PPCL',
    stPortable: false,
    maxPoints: 100,
    points: { UI: 12, BI: 8, AO: 6, BO: 6, expansion: 68 },
    protocols: ['BACnet MS/TP', 'BACnet/IP'],
    notes: 'Apogee field panel. Programs in Powers Process Control Language — BASIC-flavored text, not ST.',
  },
  {
    id: 'siemens-pxc-modular',
    vendor: 'Siemens',
    model: 'PXC Modular',
    family: 'Apogee',
    role: 'plant',
    programmingLanguage: 'Siemens PPCL',
    stPortable: false,
    maxPoints: 480,
    points: { expansion: 480 },
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'LON'],
    notes: 'Modular Apogee panel for medium plant rooms. PPCL programming.',
  },

  // ── Distech (Niagara family) ───────────────────────────────────────────
  {
    id: 'distech-ecy-vav',
    vendor: 'Distech Controls',
    model: 'ECY-VAV',
    family: 'ECY',
    role: 'unitary',
    programmingLanguage: 'Distech GFX + ECx',
    stPortable: false,
    maxPoints: 10,
    points: { UI: 5, AO: 2, BO: 3 },
    protocols: ['BACnet MS/TP'],
    notes: 'Single-duct VAV unitary controller. Programs in EC-gfxProgram (GFX block graph) + ECx scripting.',
  },

  // ── Reliable Controls ──────────────────────────────────────────────────
  {
    id: 'reliable-mach-prosys',
    vendor: 'Reliable Controls',
    model: 'MACH-ProSys',
    family: 'MACH-Pro',
    role: 'supervisor',
    programmingLanguage: 'Reliable GCL+',
    stPortable: false,
    maxPoints: 1024,
    points: { UI: 16, AO: 4, BO: 4, expansion: 1000 },
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes: 'Site supervisor, IP + MS/TP. Programs in GCL+ — a vendor-specific scripting language.',
  },
];

/** Look up a controller model by id. */
export function findControllerModel(id: string): ControllerModel | undefined {
  return VENDOR_CATALOG.find((m) => m.id === id);
}

/** Group catalog by vendor — useful for palette rendering. */
export function controllerCatalogByVendor(): Map<string, ControllerModel[]> {
  const map = new Map<string, ControllerModel[]>();
  for (const m of VENDOR_CATALOG) {
    if (!map.has(m.vendor)) map.set(m.vendor, []);
    map.get(m.vendor)!.push(m);
  }
  return map;
}
