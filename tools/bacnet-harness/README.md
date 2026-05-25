# BACnet Validation Harness

Validate a BACnet simulator against **real-world packet captures** — no hardware
required to start. Built to keep a BACnet *training* simulator honest: if it
teaches subtly-wrong protocol behavior, that's worse than teaching nothing.

**Read `CLAUDE.md` first** — it's the mission brief explaining why this exists and
the intended build order. This README is just the quickstart.

## What it does

1. **Mirrors** the public BACnet capture corpus (Steve Karg's collection at
   kargs.net/captures — real traffic organized by behavior & edge case).
2. **Parses** captures into structured request/response transactions (via
   tshark's BACnet dissector), keyed by invoke ID + peer addresses.
3. **Diffs** your simulator's responses against the real devices', per
   transaction, with a pluggable adapter.

## Dependencies

- **tshark** (Wireshark CLI) — does the BACnet decoding. `apt install tshark`
  or `brew install wireshark`. Verify: `tshark --version`.
- **Python 3.9+**
- `pip install -r requirements.txt` (scapy for framing peeks, bacpypes for the
  Stage-3 live reference device).

## Quickstart

```bash
# 1. fetch the curated edge-case captures (offline-friendly after first run)
python -m harness.fetch_corpus            # or --all for the whole collection

# 2. parse them into structured baselines
python -m harness.parse_captures corpus/*.cap --json-dir baselines/

# 3. prove the harness works (echo adapter = all pass, null = all fail)
python -m harness.diff_harness baselines/atomic-read-file.json --adapter echo
python -m harness.diff_harness baselines/atomic-read-file.json --adapter null

# 4. wire YOUR simulator: implement a SimulatorAdapter (see diff_harness.py TODOs)
#    then:
python -m harness.diff_harness baselines/*.json --adapter yourmodule:YourAdapter
```

## Layout

```
CLAUDE.md                 <- mission brief: READ FIRST
README.md                 <- this file
requirements.txt
harness/
  fetch_corpus.py         <- Stage 1: mirror the corpus
  parse_captures.py       <- Stage 1: pcap -> structured transactions (WORKING)
  diff_harness.py         <- Stage 2: replay requests at sim, diff responses
  reference_device.py     <- Stage 3: live bacpypes device (STUB)
  schema.md               <- baseline JSON schema (the stable contract)
corpus/                   <- downloaded captures
baselines/                <- parsed transaction JSON (the reusable asset)
reports/                  <- diff pass/fail reports
```

## The first real task in Claude Code

Implement `SimulatorAdapter.send()` in `harness/diff_harness.py` against your
simulator's actual interface, then run the diff over the curated captures and
see where your simulator diverges from real devices. Start with
`atomic_write_file_bad_ack.cap` — it contains a real retransmit-after-bad-ack
sequence that a simulator must reproduce to be realistic.

Then finish the **field-level diff** (currently a length/exact-match heuristic —
see the TODO in `diff_response()`): decode the simulator's response the same way
`parse_captures.py` decodes the real one (write its bytes to a temp pcap and run
tshark, or decode with bacpypes) so you can whitelist fields that are *allowed*
to differ (e.g. invoke IDs the sim legitimately chooses).
