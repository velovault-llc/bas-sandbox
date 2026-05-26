// Per-service real-corpus exemplars — the literal bytes a real BACnet
// device sent on the wire for each service type, pulled from Steve
// Karg's public capture corpus. Used by the packet inspector to
// surface "this is what a real Tridium/Reliable/Alerton device emits
// for this service" alongside the sandbox's synthesized summary.
//
// This is the closest thing we ship today to per-packet provenance.
// Eventually `emit.ts` will produce real wire bytes and the inspector
// will diff the sandbox's emission against THIS reference. For now,
// the exemplar is the reference.
//
// To extend: add a new entry mapping a UI service name to one record.
// The source captures all sit under tools/bacnet-harness/corpus and
// are validated 100% byte-exact-roundtrip by RawPassthroughAdapter
// — see CORPUS_VALIDATION_SUMMARY.

export interface CorpusExemplar {
  /** Source .cap filename in the kargs.net corpus. */
  readonly capture: string;
  /** Frame number in the source capture. */
  readonly frame: number;
  /** Raw BACnet/IP UDP payload as lowercase hex. */
  readonly hex: string;
  /** Length in bytes (hex.length / 2). */
  readonly byteLength: number;
  /** One-line context about what this real device was doing. */
  readonly context: string;
}

/** Slim per-service exemplar map. Keys match the UI's BacnetService
 *  string. When a sandbox-emitted packet has a service in this map,
 *  the inspector renders the real-device bytes from this corpus
 *  reference. When it doesn't, the inspector says so honestly.
 *
 *  We don't have exemplars for everything yet — services not in the
 *  shipped captures (Who-Is, I-Am, SubscribeCOV, COV-Notification,
 *  WriteProperty, Token-Pass, Poll-For-Master) get a "no corpus
 *  exemplar yet" placeholder. The bacpypes3 reference-device
 *  milestone is what closes those gaps. */
export const CORPUS_EXEMPLARS: Readonly<Record<string, CorpusExemplar>> = {
  'AtomicReadFile': {
    capture: 'atomic-read-file.cap',
    frame: 1,
    hex: '810a0016010402034206c4028000000e31002201b80f',
    byteLength: 22,
    context: 'Supervisor reading 440 bytes from file:0 starting at offset 0',
  },
  'AtomicReadFile-ACK': {
    capture: 'atomic-read-file.cap',
    frame: 2,
    hex: '810a00300100304206110e3100652054686973206973206120746573742066696c6520666f72204241436e65742e0a0f',
    byteLength: 48,
    context: 'Device returning 32-byte test file contents with end-of-file flag',
  },
  'AtomicWriteFile': {
    capture: 'atomic_write_file_bad_ack.cap',
    frame: 3,
    hex: '810a01d7010400030107c4028000000e310065fe01c02369666e64656620434f4e4649475f480a23646566696e6520434f4e4649475f480a0a2f2a206465636c61726520612073696e676c6520706879736963616c206c61796572202a2f0a2f2a23696e636c75646520226269702e6822202a2f0a2f2a23696e636c75646520226574686572 6e65742e6822202a2f0a2f2a23696e636c75646520226172636e65742e6822202a2f0a2f2a23696e636c756465202263d736d7470202a2f0a0a2f2a204d6178206e756d626572206f6620627974657320696e20616e20415044552e202a2f0a2f2a205479706963616c2073697a6573206172652035302c203132382c203230362c203438302c20313032342c20616e642031343736206f6374657473202a2f0a2f2a2054686973206973207573656420696e20636f6e737472756374696e67206d6573736167657320616e6420746f2074656c6c206f7468657273206f7572206c696d697473202a2f0a2f2a20353020697320746865206d696e696d756d3b2061646a75737420746f20796f7572206d656d6f727920616e6420706879736963616c206c6179657220636f6e73747261696e7473202a2f0a2f2a204c6f6e3d3230362c204d532f54503d3438302c0f'.replace(/\s/g, ''),
    byteLength: 471,
    context: 'Pushing a 423-byte chunk of a CONFIG_H header into file:0 at offset 0',
  },
  'AtomicWriteFile-ACK': {
    capture: 'atomic_write_file_bad_ack.cap',
    frame: 4,
    hex: '810a000b01003001070900',
    byteLength: 11,
    context: 'Device acknowledging the write at fileStartPosition 0',
  },
  'ReinitializeDevice': {
    capture: 'atomic-write-file.cap',
    frame: 3117,
    hex: '810a001b010c000301850203151409001d0900626f6f746469736b',
    byteLength: 27,
    context: 'Coldstart with password "bootdisk" — routed through DNET 3, MAC 0x85',
  },
  'SimpleAck': {
    capture: 'atomic-write-file.cap',
    frame: 3118,
    hex: '810a000e012000030185ff201514',
    byteLength: 14,
    context: 'SimpleAck for invokeID 21 — the response to the Reinitialize above',
  },
  'ReadProperty': {
    capture: 'BACnetARRAY-elements.cap',
    frame: 9,
    hex: '810a001101040003010c0c02003039194c',
    byteLength: 17,
    context: 'Reading object-list of device:12345 (a BACnetARRAY OF ObjectIdentifier)',
  },
  'ReadProperty-ACK': {
    capture: 'BACnetARRAY-elements.cap',
    frame: 10,
    hex: '810a00fd010030010c0c02003039194c3ec402003039c400000000c400000001c400000002c400000003c400000004c400000005c400000006c400400000c400400001c400400002c400400003c400800000c400800001c400800002c400800003c400c00000c400c00001c400c00002c400c00003c400c00004c401000000c401000001c401000002c401000003c401000004c401000005c401400000c401400001c405400000c405400001c405400002c405400003c405400004c405400005c405400006c407000000c407000001c407000002c407000003c403800000c403800001c403800002c403800003c402800000c402800001c4028000023f',
    byteLength: 253,
    context: 'Device returning its full 47-entry object-list inline (BACnetARRAY)',
  },
  'Error': {
    capture: 'BACnetARRAY-elements.cap',
    frame: 40,
    hex: '810a000d010050010c9102912a',
    byteLength: 13,
    context: 'Property error: error-class 2 (property), error-code 42 (invalid-array-index)',
  },
  'Reject': {
    capture: 'alerton-plugfest-2.cap',
    frame: 83,
    hex: '810a000d01084719017f60c400',
    byteLength: 13,
    context: 'Reject for an APDU the device could not parse',
  },
  'ReadPropertyMultiple': {
    capture: 'alerton-plugfest-2.cap',
    frame: 84,
    hex: '810a011c01040203c50e0c000008991e094d1f0c000008fd1e094d09551f0c000008991e09551f0c000008a91e094d1f0c0000090d1e094d09551f0c000008a91e09551f0c000008aa1e09551f0c000008ab1e09551f0c000008ac1e09551f0c000008ad1e09551f0c000008ae1e09551f0c000008af1e09551f0c000008b01e09551f0c000008b11e09551f0c000008b21e09551f0c000008b31e09551f0c000008b41e09551f0c000008aa1e094d1f0c000008ab1e094d1f0c000008ac1e094d1f0c000008ad1e094d1f0c000008ae1e094d1f0c000008af1e094d1f0c000008b01e094d1f0c000008b11e094d1f0c000008b21e094d1f0c000008b31e094d1f0c000008b41e094d1f0c0000090e1e09551f0c0000090f1e09551f',
    byteLength: 284,
    context: 'JACE reading object-list+present-value across 22 analog-inputs on one round-trip',
  },
  'ReadPropertyMultiple-ACK': {
    capture: 'alerton-plugfest-2.cap',
    frame: 85,
    hex: '810a01e601003cc500100e0c000008991e294d4e750c00414e414c4f4720323230314f1f0c000008fd1e294d4e750c00414e414c4f4720323330314f29554e4442c800004f1f0c000008991e29554e4442c800004f1f0c000008a91e294d4e750c00414e414c4f4720323231374f1f0c0000090d1e294d4e750c00414e414c4f4720323331374f29554e4442c800004f1f0c000008a91e29554e4442c800004f1f0c000008aa1e29554e44000000004f1f0c000008ab1e29554e44000000004f1f0c000008ac1e29554e44000000004f1f0c000008ad1e29554e44000000004f1f0c000008ae1e29554e44000000004f1f0c000008af1e29554e44000000004f1f0c000008b01e29554e44000000004f1f0c000008b11e29554e44000000004f1f0c000008b21e29554e44000000004f1f0c000008b31e29554e44000000004f1f0c000008b41e29554e44000000004f1f0c000008aa1e294d4e750c00414e414c4f4720323231384f1f0c000008ab1e294d4e750c00414e414c4f4720323231394f1f0c000008ac1e294d4e750c00414e414c4f4720323232304f1f0c000008ad1e294d4e750c00414e414c4f4720323232314f1f0c000008ae1e294d4e750c00414e414c4f4720323232324f1f0c000008af1e294d4e750c00414e414c4f4720323232334f',
    byteLength: 486,
    context: 'Segmented response with object names ("ANALOG 2201", "ANALOG 2301") and reliability flags',
  },
  'SegmentAck': {
    capture: 'alerton-plugfest-2.cap',
    frame: 86,
    hex: '810a000a010040c50001',
    byteLength: 10,
    context: 'Flow-control ack for segment 0 of an RPM-ACK exchange',
  },
  'Abort': {
    capture: 'alerton-plugfest-2.cap',
    frame: 1196,
    hex: '810a00090100715b04',
    byteLength: 9,
    context: 'Device aborted an RPM mid-flight — reason 4 (segmentation-not-supported)',
  },
};

/** Look up a corpus exemplar for a UI BacnetService name. Returns
 *  undefined when we don't have one (yet). */
export function findCorpusExemplar(uiService: string): CorpusExemplar | undefined {
  return CORPUS_EXEMPLARS[uiService];
}

/** Token for a single byte in a side-by-side diff render. The packet
 *  inspector consumes this to color-code each byte: green for bytes
 *  where ours matches the corpus reference, red where they diverge,
 *  grey for bytes only present on one side. */
export type DiffByteKind = 'match' | 'diff' | 'only-ours' | 'only-theirs';

export interface DiffByte {
  readonly offset: number;
  readonly kind: DiffByteKind;
  /** Lowercase hex pair when present on the corresponding side. */
  readonly ours?: string;
  readonly theirs?: string;
}

/** Align two hex byte streams left-aligned. Each position emits a
 *  DiffByte tagged by what's at that offset on both sides. Length
 *  difference is tagged 'only-ours' or 'only-theirs' depending on
 *  which side runs longer.
 *
 *  Returns a position-by-position diff PLUS an aggregate "match
 *  ratio" — how much of the shorter stream agrees byte-exact. A
 *  match ratio of 1.0 means everything that overlaps matches. */
export function diffBytes(
  ours: string,
  theirs: string,
): { tokens: DiffByte[]; matchRatio: number; sameLength: boolean } {
  const a = ours.match(/.{2}/g) ?? [];
  const b = theirs.match(/.{2}/g) ?? [];
  const tokens: DiffByte[] = [];
  let matches = 0;
  const overlap = Math.min(a.length, b.length);
  const total = Math.max(a.length, b.length);
  for (let i = 0; i < total; i++) {
    if (i < a.length && i < b.length) {
      const eq = a[i].toLowerCase() === b[i].toLowerCase();
      if (eq) matches++;
      tokens.push({
        offset: i,
        kind: eq ? 'match' : 'diff',
        ours: a[i],
        theirs: b[i],
      });
    } else if (i < a.length) {
      tokens.push({ offset: i, kind: 'only-ours', ours: a[i] });
    } else {
      tokens.push({ offset: i, kind: 'only-theirs', theirs: b[i] });
    }
  }
  return {
    tokens,
    matchRatio: overlap > 0 ? matches / overlap : 0,
    sameLength: a.length === b.length,
  };
}

/** Render a hex string as a Wireshark-style aligned hexdump:
 *   "0000  81 0a 00 16  01 04 02 03  42 06 c4 02   ........B..."
 *  16 bytes per row. Used by the packet inspector. */
export function hexDump(hex: string): string {
  const bytes = hex.match(/.{2}/g) ?? [];
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.slice(off, off + 16);
    const hexCols = [
      row.slice(0, 4).join(' '),
      row.slice(4, 8).join(' '),
      row.slice(8, 12).join(' '),
      row.slice(12, 16).join(' '),
    ]
      .filter((s) => s.length > 0)
      .join('  ');
    const ascii = row
      .map((b) => {
        const code = parseInt(b, 16);
        return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '.';
      })
      .join('');
    lines.push(`${off.toString(16).padStart(4, '0')}  ${hexCols.padEnd(54, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
}
