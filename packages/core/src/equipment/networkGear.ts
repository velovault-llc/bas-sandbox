// Dedicated BAS network appliances — purpose-built BBMD / IP-router /
// gateway hardware. These are NOT building controllers; they sit on
// the IP backbone bridging subnets, forwarding BACnet broadcasts, or
// translating between protocols. Most installs have at least one in
// the rack.
//
// Distinct from VENDOR_CATALOG (controllers + supervisors) because the
// behaviour and palette grouping is different — a tech browsing for
// "what BBMD do we own" doesn't want it mixed in with JACEs and
// PXC4s. The network sidebar surfaces these.

import type { Protocol } from './catalog.js';

export type NetworkGearKind =
  /** Pure BACnet/IP router (no BBMD). Bridges subnets, no broadcasts. */
  | 'router'
  /** Dedicated BBMD appliance. Optionally also routes. */
  | 'bbmd'
  /** BACnet/IP-to-MS/TP router (and frequently BBMD too). */
  | 'mstp-ip-router';

export interface NetworkGearModel {
  /** Stable id for the palette + scenarios. */
  readonly id: string;
  /** Maps to canvas node kind so the drop handler picks the right glyph
   *  + colour. */
  readonly nodeKind: 'router' | 'bbmd';
  readonly vendor: string;
  readonly model: string;
  readonly family: string;
  readonly kind: NetworkGearKind;
  /** Protocols carried on the device's ports. */
  readonly protocols: readonly Protocol[];
  /** Notes that a tech would actually care about. */
  readonly notes: string;
  /** Approximate list price band — useful for sales conversations.
   *  Ranges are rough public-market estimates. */
  readonly priceBand?: '$' | '$$' | '$$$';
}

export const NETWORK_GEAR_CATALOG: readonly NetworkGearModel[] = [
  // ── Contemporary Controls — the canonical commodity-tier BBMD ────────
  {
    id: 'cc-basr-nx',
    nodeKind: 'bbmd',
    vendor: 'Contemporary Controls',
    model: 'BASRTLX (BASrouter LX)',
    family: 'BASrouter',
    kind: 'mstp-ip-router',
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes:
      'Ubiquitous "throw this on the trunk" BACnet/IP ↔ MS/TP router with BBMD service. Web-config UI, no programming. Most common BBMD in the wild.',
    priceBand: '$',
  },
  {
    id: 'cc-basr-x',
    nodeKind: 'bbmd',
    vendor: 'Contemporary Controls',
    model: 'BASRTX (BASrouter)',
    family: 'BASrouter',
    kind: 'mstp-ip-router',
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes:
      'Standard BASrouter — same role as the LX but no LCD and a smaller chassis.',
    priceBand: '$',
  },

  // ── Cimetrics Eapi — the software-stack BBMD ─────────────────────────
  {
    id: 'cimetrics-eapi',
    nodeKind: 'bbmd',
    vendor: 'Cimetrics',
    model: 'Eapi BBMD',
    family: 'Eapi',
    kind: 'bbmd',
    protocols: ['BACnet/IP'],
    notes:
      'Software-stack BBMD that runs on a Windows or Linux server. Often used to add BBMD capability to a building without buying hardware.',
    priceBand: '$$',
  },

  // ── Loytec — Euro-side BACnet specialist ─────────────────────────────
  {
    id: 'loytec-l-inx-110',
    nodeKind: 'bbmd',
    vendor: 'Loytec',
    model: 'L-INX-110 (BBMD/router)',
    family: 'L-INX',
    kind: 'mstp-ip-router',
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes:
      'Loytec\'s small-footprint BACnet/IP ↔ MS/TP router with BBMD. Strong European install base; web-config with logging + diagnostics.',
    priceBand: '$$',
  },

  // ── Sierra Monitor / FieldServer (multi-protocol gateways) ───────────
  {
    id: 'fieldserver-pa-bp',
    nodeKind: 'router',
    vendor: 'Sierra Monitor / MSA',
    model: 'FieldServer ProtoNode',
    family: 'FieldServer',
    kind: 'router',
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'Modbus TCP', 'Modbus RTU'],
    notes:
      'Multi-protocol gateway. Routes BACnet but mostly used for cross-protocol translation (Modbus device exposed as BACnet AVs, etc.). Some firmware adds BBMD.',
    priceBand: '$$',
  },

  // ── ABB CGI BASrouter ───────────────────────────────────────────────
  {
    id: 'abb-cgi-basrouter',
    nodeKind: 'bbmd',
    vendor: 'ABB',
    model: 'CGI BASrouter',
    family: 'CGI',
    kind: 'mstp-ip-router',
    protocols: ['BACnet/IP', 'BACnet MS/TP'],
    notes:
      'ABB-branded BACnet/IP ↔ MS/TP router with BBMD. Often shipped with ABB Cylon-line installations.',
    priceBand: '$',
  },

  // ── Tridium JACE configured as router/BBMD ───────────────────────────
  {
    id: 'jace-as-bbmd',
    nodeKind: 'bbmd',
    vendor: 'Tridium',
    model: 'JACE (as BBMD)',
    family: 'Niagara',
    kind: 'bbmd',
    protocols: ['BACnet/IP', 'BACnet MS/TP', 'Niagara Fox'],
    notes:
      'A Niagara JACE can run BBMD service alongside its normal supervisor duties. Common when the install already has a JACE and you don\'t want a second box. (Prefer dropping a "Supervisor + Run BBMD service" if modeling that case.)',
    priceBand: '$$$',
  },
];

/** Look up a network gear model by id. */
export function findNetworkGear(id: string): NetworkGearModel | undefined {
  return NETWORK_GEAR_CATALOG.find((m) => m.id === id);
}

/** Group network gear by vendor — palette rendering. */
export function networkGearByVendor(): Map<string, NetworkGearModel[]> {
  const map = new Map<string, NetworkGearModel[]>();
  for (const m of NETWORK_GEAR_CATALOG) {
    if (!map.has(m.vendor)) map.set(m.vendor, []);
    map.get(m.vendor)!.push(m);
  }
  return map;
}
