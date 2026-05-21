// Expansion-module catalog.
//
// Field controllers and supervisors often ship a smaller fixed onboard I/O
// count plus a bus or backplane for adding modules. This file catalogs the
// shipping expansion modules a tech actually pulls off the truck and clips
// onto a parent controller. Used today for documentation / About-page
// surfacing; the next layout pass will make these draggable on-canvas as
// child nodes that wire to a parent controller.

import type { PointCount } from './catalog.js';

export interface ExpansionModule {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  /** Marketing family — XPM (JCI), KL/EL (Beckhoff), 750-series (Wago), … */
  readonly family: string;
  /** Vendor name of controllers this module clips onto. */
  readonly compatibleWith: readonly string[];
  /** Points this module adds to the parent. */
  readonly addedPoints: PointCount;
  /** Short marketing-grade description. */
  readonly notes: string;
}

export const EXPANSION_CATALOG: readonly ExpansionModule[] = [
  // ── JCI Metasys XPM family ─────────────────────────────────────────────
  {
    id: 'jci-xpm-04',
    vendor: 'Johnson Controls',
    model: 'XPM-04',
    family: 'Metasys XPM',
    compatibleWith: ['Johnson Controls'],
    addedPoints: { UI: 4 },
    notes: '4-point universal input expansion module for FEC / NCE.',
  },
  {
    id: 'jci-xpm-08',
    vendor: 'Johnson Controls',
    model: 'XPM-08',
    family: 'Metasys XPM',
    compatibleWith: ['Johnson Controls'],
    addedPoints: { UI: 8 },
    notes: '8-point universal input expansion module.',
  },
  {
    id: 'jci-xpm-49',
    vendor: 'Johnson Controls',
    model: 'XPM-49',
    family: 'Metasys XPM',
    compatibleWith: ['Johnson Controls'],
    addedPoints: { UI: 6, BO: 8, AO: 4 },
    notes: 'Mixed I/O expansion module.',
  },

  // ── Beckhoff bus terminals (KL / EL series) ───────────────────────────
  {
    id: 'beckhoff-kl1408',
    vendor: 'Beckhoff',
    model: 'KL1408',
    family: 'K-Bus terminal',
    compatibleWith: ['Beckhoff'],
    addedPoints: { BI: 8 },
    notes: '8-channel digital input terminal, 24 VDC. K-bus.',
  },
  {
    id: 'beckhoff-kl2408',
    vendor: 'Beckhoff',
    model: 'KL2408',
    family: 'K-Bus terminal',
    compatibleWith: ['Beckhoff'],
    addedPoints: { BO: 8 },
    notes: '8-channel digital output terminal, 24 VDC / 0.5 A. K-bus.',
  },
  {
    id: 'beckhoff-kl3208',
    vendor: 'Beckhoff',
    model: 'KL3208-0010',
    family: 'K-Bus terminal',
    compatibleWith: ['Beckhoff'],
    addedPoints: { AI: 8 },
    notes: '8-channel Pt100/Pt1000/Ni RTD input terminal.',
  },
  {
    id: 'beckhoff-kl4424',
    vendor: 'Beckhoff',
    model: 'KL4424',
    family: 'K-Bus terminal',
    compatibleWith: ['Beckhoff'],
    addedPoints: { AO: 4 },
    notes: '4-channel 4–20 mA analog output terminal.',
  },
  {
    id: 'beckhoff-el3174',
    vendor: 'Beckhoff',
    model: 'EL3174',
    family: 'EtherCAT terminal',
    compatibleWith: ['Beckhoff'],
    addedPoints: { AI: 4 },
    notes: '4-channel analog input ±10V / 4–20mA, EtherCAT, oversampling-capable.',
  },

  // ── Wago 750-series ───────────────────────────────────────────────────
  {
    id: 'wago-750-461',
    vendor: 'Wago',
    model: '750-461',
    family: '750-series',
    compatibleWith: ['Wago'],
    addedPoints: { AI: 2 },
    notes: '2-channel Pt100 / Pt1000 RTD input module.',
  },
  {
    id: 'wago-750-559',
    vendor: 'Wago',
    model: '750-559',
    family: '750-series',
    compatibleWith: ['Wago'],
    addedPoints: { AO: 4 },
    notes: '4-channel 0–10V analog output.',
  },
  {
    id: 'wago-750-430',
    vendor: 'Wago',
    model: '750-430',
    family: '750-series',
    compatibleWith: ['Wago'],
    addedPoints: { BI: 8 },
    notes: '8-channel digital input, 24 VDC.',
  },
  {
    id: 'wago-750-530',
    vendor: 'Wago',
    model: '750-530',
    family: '750-series',
    compatibleWith: ['Wago'],
    addedPoints: { BO: 8 },
    notes: '8-channel digital output, 24 VDC / 0.5 A.',
  },

  // ── Siemens TXM (Apogee modular field panel) ───────────────────────
  {
    id: 'siemens-txm1-8u',
    vendor: 'Siemens',
    model: 'TXM1.8U',
    family: 'TXM',
    compatibleWith: ['Siemens'],
    addedPoints: { UI: 8 },
    notes: '8-point universal input island module for Apogee PXC Modular.',
  },
  {
    id: 'siemens-txm1-8x',
    vendor: 'Siemens',
    model: 'TXM1.8X',
    family: 'TXM',
    compatibleWith: ['Siemens'],
    addedPoints: { BO: 4, AO: 4 },
    notes: '4 binary out + 4 analog out island module.',
  },

  // ── Distech XP-modules (ECY family) ────────────────────────────────
  {
    id: 'distech-xp-tri',
    vendor: 'Distech Controls',
    model: 'XP-TRIO',
    family: 'XP',
    compatibleWith: ['Distech Controls'],
    addedPoints: { UI: 4, AO: 4, BO: 4 },
    notes: 'Compact expansion module — 4 UI + 4 AO + 4 BO. Wired by daisy-chain to an ECY parent.',
  },
];

export function findExpansionModule(id: string): ExpansionModule | undefined {
  return EXPANSION_CATALOG.find((m) => m.id === id);
}

export function expansionsByVendor(): Map<string, ExpansionModule[]> {
  const map = new Map<string, ExpansionModule[]>();
  for (const m of EXPANSION_CATALOG) {
    if (!map.has(m.vendor)) map.set(m.vendor, []);
    map.get(m.vendor)!.push(m);
  }
  return map;
}

/** Expansion modules compatible with a given controller vendor. */
export function expansionsForVendor(vendor: string): ExpansionModule[] {
  return EXPANSION_CATALOG.filter((m) => m.compatibleWith.includes(vendor));
}
