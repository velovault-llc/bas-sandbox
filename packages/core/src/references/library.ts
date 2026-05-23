// Resource library — the authoritative reference catalog the sandbox
// (and the LLM Assistant) draws from. Every entry has provenance:
// where the claim comes from, what spec section / source file backs
// it, and a link the user can follow to validate independently.
//
// This is the "if the AI says X, you can audit it" layer. Federal
// evaluators care; field techs care; we care. The catalog is also
// the search index for the in-site Library tab.
//
// Adding a new reference: append a LibraryEntry to the LIBRARY array
// below. Keep id stable (it's used in URL fragments + cross-refs);
// keep tags lowercase + dash-separated for consistent search.

/** Top-level taxonomy. Drives the filter chips in the UI. */
export type LibraryCategory =
  /** Authoritative protocol standards: ASHRAE 135 + addenda, ISO. */
  | 'standard'
  /** Open-source reference implementations we treat as canonical. */
  | 'reference-impl'
  /** Vendor documentation (JCI, Tridium, Schneider, etc.). */
  | 'vendor'
  /** Industry training, certifications, conformance programs. */
  | 'training'
  /** Tooling (Wireshark, YABE, sniffers). */
  | 'tool'
  /** ASHRAE-registered tables (vendor IDs, engineering units, etc.). */
  | 'registry'
  /** In-tree sandbox files. Lets the user navigate to our source. */
  | 'in-tree';

/** A single source pointer attached to an entry. An entry can carry
 *  multiple sources (e.g., spec clause + the bacpypes3 implementation
 *  of that clause + a Wireshark dissector function for it). */
export interface LibrarySource {
  /** Short label rendered as the link text. */
  readonly label: string;
  /** URL the user opens. Empty when the source is in-tree (use `path`). */
  readonly url?: string;
  /** Relative path inside this repo for in-tree sources. */
  readonly path?: string;
  /** Note distinguishing this source from others on the same entry. */
  readonly note?: string;
}

export interface LibraryEntry {
  /** Stable identifier. Used in URL fragments + deep links from
   *  conformance findings. Keep it short + readable. */
  readonly id: string;
  /** Human-readable title for the card. */
  readonly title: string;
  readonly category: LibraryCategory;
  /** 1-3 sentence summary. What this entry IS. */
  readonly summary: string;
  /** Why a sandbox user / BAS tech would care. The "so what" line. */
  readonly relevance: string;
  /** Lower-cased dash-separated tags for search. */
  readonly tags: readonly string[];
  /** Where to look. Usually 1-3 sources. */
  readonly sources: readonly LibrarySource[];
  /** Spec sections / clauses this entry covers (when applicable).
   *  Format like "ASHRAE 135 §16.10.2" or "BTL §3.2". The conformance
   *  panel uses these to deep-link into the library. */
  readonly citations?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// Entries
// ─────────────────────────────────────────────────────────────────────

export const LIBRARY: readonly LibraryEntry[] = [
  // ═══════════════════════════════════════════════════════════════════
  // Standards
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'ashrae-135-2024',
    title: 'ASHRAE Standard 135-2024 — BACnet',
    category: 'standard',
    summary:
      'The current BACnet protocol standard. Defines every BACnet service, PDU encoding, object type, and property. ~1500 pages.',
    relevance:
      "The source of truth. When the sandbox says 'ASHRAE 135 §X.Y.Z requires field Foo', this is the document. Now free to read.",
    tags: ['bacnet', 'spec', 'standard', 'ashrae', 'protocol'],
    sources: [
      {
        label: 'Free read-only PDF (browser)',
        url: 'https://ashrae.iwrapper.com/ASHRAE_PREVIEW_ONLY_STANDARDS/STD_135_2024',
        note: "No signup. Can't be saved/printed but every clause is readable.",
      },
      {
        label: 'ASHRAE bookstore (paid PDF)',
        url: 'https://www.ashrae.org/technical-resources/bookstore/bacnet',
        note: '$200 USD for offline-usable PDF.',
      },
    ],
  },
  {
    id: 'ashrae-135-addenda',
    title: 'ASHRAE 135 addenda + errata',
    category: 'standard',
    summary:
      'Published addenda and errata to the BACnet standard. Free. Useful when the released spec is corrected mid-cycle or extended between major revisions.',
    relevance:
      'Recent additions like BACnet/SC (secure connect), Color objects, and Device Proxying live here before they roll into the next major rev.',
    tags: ['bacnet', 'spec', 'addenda', 'errata'],
    sources: [
      {
        label: 'ASHRAE addenda page',
        url: 'https://www.ashrae.org/technical-resources/standards-and-guidelines/standards-addenda',
      },
    ],
  },
  {
    id: 'ashrae-135-engineering-units',
    title: 'ASHRAE 135 §21 — Engineering Units enum',
    category: 'standard',
    summary:
      'Numeric codes for every BACnet engineering unit (°F=64, °C=62, kPa=54, %=98, ppm=96, etc.). When a sandbox AI object emits Units, the value comes from this enum.',
    relevance:
      'If a tech sees "Units: 64" on a sniffer, they should immediately know that means degrees-Fahrenheit. The full table is in §21.',
    tags: ['bacnet', 'units', 'enum', 'spec'],
    sources: [
      {
        label: 'ASHRAE 135-2024 §21 (free preview)',
        url: 'https://ashrae.iwrapper.com/ASHRAE_PREVIEW_ONLY_STANDARDS/STD_135_2024',
      },
    ],
    citations: ['ASHRAE 135 §21'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Reference implementations
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'bacpypes3',
    title: 'bacpypes3 — Python BACnet stack',
    category: 'reference-impl',
    summary:
      'asyncio-based BACnet reference implementation. Joel Bender (former BACnet SSPC member) maintains it. Spec-faithful and readable.',
    relevance:
      "When the sandbox says 'we emit X', the easiest way to verify is to read bacpypes3's equivalent emission. Pip install it, run it locally, compare. Replaces the original `bacpypes` (which depends on the removed Python `asyncore` module).",
    tags: ['bacnet', 'python', 'reference', 'source-code', 'bacpypes'],
    sources: [
      {
        label: 'GitHub repo',
        url: 'https://github.com/JoelBender/bacpypes3',
      },
      {
        label: 'PyPI package',
        url: 'https://pypi.org/project/bacpypes3/',
      },
      {
        label: 'Local sandbox runner: bacserv.py',
        path: 'tools/bacnet-reference/bacserv.py',
      },
    ],
  },
  {
    id: 'bacnet-stack',
    title: 'bacnet-stack — C BACnet reference implementation',
    category: 'reference-impl',
    summary:
      'Mature open-source BACnet stack in C. Used in production by hundreds of vendors. ASHRAE-aligned with comments referencing spec clauses.',
    relevance:
      'When you want to see how a production-grade C stack does it, this is the canonical answer. Pre-built Windows binaries available on SourceForge.',
    tags: ['bacnet', 'c', 'reference', 'source-code'],
    sources: [
      {
        label: 'GitHub repo',
        url: 'https://github.com/bacnet-stack/bacnet-stack',
      },
      {
        label: 'SourceForge releases (binaries)',
        url: 'https://sourceforge.net/projects/bacnet/files/bacnet-stack/',
      },
    ],
  },
  {
    id: 'wireshark-bacapp-dissector',
    title: 'Wireshark BACnet dissector source',
    category: 'reference-impl',
    summary:
      "Wireshark's BACnet APDU dissector — packet-bacapp.c. Decodes every service the spec defines, with inline comments pointing to §-clauses.",
    relevance:
      'Reading the dissector teaches the spec by example. Every service has a function that parses its tagged encoding into named fields. Best free way to learn PDU layout.',
    tags: ['bacnet', 'wireshark', 'dissector', 'source-code', 'pdu'],
    sources: [
      {
        label: 'packet-bacapp.c on GitHub',
        url: 'https://github.com/wireshark/wireshark/blob/master/epan/dissectors/packet-bacapp.c',
      },
      {
        label: 'packet-bvlc.c on GitHub',
        url: 'https://github.com/wireshark/wireshark/blob/master/epan/dissectors/packet-bvlc.c',
        note: 'BVLC (Annex J) wrapper layer.',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Vendor docs (JCI heavy because that's what we have)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'jci-fan-410',
    title: 'JCI FAN-410 — Metasys Installation Quick Reference Handbook',
    category: 'vendor',
    summary:
      "JCI's field reference for HVAC controls cable + wiring standards + best practices. Compact handbook used by Metasys install crews.",
    relevance:
      "The closest thing to a 'cheat sheet' for real-world JCI installations. Wiring colors, terminal layouts, common mistakes.",
    tags: ['jci', 'johnson-controls', 'metasys', 'install', 'wiring', 'cable', 'fan-410'],
    sources: [
      {
        label: 'iOS app (free)',
        url: 'https://apps.apple.com/us/app/fan-410-installation-reference/id1527588808',
        note: 'Handbook content embedded in app. Best non-employee access.',
      },
      {
        label: 'JCI partner portal',
        url: 'https://docs.johnsoncontrols.com/',
        note: 'PDF available behind certified-tech login.',
      },
    ],
  },
  {
    id: 'jci-metasys-smp-help',
    title: 'JCI Metasys Site Management Portal Help',
    category: 'vendor',
    summary:
      "790-page user manual for the Metasys supervisor side. Documents every Metasys BACnet object's attribute table, alarm extensions, scheduling primitives.",
    relevance:
      "Bridges ASHRAE 135 'this is what's in the spec' with 'this is what JCI shipped'. Has the JCI proprietary attribute extensions (Use COV Min Send Time, etc.) that our object catalog references.",
    tags: ['jci', 'metasys', 'smp', 'help', 'documentation'],
    sources: [
      {
        label: 'Local file (user PC)',
        path: 'C:/Users/jmsbo/Desktop/jci/PDF ExportJCImetasysobjecthelp.pdf',
      },
      {
        label: 'OpenBlue Knowledge Exchange',
        url: 'https://docs.johnsoncontrols.com/bas/r/Metasys/',
      },
    ],
  },
  {
    id: 'jci-cct-help',
    title: 'JCI CCT — Controller Configuration Tool help',
    category: 'vendor',
    summary:
      "Help docs for JCI's controller programming environment. Block-graph language for FEC / NCE / NAE controllers.",
    relevance:
      "The sister project (dbexport-viewer) mines this for class IDs and block names. When the sandbox imports a `.dbexport`, the block names come from here.",
    tags: ['jci', 'cct', 'controller-configuration-tool', 'block-graph', 'fbd'],
    sources: [
      {
        label: 'Local file (user PC)',
        path: 'C:/Users/jmsbo/Desktop/jci/PDF Exportcct help.pdf',
      },
    ],
  },
  {
    id: 'tridium-niagara-docs',
    title: 'Tridium Niagara documentation',
    category: 'vendor',
    summary:
      "Documentation for Tridium's Niagara Framework. Most JACEs (JACE-8000, JACE-9000, Honeywell WEBs) run Niagara.",
    relevance:
      'When the sandbox shows a JACE in a topology, this is where the real product behaviors live. Wiresheet, modules, station structure.',
    tags: ['tridium', 'niagara', 'jace', 'wiresheet'],
    sources: [
      {
        label: 'Tridium docs portal',
        url: 'https://docs.tridium.com/',
      },
    ],
  },
  {
    id: 'schneider-ecostruxure',
    title: 'Schneider Electric EcoStruxure Building Operation',
    category: 'vendor',
    summary:
      "Schneider's BAS platform. AS-P (SmartX Server) is the supervisor; AS-B is the smaller server-lite. Programs in IEC-61131-3 ST.",
    relevance:
      "Alternative to Niagara/Metasys; competes head-to-head in large commercial. The sandbox's supervisor catalog includes AS-P / AS-B; this is the source.",
    tags: ['schneider', 'ecostruxure', 'smartx', 'as-p', 'as-b'],
    sources: [
      {
        label: 'Schneider docs',
        url: 'https://www.se.com/us/en/work/products/building-management/',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Sequences of operation (the "what should this controller DO")
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'ashrae-g36',
    title: 'ASHRAE Guideline 36 — High-Performance Sequences of Operation',
    category: 'standard',
    summary:
      "The standard reference for how a competent BAS programmer writes AHU, VAV, and chilled/hot water plant sequences. §5.18 covers single-zone VAV AHU — the sequence our vAHU implements.",
    relevance:
      "When the sandbox runs a vAHU, this is the spec it follows. Mode logic, economizer enable, SAT-SP reset, valve PI control — all anchored here. Free for ASHRAE members; otherwise paywall, but the published preview covers most of the structure.",
    tags: ['ashrae', 'g36', 'sequence', 'ahu', 'vav', 'g36-section-5-18'],
    sources: [
      {
        label: 'ASHRAE G36-2021 product page',
        url: 'https://www.ashrae.org/technical-resources/ashrae-standards-and-guidelines',
        note: 'Guideline 36-2021 is the current version.',
      },
      {
        label: 'Sandbox vAHU implementation',
        path: 'packages/core/src/vahu/step.ts',
      },
      {
        label: 'Sandbox vAHU BACnet object surface',
        path: 'packages/core/src/vahu/bacnet.ts',
      },
    ],
    citations: ['ASHRAE G36 §5.18.1', 'ASHRAE G36 §5.18.2', 'ASHRAE G36 §5.18.3', 'ASHRAE G36 §5.18.4', 'ASHRAE G36 §5.18.6'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Training / conformance
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'btl',
    title: 'BACnet Testing Laboratories (BTL)',
    category: 'training',
    summary:
      'Conformance test program + listings for certified BACnet devices. BTL certification means a vendor passed an independent compliance audit.',
    relevance:
      "When the sandbox claims 'we'd pass BTL for service X', this is what we'd actually be tested against. Listings show real products + their conformance level.",
    tags: ['btl', 'conformance', 'certification', 'testing'],
    sources: [
      {
        label: 'BTL home',
        url: 'https://www.bacnetinternational.net/btl/',
      },
      {
        label: 'BTL product listings (BIBBs)',
        url: 'https://www.bacnetinternational.net/btl/index.php?m=46',
      },
    ],
  },
  {
    id: 'hvacredu-metasys-tech',
    title: 'HVACRedu — Metasys Tech Program',
    category: 'training',
    summary:
      'Online training for JCI Metasys technicians. Course 410 is "Metasys Basic Operator" — the entry-level cert.',
    relevance:
      'When the sandbox is positioned as "BAS training tool", these are the courses we complement / compete with.',
    tags: ['training', 'metasys', 'jci', 'course'],
    sources: [
      {
        label: 'HVACRedu Metasys Tech Program',
        url: 'https://www.hvacredu.net/metasys_tech_program/',
      },
      {
        label: 'Course 410 — Metasys Basic Operator',
        url: 'https://www.hvacredu.net/course_410-2/',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Tools
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'wireshark',
    title: 'Wireshark — packet capture + analysis',
    category: 'tool',
    summary:
      "Industry-standard packet analyzer. Includes a BACnet dissector that decodes every PDU into named fields. Free, cross-platform.",
    relevance:
      "When the sandbox emits a packet and you want to know if a real device would interpret it the same, Wireshark is the arbiter. The bas-sandbox compares its packet log against captures from this tool.",
    tags: ['wireshark', 'tool', 'capture', 'pcap', 'dissector'],
    sources: [
      {
        label: 'Wireshark home + download',
        url: 'https://www.wireshark.org/',
      },
      {
        label: 'Sandbox setup guide',
        path: 'tools/bacnet-reference/WIRESHARK.md',
      },
    ],
  },
  {
    id: 'yabe',
    title: 'YABE — Yet Another BACnet Explorer',
    category: 'tool',
    summary:
      "Free, open-source BACnet explorer for Windows. Discovers devices, browses object trees, reads/writes properties, subscribes to COVs. The default 'sniffer' in many shops.",
    relevance:
      "Often the first tool a tech reaches for to verify 'is this BACnet device alive and what's on it'. The sandbox's BACnet packet log style is modeled after YABE's display.",
    tags: ['yabe', 'tool', 'explorer', 'bacnet'],
    sources: [
      {
        label: 'YABE on SourceForge',
        url: 'https://sourceforge.net/projects/yetanotherbacnetexplorer/',
      },
    ],
  },
  {
    id: 'sandbox-bacserv',
    title: 'sandbox — local bacpypes3 reference device',
    category: 'tool',
    summary:
      "In-repo runner that brings up a real bacpypes3 BACnet device on UDP 47808. The ground-truth peer used to validate sandbox emissions byte-for-byte.",
    relevance:
      "Run this alongside the sandbox + a Wireshark capture, and you can prove the sandbox emits the same wire bytes as a published BACnet stack.",
    tags: ['bacpypes3', 'bacserv', 'reference', 'tool'],
    sources: [
      {
        label: 'In-tree script',
        path: 'tools/bacnet-reference/bacserv.py',
      },
      {
        label: 'Companion Who-Is client',
        path: 'tools/bacnet-reference/whois_client.py',
      },
      {
        label: 'Companion ReadProperty client',
        path: 'tools/bacnet-reference/read_property.py',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Registries
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'bacnet-vendor-ids',
    title: 'BACnet vendor identifier registry',
    category: 'registry',
    summary:
      'ASHRAE-maintained list of registered BACnet vendor IDs. JCI=5, Tridium=37, Beckhoff=86, Wago=110, Siemens=7, Honeywell=17, Reliable=260, Schneider=10, etc.',
    relevance:
      "Every I-Am carries a Vendor ID; the registry tells you who made the device. The sandbox's vendorIdFor() function uses this mapping.",
    tags: ['vendor-id', 'registry', 'bacnet', 'i-am'],
    sources: [
      {
        label: 'Official ASHRAE registry',
        url: 'http://www.bacnet.org/VendorID/BACnet%20Vendor%20IDs.htm',
      },
    ],
  },
  {
    id: 'bacnet-property-ids',
    title: 'BACnet property identifier table (§12 / §21)',
    category: 'registry',
    summary:
      "Numeric property IDs for every BACnet property. Examples: present-value=85, status-flags=111, units=117, object-name=77, vendor-identifier=120.",
    relevance:
      "When the sandbox emits 'present-value (85)', the 85 is from this table. Every property name maps to a fixed numeric ID that wire-level tooling shows.",
    tags: ['property-id', 'registry', 'bacnet', 'spec'],
    sources: [
      {
        label: 'In-tree object catalog (cross-ref)',
        path: 'packages/core/src/bacnet/objectCatalog.ts',
      },
      {
        label: 'ASHRAE 135-2024 §21 (free read)',
        url: 'https://ashrae.iwrapper.com/ASHRAE_PREVIEW_ONLY_STANDARDS/STD_135_2024',
      },
    ],
    citations: ['ASHRAE 135 §12', 'ASHRAE 135 §21'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // In-tree
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'sandbox-object-catalog',
    title: 'sandbox — BACnet object catalog',
    category: 'in-tree',
    summary:
      "Curated catalog of BACnet object types + their properties + JCI-specific extensions. Combines ASHRAE 135 §12 with JCI Metasys SMP attribute tables.",
    relevance:
      "What the conformance checker uses to validate that the sandbox's emissions cover the spec-required properties for each object type.",
    tags: ['catalog', 'object-types', 'properties', 'in-tree'],
    sources: [
      {
        label: 'objectCatalog.ts',
        path: 'packages/core/src/bacnet/objectCatalog.ts',
      },
    ],
  },
  {
    id: 'sandbox-conformance',
    title: 'sandbox — conformance checker',
    category: 'in-tree',
    summary:
      "Checks the live BACnet packet log against ASHRAE 135 spec rules. Findings cite the §-clause they came from so they're auditable.",
    relevance:
      "The 'how do we know our sim is correct' surface. Every claim has a citation that links back here (via the Library).",
    tags: ['conformance', 'spec', 'in-tree', 'validation'],
    sources: [
      {
        label: 'conformance.ts',
        path: 'packages/core/src/bacnet/conformance.ts',
      },
      {
        label: 'Conformance panel (Svelte)',
        path: 'packages/ui/src/lib/bacnet/BacnetConformancePanel.svelte',
      },
    ],
    citations: [
      'ASHRAE 135 §16.10.1',
      'ASHRAE 135 §16.10.2',
      'ASHRAE 135 §15.5.1',
      'ASHRAE 135 §13.10',
      'ASHRAE 135 §12.11.40',
      'ASHRAE 135 §20.1.2.4',
    ],
  },
  {
    id: 'sandbox-references-doc',
    title: 'sandbox — references.md',
    category: 'in-tree',
    summary:
      "Top-level docs file listing every external reference the sandbox draws on. The 'paper trail' for federal/audit conversations.",
    relevance:
      'When a federal evaluator asks "where did you get this?", the answer is in this file.',
    tags: ['docs', 'references', 'audit', 'in-tree'],
    sources: [
      {
        label: 'docs/references.md',
        path: 'docs/references.md',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// Search + filter helpers
// ─────────────────────────────────────────────────────────────────────

/** Substring + tag search across the library. Case-insensitive.
 *  Returns entries scored by where the match landed (title hits beat
 *  body hits beat tag hits). Empty query returns all entries. */
export function searchLibrary(query: string, category?: LibraryCategory): readonly LibraryEntry[] {
  const q = query.trim().toLowerCase();
  let entries = LIBRARY as readonly LibraryEntry[];
  if (category) entries = entries.filter((e) => e.category === category);
  if (!q) return entries;
  const scored: Array<{ entry: LibraryEntry; score: number }> = [];
  for (const e of entries) {
    let score = 0;
    if (e.title.toLowerCase().includes(q)) score += 10;
    if (e.summary.toLowerCase().includes(q)) score += 5;
    if (e.relevance.toLowerCase().includes(q)) score += 3;
    if (e.tags.some((t) => t.includes(q))) score += 4;
    if (e.id.toLowerCase().includes(q)) score += 6;
    if (e.citations?.some((c) => c.toLowerCase().includes(q))) score += 7;
    if (score > 0) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

/** Look up by id — used by deep-link from conformance findings. */
export function findEntry(id: string): LibraryEntry | undefined {
  return LIBRARY.find((e) => e.id === id);
}

/** Find any entries whose citations include the given spec section.
 *  e.g., findByCitation("ASHRAE 135 §16.10.2") returns the entries
 *  that cover that clause. */
export function findByCitation(citation: string): readonly LibraryEntry[] {
  const c = citation.trim();
  return LIBRARY.filter((e) => e.citations?.some((x) => x === c));
}

/** Distinct list of categories that appear in the library, in the
 *  order they should be rendered as filter chips. */
export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  'standard',
  'reference-impl',
  'vendor',
  'training',
  'tool',
  'registry',
  'in-tree',
];

export const CATEGORY_LABEL: Record<LibraryCategory, string> = {
  standard: 'Standards',
  'reference-impl': 'Reference impls',
  vendor: 'Vendor docs',
  training: 'Training',
  tool: 'Tools',
  registry: 'Registries',
  'in-tree': 'In sandbox',
};
