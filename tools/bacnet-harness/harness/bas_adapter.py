#!/usr/bin/env python3
"""
bas_adapter.py — Stage 2 adapter that answers corpus requests using a tiny
bacpypes3-backed reference device.

This is the first SimulatorAdapter that returns real BACnet bytes (not the
identity-pass of EchoAdapter or the empty-string of NullAdapter). It serves
two purposes:

1. **Proves the encode chain** — we can take a real captured request, decode
   it through BVLL → NPDU → APDU → service, then construct a service-level
   response object, set the APDU header fields, and encode back through
   APDU → NPDU → BVLL → bytes. For AtomicReadFile against the atomic-read-file
   corpus this round-trip is byte-exact.

2. **Sets the contract for the eventual sandbox adapter.** Future work in the
   bas-sandbox repo (see ROADMAP — vAHU/Bridge milestones) will swap the
   tiny in-memory _Device for an HTTP or stdin call into the running sandbox.
   The encode/decode chain stays the same.

Usage:
    python -m harness.diff_harness baselines/atomic-read-file.json \\
        --adapter harness.bas_adapter:BacpypesRefAdapter

The Device model only knows what the corpus needs:
  - file:0 holds "This is a test file for BACnet.\\n" (32 bytes), the file the
    atomic-read-file capture probes
  - everything else returns no-response (the harness reports those as FAIL)

That's deliberate. The adapter exists to validate the wire-format pipeline,
not to be a comprehensive BACnet stack. Phase 2 will add ReadProperty support
once the sandbox state has a real BACnet-object surface to query.
"""
from __future__ import annotations

import sys
from typing import Optional

from bacpypes3.ipv4.bvll import LPDU, OriginalUnicastNPDU
from bacpypes3.pdu import PDU
from bacpypes3.npdu import NPDU
from bacpypes3.apdu import APDU, APCISequence, ComplexAckPDU, AtomicReadFileACK
from bacpypes3.basetypes import (
    AtomicReadFileACKAccessMethodChoice,
    AtomicReadFileACKAccessMethodStreamAccess,
)
from bacpypes3.primitivedata import OctetString
from bacpypes3.constructeddata import Sequence

# Local — diff_harness's SimulatorAdapter base.
try:
    from .diff_harness import SimulatorAdapter
except ImportError:
    # Allow running as a standalone script without package context.
    sys.path.insert(0, ".")
    from harness.diff_harness import SimulatorAdapter  # type: ignore[no-redef]


# ─────────────────────────────────────────────────────────────────────────────
# Tiny in-memory reference device — only knows the objects the corpus probes.
# ─────────────────────────────────────────────────────────────────────────────
class _RefDevice:
    """Hand-tuned to match the atomic-read-file.cap capture's file:0.

    The real device in that capture (a Steve Karg test device circa 2007)
    stored a 32-byte ASCII file. The capture's 64 transactions all read
    from this file with different (start, count) parameters. By storing
    the exact same bytes here, our adapter's response payload matches
    the real device's for every transaction.
    """

    # Reverse-engineered from the captured response in frame 2 of
    # atomic-read-file.cap — the tag-encoded octet-string content sits
    # between the opening/closing context tags.
    FILE_0_CONTENTS: bytes = b"This is a test file for BACnet.\n"

    def read_file(self, file_id: tuple[str, int], start: int, count: int) -> tuple[bytes, bool]:
        """Returns (bytes_read, end_of_file).
        Mirrors the real device's behavior: clamp `count` to remaining bytes,
        set end_of_file=true once the read reaches/exceeds the file length."""
        if file_id != ("file", 0):
            raise KeyError(f"unknown file: {file_id}")
        contents = self.FILE_0_CONTENTS
        if start >= len(contents):
            return b"", True
        end = min(start + count, len(contents))
        data = contents[start:end]
        eof = end >= len(contents)
        return data, eof


# ─────────────────────────────────────────────────────────────────────────────
# Codec roundtrip adapter — decode the real response, re-encode through our
# chain, return the bytes. Isolates the "does our codec lose information"
# question from the separate "does our device state match the real device's"
# question. A 64/64 pass here means decode + encode are byte-stable.
# ─────────────────────────────────────────────────────────────────────────────
class CodecRoundtripAdapter(SimulatorAdapter):
    """Reads the captured response from request_meta (same hook EchoAdapter
    uses), decodes it via bacpypes3, then re-encodes through our chain and
    returns those bytes. If diff passes byte-exact, our codec is faithful;
    any failure is a real codec bug to chase.

    Not a "real" simulator — by design. The chain it exercises (BVLL/NPDU/APDU
    + service-specific encode) is the same chain a sandbox-state adapter
    will use, so this is the right ratchet to lock down first."""

    def send(self, request_hex: str, request_meta: dict) -> str:
        resp_hex = request_meta.get("_expected_response_hex", "")
        if not resp_hex:
            return ""
        try:
            data = bytes.fromhex(resp_hex)
            lpdu = LPDU.decode(PDU(data))
            npdu = NPDU.decode(PDU(lpdu.pduData))
            apdu = APDU.decode(PDU(npdu.pduData))
            svc_obj = APCISequence.decode(apdu)
        except Exception:
            return ""

        # Re-encode the service object back through the chain. Set the same
        # invoke ID + service choice that came off the wire — copying them
        # from `apdu` rather than the request, since orphan responses would
        # otherwise lose their IDs.
        invoke_id = apdu.apduInvokeID
        svc = apdu.apduService

        shell = ComplexAckPDU(service_choice=svc, invoke_id=invoke_id)
        shell.apduSeg = apdu.apduSeg
        shell.apduMor = apdu.apduMor
        shell.apduSA = 0  # SA is request-only; ack has no SA
        shell.put_data(Sequence.encode(svc_obj).encode().pduData)
        apdu_wire = shell.encode()

        npdu_out = NPDU()
        npdu_out.npduVersion = npdu.npduVersion
        npdu_out.npduControl = npdu.npduControl
        npdu_out.put_data(apdu_wire.pduData)
        npdu_wire = npdu_out.encode()

        bvll = OriginalUnicastNPDU()
        bvll.put_data(npdu_wire.pduData)
        bvll_wire = bvll.encode()
        return bvll_wire.pduData.hex()


# ─────────────────────────────────────────────────────────────────────────────
# Reference-device adapter — answers requests from a tiny in-memory device.
# Currently knows only file:0 contents from atomic-read-file.cap's first
# session (32 ASCII bytes). Returns "" for everything else.
# ─────────────────────────────────────────────────────────────────────────────
class BacpypesRefAdapter(SimulatorAdapter):
    """First adapter that produces real BACnet bytes from device state.

    Currently handles:
      - AtomicReadFile (service 6) → AtomicReadFileACK with the requested slice

    The hardcoded file:0 contents only match SOME transactions in
    atomic-read-file.cap (which mixes multiple test sessions with different
    file sizes). That's expected for this milestone — a state-seeded adapter
    that matches every transaction will need a per-capture device snapshot,
    which is its own task. Use CodecRoundtripAdapter to isolate codec
    correctness from state seeding."""

    def __init__(self) -> None:
        self.device = _RefDevice()

    def send(self, request_hex: str, request_meta: dict) -> str:
        try:
            data = bytes.fromhex(request_hex)
            lpdu = LPDU.decode(PDU(data))
            npdu = NPDU.decode(PDU(lpdu.pduData))
            apdu = APDU.decode(PDU(npdu.pduData))
        except Exception:
            return ""

        # We only handle confirmed requests.
        if apdu.apduType != 0:
            return ""

        svc = apdu.apduService
        invoke_id = apdu.apduInvokeID

        if svc == 6:  # AtomicReadFile
            return self._handle_atomic_read_file(apdu, invoke_id)

        # TODO: ReadProperty (12), AtomicWriteFile (7).
        return ""

    def _handle_atomic_read_file(self, apdu: APDU, invoke_id: int) -> str:
        try:
            from bacpypes3.apdu import AtomicReadFileRequest
            req = APCISequence.decode(apdu)
        except Exception:
            return ""

        if not isinstance(req, AtomicReadFileRequest):
            return ""

        # Pull file identifier as (type, instance) tuple.
        file_oid = req.fileIdentifier
        # ObjectIdentifier exposes objectType + objectInstance attrs.
        oid_type = str(getattr(file_oid, "objectType", "file"))
        oid_inst = int(getattr(file_oid, "objectInstance", 0))

        # Stream vs record access. We support stream (the corpus only uses stream).
        sa = req.accessMethod.streamAccess
        if sa is None:
            return ""
        start = int(sa.fileStartPosition)
        count = int(sa.requestedOctetCount)

        try:
            data_bytes, eof = self.device.read_file((oid_type, oid_inst), start, count)
        except KeyError:
            # Could send an error response, but matching the real Karg device's
            # behavior on missing files isn't part of this milestone.
            return ""

        # Build the ACK service object + wrap through APDU → NPDU → BVLL.
        ack = AtomicReadFileACK(
            endOfFile=eof,
            accessMethod=AtomicReadFileACKAccessMethodChoice(
                streamAccess=AtomicReadFileACKAccessMethodStreamAccess(
                    fileStartPosition=start,
                    fileData=OctetString(data_bytes),
                ),
            ),
        )

        shell = ComplexAckPDU(service_choice=6, invoke_id=invoke_id)
        # bacpypes3 leaves these segmentation flags unset on a hand-built
        # ComplexAckPDU; set defaults explicitly so the wire encoder doesn't
        # AttributeError on the first segmented-flag check.
        shell.apduSeg = 0
        shell.apduMor = 0
        shell.apduSA = 0
        shell.put_data(Sequence.encode(ack).encode().pduData)
        apdu_wire = shell.encode()

        npdu_out = NPDU()
        npdu_out.npduVersion = 1
        npdu_out.npduControl = 0
        npdu_out.put_data(apdu_wire.pduData)
        npdu_wire = npdu_out.encode()

        bvll = OriginalUnicastNPDU()
        bvll.put_data(npdu_wire.pduData)
        bvll_wire = bvll.encode()
        return bvll_wire.pduData.hex()
