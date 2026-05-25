#!/usr/bin/env python3
"""
enrich_baselines.py — Stage 1.5. Decode each transaction with bacpypes3 and
add structured fields next to the raw hex.

The plain baselines produced by parse_captures.py carry the BACnet/IP payload
as hex strings — fine for byte-exact replay but opaque to any downstream tool
that wants to ask "which property of which object was this asking for?"
This step uses bacpypes3 (already a harness dependency) to fully decode every
request/response APDU and emits enriched baselines with a `decoded` field
per request and response.

The enriched baselines are the corpus-as-asset the harness's CLAUDE.md
describes — a labeled library of how real devices actually behave that
downstream consumers (the simulator, the UI, future LLM coaches) can use
without re-implementing a BACnet decoder.

Malformed packets (which the bacapp-malform corpus deliberately contains)
are tagged `{"decode_error": "..."}` rather than aborting the whole file —
those failures ARE the test data for fault-handling sequences.

Usage:
    python -m harness.enrich_baselines baselines/atomic-read-file.json
    python -m harness.enrich_baselines baselines/*.json --in-place
    python -m harness.enrich_baselines baselines/*.json --suffix .enriched
"""
import argparse
import glob
import json
import os
import sys
from typing import Any

from bacpypes3.ipv4.bvll import LPDU
from bacpypes3.pdu import PDU
from bacpypes3.npdu import NPDU
from bacpypes3.apdu import APDU, APCISequence, ConfirmedRequestPDU, ComplexAckPDU, ErrorPDU


def _bacnet_repr(v: Any) -> Any:
    """Convert a bacpypes3 field value to plain JSON. The library returns
    typed wrappers (ObjectIdentifier, PropertyIdentifier, Enumerated, etc.)
    — we render each as `str(v)` to match what `tshark -T fields` would
    emit, keeping the enriched baseline UI-friendly without committing to
    a specific bacpypes-version field schema."""
    if v is None:
        return None
    # Primitive types pass through.
    if isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, bytes):
        return {"_bytes_hex": v.hex(), "_len": len(v)}
    # Sequences/lists: recurse.
    if isinstance(v, list):
        return [_bacnet_repr(x) for x in v]
    # Anything with an `_order` attribute is a bacpypes3 Sequence: walk fields.
    if hasattr(v, "_order"):
        out = {}
        for f in v._order:
            try:
                out[f] = _bacnet_repr(getattr(v, f, None))
            except Exception as e:
                out[f] = {"_error": f"{type(e).__name__}: {e}"}
        return out
    # `Any` carries the raw tag bytes for an untyped property value — surface
    # them as hex so downstream tools can decode against the right type.
    if hasattr(v, "tagList") or type(v).__name__ == "Any":
        try:
            tags = getattr(v, "tagList", None)
            if tags is not None:
                from bacpypes3.pdu import PDU as _PDU
                pdu = _PDU()
                tags.encode(pdu)
                return {"_any_tag_bytes": pdu.pduData.hex()}
        except Exception:
            pass
    # Fallback — repr it. str(Enumerated) gives the symbolic name which is
    # what we want (e.g. "object-list" rather than the numeric value).
    s = str(v)
    # Strip Python "<bacpypes3.X object at 0xabc>" reprs that leak through
    # untyped wrappers — leave a hint rather than an unstable memory address.
    if s.startswith("<bacpypes3.") and " object at 0x" in s:
        return {"_opaque": type(v).__name__}
    return s


def _decode_recovered(npdu_data: bytes, bvll_fn_hex: str, declared_len: int,
                       actual_len: int, bvll_err: str) -> dict:
    """Used when bacpypes3 rejects the BVLL framing (deliberate malformation
    in the bacapp-malform corpus). Try to decode the inner NPDU+APDU anyway
    — the inner content is often valid; only the length field is wrong."""
    out: dict = {
        "bvll_function": bvll_fn_hex,
        "bvll_malformed": True,
        "bvll_declared_len": declared_len,
        "bvll_actual_len": actual_len,
        "bvll_error": bvll_err,
    }
    try:
        npdu = NPDU.decode(PDU(npdu_data))
    except Exception as e:
        out["decode_error"] = f"NPDU (after BVLL recovery): {type(e).__name__}: {e}"
        return out
    try:
        apdu = APDU.decode(PDU(npdu.pduData))
    except Exception as e:
        out["decode_error"] = f"APDU (after BVLL recovery): {type(e).__name__}: {e}"
        return out
    out["apdu_type"] = apdu.apduType
    out["apdu_class"] = type(apdu).__name__
    if hasattr(apdu, "apduService"):
        out["service_choice"] = apdu.apduService
    if hasattr(apdu, "apduInvokeID"):
        out["invoke_id"] = apdu.apduInvokeID
    try:
        svc = APCISequence.decode(apdu)
        out["service_class"] = type(svc).__name__
        out["fields"] = {f: _bacnet_repr(getattr(svc, f, None)) for f in svc._order}
    except Exception as e:
        out["service_decode_error"] = f"{type(e).__name__}: {e}"
    return out


def _decode_apdu(hex_str: str) -> dict:
    """Decode a full BACnet/IP frame (BVLL → NPDU → APDU → service) and
    return a JSON-serializable summary. On malformed input return
    {"decode_error": "..."} so the caller can keep going."""
    try:
        data = bytes.fromhex(hex_str)
    except ValueError as e:
        return {"decode_error": f"bad hex: {e}"}
    try:
        lpdu = LPDU.decode(PDU(data))
        npdu_data = lpdu.pduData
        bvll_fn_hex = hex(lpdu.bvlciFunction)
    except Exception as e:
        # bacpypes3 enforces a strict bvlciLength==len(pduData)+4 check.
        # The bacapp-malform corpus contains packets that deliberately
        # break this — recover the BVLL fields manually so we can still
        # examine the inner NPDU/APDU (which IS the point of the malform
        # corpus — the failure mode itself is the test data).
        if len(data) >= 4 and data[0] == 0x81:
            bvll_fn_hex = hex(data[1])
            declared_len = int.from_bytes(data[2:4], "big")
            npdu_data = data[4:]
            return _decode_recovered(npdu_data, bvll_fn_hex, declared_len, len(data),
                                     bvll_err=str(e))
        return {"decode_error": f"BVLL: {type(e).__name__}: {e}"}
    try:
        npdu = NPDU.decode(PDU(npdu_data))
    except Exception as e:
        return {"decode_error": f"NPDU: {type(e).__name__}: {e}",
                "bvll_function": bvll_fn_hex}
    try:
        apdu = APDU.decode(PDU(npdu.pduData))
    except Exception as e:
        return {"decode_error": f"APDU: {type(e).__name__}: {e}",
                "bvll_function": bvll_fn_hex}

    out: dict = {
        "bvll_function": hex(lpdu.bvlciFunction),
        "apdu_type": apdu.apduType,
        "apdu_class": type(apdu).__name__,
    }
    if hasattr(apdu, "apduService"):
        out["service_choice"] = apdu.apduService
    if hasattr(apdu, "apduInvokeID"):
        out["invoke_id"] = apdu.apduInvokeID

    # Try to decode service-specific structure. For ErrorPDU + many edge
    # cases this fails — preserve the error and the partial info we have.
    try:
        svc = APCISequence.decode(apdu)
        out["service_class"] = type(svc).__name__
        fields = {}
        for f in svc._order:
            try:
                fields[f] = _bacnet_repr(getattr(svc, f, None))
            except Exception as e:
                fields[f] = {"_error": f"{type(e).__name__}: {e}"}
        out["fields"] = fields
    except Exception as e:
        out["service_decode_error"] = f"{type(e).__name__}: {e}"

    return out


def enrich(baseline_path: str) -> dict:
    """Load a baseline, decode every transaction's request + response, and
    return the enriched dict ready to JSON-dump."""
    d = json.load(open(baseline_path))
    enriched_tx = []
    decode_stats = {"req_ok": 0, "req_fail": 0, "resp_ok": 0, "resp_fail": 0}
    for t in d.get("transactions", []):
        tx = dict(t)
        if "request" in tx and tx["request"].get("hex"):
            tx["request"] = dict(tx["request"])
            dec = _decode_apdu(tx["request"]["hex"])
            tx["request"]["decoded"] = dec
            if "decode_error" in dec:
                decode_stats["req_fail"] += 1
            else:
                decode_stats["req_ok"] += 1
        if "response" in tx and tx["response"].get("hex"):
            tx["response"] = dict(tx["response"])
            dec = _decode_apdu(tx["response"]["hex"])
            tx["response"]["decoded"] = dec
            if "decode_error" in dec:
                decode_stats["resp_fail"] += 1
            else:
                decode_stats["resp_ok"] += 1
        enriched_tx.append(tx)
    enriched_unconf = []
    for ev in d.get("unconfirmed_events", []):
        ev2 = dict(ev)
        if ev.get("hex"):
            ev2["decoded"] = _decode_apdu(ev["hex"])
        enriched_unconf.append(ev2)
    out = dict(d)
    out["transactions"] = enriched_tx
    out["unconfirmed_events"] = enriched_unconf
    out["decode_stats"] = decode_stats
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("baselines", nargs="+", help="baseline JSON file(s) or glob(s)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--in-place", action="store_true",
                   help="overwrite the input file with enriched output")
    g.add_argument("--suffix", default=".enriched",
                   help='write to <name><suffix>.json (default ".enriched")')
    ap.add_argument("--summary-only", action="store_true",
                    help="don't write files; just print decode stats")
    args = ap.parse_args()

    paths = []
    for b in args.baselines:
        paths += sorted(glob.glob(b)) if any(ch in b for ch in "*?[") else [b]
    if not paths:
        sys.exit("no baselines matched")
    # Skip files we already enriched — keeps `python -m harness.enrich_baselines
    # baselines/*.json` idempotent.
    paths = [p for p in paths if args.suffix not in os.path.basename(p)
             or args.in_place or args.summary_only]

    grand = {"req_ok": 0, "req_fail": 0, "resp_ok": 0, "resp_fail": 0}
    for p in paths:
        enriched = enrich(p)
        st = enriched["decode_stats"]
        for k in grand:
            grand[k] += st[k]
        capture = enriched.get("capture", os.path.basename(p))
        print(f"[{capture}] req {st['req_ok']}+{st['req_fail']}fail / "
              f"resp {st['resp_ok']}+{st['resp_fail']}fail")
        if args.summary_only:
            continue
        if args.in_place:
            outp = p
        else:
            base, ext = os.path.splitext(p)
            outp = base + args.suffix + ext
        json.dump(enriched, open(outp, "w"), indent=2, default=str)
        print(f"  -> {outp}")
    print(f"\nTOTAL: req {grand['req_ok']}+{grand['req_fail']}fail / "
          f"resp {grand['resp_ok']}+{grand['resp_fail']}fail")


if __name__ == "__main__":
    main()
