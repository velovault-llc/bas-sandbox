#!/usr/bin/env python3
"""
diff_harness.py — Stage 2. Replay real requests at the simulator, diff responses.

For each complete transaction in a baseline JSON (produced by parse_captures.py),
this sends the *real device's request* to the simulator-under-test and compares
the simulator's response against the *real device's response* — first by decoded
fields, then (optionally) byte-for-byte on the raw APDU.

The simulator is reached through a SimulatorAdapter. You MUST implement one
against your actual simulator's interface — see the TODOs. Two stubs are provided:
  - EchoAdapter: returns the real response (sanity-checks the harness itself: all PASS)
  - NullAdapter: returns nothing (sanity-checks failure reporting: all FAIL)

Usage:
    python -m harness.diff_harness baselines/atomic-read-file.json
    python -m harness.diff_harness baselines/atomic-read-file.json --adapter echo
    python -m harness.diff_harness baselines/*.json --adapter mysim --byte-exact

Report is written to reports/<capture>.report.json and summarized to stdout.
"""
import argparse
import glob
import json
import os
import sys


# ---------------------------------------------------------------------------
# Adapter interface — the one thing you must implement for your simulator.
# ---------------------------------------------------------------------------
class SimulatorAdapter:
    """Send a BACnet request to the simulator; return its raw response payload (hex str)."""

    def setup(self, baseline_meta):
        """Optional: prime the simulator with object state implied by the capture.
        baseline_meta is the parsed baseline dict (capture name, etc.).
        TODO: if your simulator needs objects to exist before it can answer a
        ReadProperty, create them here (or load a device-config snapshot)."""
        pass

    def send(self, request_hex, request_meta):
        """Send the request (raw BACnet/IP payload hex) to the simulator and
        return the response as a hex string, or "" if no response.

        request_meta carries decoded context (service, src, dst, invoke_id).

        TODO: implement against your simulator. Options, easiest to hardest:
          (a) If the sim exposes a UDP socket speaking BACnet/IP, send the bytes
              to 127.0.0.1:47808 and read the reply. (Most realistic.)
          (b) If the sim has a Python API, call it directly and re-encode the
              response to hex.
          (c) If the sim is a separate process, drive it over its IPC/CLI.
        """
        raise NotImplementedError("Implement SimulatorAdapter.send for your simulator")

    def teardown(self):
        pass


class EchoAdapter(SimulatorAdapter):
    """Returns exactly the real response — every transaction should PASS.
    Use this to prove the harness + diff logic work before wiring a real sim."""
    def send(self, request_hex, request_meta):
        return request_meta.get("_expected_response_hex", "")


class NullAdapter(SimulatorAdapter):
    """Returns nothing — every answerable transaction should FAIL.
    Use this to prove the failure path + report formatting work."""
    def send(self, request_hex, request_meta):
        return ""


# Example skeleton for a real UDP-socket adapter (commented; finish in Claude Code):
#
# import socket
# class UdpSimAdapter(SimulatorAdapter):
#     def __init__(self, host="127.0.0.1", port=47808, timeout=2.0):
#         self.addr = (host, port); self.timeout = timeout
#     def send(self, request_hex, request_meta):
#         s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
#         s.settimeout(self.timeout)
#         try:
#             s.sendto(bytes.fromhex(request_hex), self.addr)
#             data, _ = s.recvfrom(65535)
#             return data.hex()
#         except socket.timeout:
#             return ""
#         finally:
#             s.close()


ADAPTERS = {"echo": EchoAdapter, "null": NullAdapter}


# ---------------------------------------------------------------------------
# Diffing
# ---------------------------------------------------------------------------
def diff_response(expected, actual_hex, byte_exact):
    """
    expected: the 'response' dict from the baseline.
    actual_hex: hex string the simulator produced.
    Returns (passed: bool, details: dict).
    """
    exp_hex = expected.get("hex", "")
    details = {}

    if not actual_hex:
        return False, {"reason": "simulator produced no response",
                       "expected_apdu_type": expected.get("apdu_type")}

    # Byte-exact path (strictest)
    if byte_exact:
        if actual_hex.lower() == exp_hex.lower():
            return True, {"match": "byte-exact"}
        details["byte_exact"] = False
        details["first_divergence"] = _first_divergence(exp_hex, actual_hex)

    # Field-level path: compare the APDU header bytes that carry semantics.
    # BVLC(4) + NPDU(var) + APDU. For a robust field diff, decode actual_hex
    # the same way parse_captures decodes the real one (write actual to a temp
    # pcap and run tshark, OR decode with bacpypes). Left as a TODO so you can
    # choose the approach that matches your adapter.
    #
    # TODO: implement semantic field comparison. For now, fall back to a
    # length + leading-byte heuristic so the harness is runnable end-to-end.
    exp_type = expected.get("apdu_type")
    same_len = len(actual_hex) == len(exp_hex)
    details.update({
        "expected_apdu_type": exp_type,
        "expected_len": len(exp_hex) // 2,
        "actual_len": len(actual_hex) // 2,
        "length_match": same_len,
    })
    passed = (actual_hex.lower() == exp_hex.lower())
    details["match"] = "exact" if passed else "differs"
    return passed, details


def _first_divergence(a, b):
    n = min(len(a), len(b))
    for i in range(0, n, 2):
        if a[i:i+2].lower() != b[i:i+2].lower():
            return {"byte_offset": i // 2,
                    "expected": a[i:i+2], "actual": b[i:i+2]}
    if len(a) != len(b):
        return {"byte_offset": n // 2, "note": "length differs beyond this point"}
    return None


def run(baseline_path, adapter, byte_exact):
    meta = json.load(open(baseline_path))
    adapter.setup(meta)
    results = []
    complete = [t for t in meta["transactions"] if t["status"] == "complete"]
    for t in complete:
        req = t["request"]
        resp = t["response"]
        req_meta = dict(req)
        req_meta["_expected_response_hex"] = resp.get("hex", "")  # only EchoAdapter uses this
        actual = adapter.send(req.get("hex", ""), req_meta)
        passed, details = diff_response(resp, actual, byte_exact)
        results.append({
            "invoke_id": req.get("invoke_id"),
            "service": req.get("service"),
            "request_frame": req.get("frame"),
            "passed": passed,
            "details": details,
        })
    adapter.teardown()
    return meta["capture"], results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("baselines", nargs="+", help="baseline JSON file(s) or glob(s)")
    ap.add_argument("--adapter", default="echo",
                    help="adapter name (built-in: echo, null) or import path module:Class")
    ap.add_argument("--byte-exact", action="store_true",
                    help="require byte-identical responses")
    ap.add_argument("--report-dir", default=os.path.join(os.path.dirname(__file__), "..", "reports"))
    args = ap.parse_args()

    # resolve adapter
    if args.adapter in ADAPTERS:
        adapter = ADAPTERS[args.adapter]()
    elif ":" in args.adapter:
        mod, cls = args.adapter.split(":", 1)
        import importlib
        adapter = getattr(importlib.import_module(mod), cls)()
    else:
        sys.exit(f"unknown adapter '{args.adapter}' (try: echo, null, or module:Class)")

    paths = []
    for b in args.baselines:
        paths += glob.glob(b) if any(ch in b for ch in "*?[") else [b]

    os.makedirs(args.report_dir, exist_ok=True)
    grand_pass = grand_total = 0
    for p in paths:
        capture, results = run(p, adapter, args.byte_exact)
        npass = sum(1 for r in results if r["passed"])
        grand_pass += npass
        grand_total += len(results)
        out = os.path.join(args.report_dir, os.path.splitext(os.path.basename(p))[0] + ".report.json")
        json.dump({"capture": capture, "adapter": args.adapter,
                   "byte_exact": args.byte_exact,
                   "passed": npass, "total": len(results),
                   "results": results}, open(out, "w"), indent=2)
        status = "OK" if npass == len(results) else "FAIL"
        print(f"[{status}] {capture}: {npass}/{len(results)} passed -> {out}")
        for r in results:
            if not r["passed"]:
                print(f"     FAIL iid={r['invoke_id']} svc={r['service']} "
                      f"frame={r['request_frame']}: {r['details'].get('reason') or r['details'].get('match')}")

    print(f"\nTOTAL: {grand_pass}/{grand_total} transactions passed "
          f"({'adapter=' + args.adapter}, byte_exact={args.byte_exact})")


if __name__ == "__main__":
    main()
