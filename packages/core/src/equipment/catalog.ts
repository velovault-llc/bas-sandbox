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
  /** Hard point capacity (vendor-published max universal I/O + extensions). */
  readonly maxPoints: number;
  /** Protocols the controller speaks natively. */
  readonly protocols: readonly Protocol[];
  /** Short marketing-grade description. */
  readonly notes: string;
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
    maxPoints: 32,
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
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'BACnet SC', 'N2'],
    notes: 'Smart Network Engine — site supervisor, BACnet/IP + MS/TP, hosts FEC trunks.',
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
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'Modbus TCP', 'Niagara Fox'],
    notes: 'Java Application Control Engine — the supervisor running the Niagara framework. Programs in Wiresheet (graphical FBD).',
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
    protocols: ['BACnet/IP', 'Modbus TCP', 'EtherCAT', 'KNX'],
    notes: 'DIN-rail IPC running TwinCAT 3. Full IEC 61131-3 — ST programs from this sandbox transfer cleanly.',
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
    protocols: ['BACnet/IP', 'Modbus TCP', 'EtherCAT', 'KNX', 'Niagara Fox'],
    notes: 'Atom x6-class IPC, larger plant duty. Runs TwinCAT 3 + can host Niagara Framework as a guest.',
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
    protocols: ['BACnet/IP', 'Modbus TCP', 'KNX'],
    notes: 'Compact open-PLC field controller. Programmed in e!COCKPIT (Codesys 3.5) — pure ST.',
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
