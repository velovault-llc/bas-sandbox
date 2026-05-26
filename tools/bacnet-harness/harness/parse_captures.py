#!/usr/bin/env python3
"""
parse_captures.py — Turn a BACnet capture into structured Transaction records.

This is the core of Stage 1. It shells out to tshark (Wireshark's mature BACnet
dissector) to decode the application layer, then pairs confirmed requests with
their responses by (invoke_id, requester, responder). Unconfirmed services
(Who-Is, I-Am, COV notifications, etc.) are emitted as standalone events.

The structured output is the reusable asset (see CLAUDE.md "strategic prize"):
a labeled library of how real devices actually behave.

Usage:
    python -m harness.parse_captures corpus/atomic-read-file.cap
    python -m harness.parse_captures corpus/atomic-read-file.cap --json baselines/atomic-read-file.json
    python -m harness.parse_captures corpus/*.cap --json-dir baselines/

Requires: tshark on PATH (apt install tshark / brew install wireshark).
"""
import argparse
import glob
import json
import os
import subprocess
import sys
from collections import defaultdict

# BACnet APDU type codes (bacapp.type)
APDU_TYPE = {
    "0": "confirmed-request",
    "1": "unconfirmed-request",
    "2": "simple-ack",
    "3": "complex-ack",
    "4": "segment-ack",
    "5": "error",
    "6": "reject",
    "7": "abort",
}

# Fields we pull from each frame. tshark emits one tab-separated row per frame.
FIELDS = [
    "frame.number",
    "frame.time_relative",
    "ip.src",
    "ip.dst",
    "bacapp.type",            # APDU type code (see APDU_TYPE)
    "bacapp.invoke_id",       # pairs request<->response
    "bacapp.confirmed_service",
    "bacapp.unconfirmed_service",
    "bacapp.error_class",
    "bacapp.error_code",
    "bacapp.reject_reason",
    "bacapp.abort_reason",
    "bacnet.snet",            # network-layer source network (routed traffic)
    "bacnet.dnet",            # network-layer destination network
]


def _tshark_bin():
    """Locate tshark — PATH first, then standard Wireshark install locations
    on Windows / macOS. Cached at module level after first lookup."""
    global _TSHARK_CACHED
    try:
        return _TSHARK_CACHED
    except NameError:
        pass
    import shutil
    found = shutil.which("tshark")
    if not found:
        for candidate in (
            r"C:\Program Files\Wireshark\tshark.exe",
            r"C:\Program Files (x86)\Wireshark\tshark.exe",
            "/Applications/Wireshark.app/Contents/MacOS/tshark",
        ):
            if os.path.exists(candidate):
                found = candidate
                break
    if not found:
        sys.exit("ERROR: tshark not found. Install Wireshark and ensure tshark "
                 "is on PATH (or at a standard install location).")
    globals()["_TSHARK_CACHED"] = found
    return found


def run_tshark(path):
    """Decode one capture into a list of per-frame dicts."""
    cmd = [_tshark_bin(), "-r", path, "-Y", "bacnet || bacapp || bvlc", "-T", "fields"]
    for f in FIELDS:
        cmd += ["-e", f]
    cmd += ["-E", "separator=\t", "-E", "occurrence=f"]
    env = dict(os.environ, WIRESHARK_RUN_FROM_BUILD_DIRECTORY="")
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    except FileNotFoundError:
        sys.exit("ERROR: tshark not found on PATH. Install Wireshark/tshark.")
    except subprocess.CalledProcessError as e:
        sys.exit(f"tshark failed on {path}: {e.stderr}")

    frames = []
    for line in out.splitlines():
        parts = line.split("\t")
        # pad to field count so missing trailing fields don't misalign
        parts += [""] * (len(FIELDS) - len(parts))
        rec = dict(zip([f.split(".")[-1] if f != "frame.number" else "frame"
                        for f in FIELDS], parts))
        # normalize a couple of names
        rec["frame"] = parts[0]
        rec["time"] = parts[1]
        rec["ip_src"] = parts[2]
        rec["ip_dst"] = parts[3]
        rec["apdu_type"] = APDU_TYPE.get(parts[4], parts[4] or "n/a")
        rec["invoke_id"] = parts[5]
        rec["confirmed_service"] = parts[6]
        rec["unconfirmed_service"] = parts[7]
        rec["error_class"] = parts[8]
        rec["error_code"] = parts[9]
        rec["reject_reason"] = parts[10]
        rec["abort_reason"] = parts[11]
        frames.append(rec)
    return frames


def get_hex_payloads(path):
    """Map frame.number -> raw BACnet/IP UDP payload hex (for byte-level diffing)."""
    cmd = [_tshark_bin(), "-r", path, "-Y", "bvlc", "-T", "fields",
           "-e", "frame.number", "-e", "data.data", "-e", "udp.payload"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    m = {}
    for line in out.splitlines():
        cols = line.split("\t")
        if not cols or not cols[0]:
            continue
        fn = cols[0]
        payload = ""
        if len(cols) > 2 and cols[2]:
            payload = cols[2].replace(":", "")
        elif len(cols) > 1 and cols[1]:
            payload = cols[1].replace(":", "")
        m[fn] = payload
    return m


def pair_transactions(frames, hexmap):
    """
    Pair confirmed requests with their responses.
    Key: (invoke_id, sorted peer pair). Retransmissions are preserved as a list.
    Unconfirmed services become standalone events.
    """
    transactions = []
    standalone = []
    # bucket confirmed-request frames and their matching responses
    pending = defaultdict(list)  # key -> list of request frames (handles retransmits)

    for fr in frames:
        t = fr["apdu_type"]
        iid = fr["invoke_id"]
        if t == "unconfirmed-request":
            standalone.append({
                "kind": "unconfirmed",
                "frame": fr["frame"],
                "time": fr["time"],
                "src": fr["ip_src"],
                "dst": fr["ip_dst"],
                "service": fr["unconfirmed_service"],
                "hex": hexmap.get(fr["frame"], ""),
            })
            continue

        if t == "confirmed-request":
            key = (iid, fr["ip_src"], fr["ip_dst"])
            pending[key].append(fr)
            continue

        if t in ("simple-ack", "complex-ack", "error", "reject", "abort", "segment-ack"):
            # response travels the opposite direction
            key = (iid, fr["ip_dst"], fr["ip_src"])
            reqs = pending.get(key)
            if reqs:
                req = reqs.pop(0)  # FIFO; leftover reqs surface as retransmits/unanswered
                transactions.append(_make_txn(req, fr, hexmap))
            else:
                # response with no matched request (capture started mid-stream, etc.)
                transactions.append(_make_txn(None, fr, hexmap))

    # any requests still pending got no response (or were retransmits w/o their own ack)
    for key, reqs in pending.items():
        for req in reqs:
            transactions.append(_make_txn(req, None, hexmap))

    return transactions, standalone


def _make_txn(req, resp, hexmap):
    txn = {"kind": "confirmed"}
    if req:
        txn["request"] = {
            "frame": req["frame"], "time": req["time"],
            "src": req["ip_src"], "dst": req["ip_dst"],
            "invoke_id": req["invoke_id"],
            "service": req["confirmed_service"],
            "hex": hexmap.get(req["frame"], ""),
        }
    if resp:
        txn["response"] = {
            "frame": resp["frame"], "time": resp["time"],
            "src": resp["ip_src"], "dst": resp["ip_dst"],
            "invoke_id": resp["invoke_id"],
            "apdu_type": resp["apdu_type"],
            "error_class": resp["error_class"] or None,
            "error_code": resp["error_code"] or None,
            "reject_reason": resp["reject_reason"] or None,
            "abort_reason": resp["abort_reason"] or None,
            "hex": hexmap.get(resp["frame"], ""),
        }
    txn["status"] = (
        "complete" if req and resp else
        "unanswered-request" if req else
        "orphan-response"
    )
    return txn


def parse_file(path):
    frames = run_tshark(path)
    hexmap = get_hex_payloads(path)
    txns, standalone = pair_transactions(frames, hexmap)
    # Drop transactions where we can't recover the BACnet/IP UDP payload —
    # captures mixing BACnet/IP with BACnet-over-Ethernet/LLC (e.g.
    # atomic-write-file-seg.cap) leave the LLC frames with empty udp.payload,
    # so they show up as transactions with empty `hex` and can't be diffed.
    # The diff harness needs raw bytes; without them, there's nothing to
    # compare. Logged in the meta for visibility.
    pre = len(txns)
    txns = [t for t in txns
            if (t.get("request", {}).get("hex") or "") != ""
            or (t.get("response", {}).get("hex") or "") != ""]
    dropped_no_hex = pre - len(txns)
    standalone = [e for e in standalone if (e.get("hex") or "") != ""]
    out_meta = {"dropped_transactions_no_hex": dropped_no_hex} if dropped_no_hex else {}
    return {
        "capture": os.path.basename(path),
        "frame_count": len(frames),
        **out_meta,
        "transactions": txns,
        "unconfirmed_events": standalone,
    }


def print_summary(result):
    print(f"\n=== {result['capture']} ===")
    print(f"  decoded frames: {result['frame_count']}")
    txns = result["transactions"]
    complete = [t for t in txns if t["status"] == "complete"]
    unans = [t for t in txns if t["status"] == "unanswered-request"]
    orphan = [t for t in txns if t["status"] == "orphan-response"]
    print(f"  transactions: {len(txns)} "
          f"({len(complete)} complete, {len(unans)} unanswered, {len(orphan)} orphan)")
    print(f"  unconfirmed events: {len(result['unconfirmed_events'])}")
    for t in complete[:5]:
        req, resp = t.get("request", {}), t.get("response", {})
        print(f"    iid={req.get('invoke_id'):>3}  svc={req.get('service'):>3}  "
              f"{req.get('src')} -> {resp.get('apdu_type')}")
    # surface likely-interesting anomalies
    retransmit_hint = len(unans) > 0
    if retransmit_hint:
        print(f"  NOTE: {len(unans)} unanswered/retransmit request(s) — "
              f"possible real-world error sequence worth simulating.")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("captures", nargs="+", help="capture file(s) or glob(s)")
    ap.add_argument("--json", help="write single result to this JSON path")
    ap.add_argument("--json-dir", help="write one JSON per capture into this dir")
    args = ap.parse_args()

    paths = []
    for c in args.captures:
        paths += glob.glob(c) if any(ch in c for ch in "*?[") else [c]

    for path in paths:
        if not os.path.exists(path):
            print(f"skip (not found): {path}", file=sys.stderr)
            continue
        result = parse_file(path)
        print_summary(result)
        if args.json and len(paths) == 1:
            with open(args.json, "w") as f:
                json.dump(result, f, indent=2)
            print(f"  wrote {args.json}")
        if args.json_dir:
            os.makedirs(args.json_dir, exist_ok=True)
            out = os.path.join(args.json_dir,
                               os.path.splitext(result["capture"])[0] + ".json")
            with open(out, "w") as f:
                json.dump(result, f, indent=2)
            print(f"  wrote {out}")


if __name__ == "__main__":
    main()
