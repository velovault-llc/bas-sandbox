# BACnet Validation Harness — Mission Brief for Claude Code

> Read this whole file before writing code. It explains *why* this exists, not just *what* it does. The "why" should drive your decisions when the spec is ambiguous.

## The product this serves

We are building a **BACnet training simulator** — think "Packet Tracer, but for BACnet." The target users are HVAC/controls technicians (a workforce aging into retirement, taking undocumented BACnet expertise with them) who need to learn the protocol layer hands-on. The simulator lets a trainee poke virtual controllers and watch BACnet traffic flow, and eventually program controllers through the same interface. A local (air-gapped, on-device) AI assistant catches issues and suggests fixes — important because a key target market is **federal facilities** that cannot have cloud AI touching their building systems.

## The problem this harness solves

The simulator's entire value proposition is that it teaches the *real* protocol. If it teaches subtly-wrong BACnet, that is **worse than teaching nothing** — it would burn credibility with the exact retiring-expert community whose endorsement we need.

Right now the simulator's correctness rests on reasoning about what BACnet *should* do. That is not good enough. We need **ground truth from real devices**. Buying hardware is the obvious path but it's slow and costs money. The faster, cheaper path: there is a large public corpus of **real BACnet packet captures** maintained by Steve Karg (author of the open-source bacnet-stack) at https://kargs.net/captures/ — organized by *behavior and edge case* (atomic file read/write, segmented writes, malformed APDUs, bad ACKs, BBMD-on-subnet, multi-vendor plugfest traffic, etc.).

**This harness turns that corpus into a regression test suite for the simulator.** For each request/response transaction in a real capture, we feed the request to the simulator and diff its response, byte-for-byte at the decoded-field level, against what the real device actually said.

## The strategic prize (keep this in mind)

A polished simulator UI is not defensible — anyone can build one. What IS defensible is a **verified corpus of how real BACnet devices actually behave, including undocumented quirks.** This harness is the tool that *builds and curates that corpus*. Treat the structured transaction library it produces as a first-class asset, not throwaway test scaffolding. Name things, version things, and keep the parsed transactions in a clean, queryable form.

## Build order (do NOT skip ahead)

1. **Stage 1 — Corpus + Parser (free, do first).** Mirror the kargs.net corpus locally. Parse each capture into structured `Transaction` records (request paired to response by invoke ID + peer addresses). This is `harness/fetch_corpus.py` and `harness/parse_captures.py`. **This stage is already scaffolded and working — verify and extend it.**
2. **Stage 2 — Diff harness.** For each transaction, send the request bytes to the simulator-under-test and capture its response; diff decoded fields against the real response. Skeleton is in `harness/diff_harness.py` with a pluggable `SimulatorAdapter` — you will need to implement the adapter against the actual simulator's interface (see TODOs there).
3. **Stage 3 — Live reference device (still free).** Stand up a `bacpypes` server as an interactive known-good device for scenarios static captures can't cover (arbitrary trainee pokes). Not yet built — `harness/reference_device.py` is a stub.
4. **Stage 4 — Real hardware (maybe never).** Only buy controllers if a specific behavior the software reference can't reproduce turns out to matter. Don't pre-empt this.

## Technical decisions already made (and why)

- **tshark is the decoder, not scapy.** scapy parses BVLC/NPDU framing but its BACnet *application-layer* dissection is shallow. Wireshark's BACnet dissector (via `tshark -T json` / `-T fields`) is mature and decodes service choice, object IDs, property identifiers, values. The parser shells out to tshark. (Confirmed working with tshark 4.2.)
- **bacpypes is the second dependency**, reserved for Stage 3 (live reference device) and any semantic-level value comparison. It understands BACnet objects natively and is the natural engine for a simulated device, so we standardize on it rather than learning a third library.
- **Transactions are keyed by `(invoke_id, requester_addr, responder_addr)`.** Invoke ID alone is not unique across a busy multi-device capture; the address pair disambiguates. Unconfirmed services (e.g., I-Am, Who-Is, COV notifications) have no invoke-ID pairing — handle them as standalone events, not request/response pairs.
- **Diffing happens at the decoded-field level, with a raw-hex fallback.** Byte-exact hex diff is the strictest check but flags benign differences (e.g., a timestamp or a different invoke ID the simulator legitimately chose). Decoded-field diffing lets you whitelist fields that are *allowed* to differ. Support both; default to field-level.

## Known edge-case captures worth targeting deliberately

These filenames in the corpus are gold because the failure they exercise is exactly what a trainee must understand:
- `atomic_write_file_bad_ack.cap` — device retransmits after a malformed ACK. If the sim doesn't retransmit, trainees never see a real-world failure.
- `bacapp-malform.cap` — malformed application PDUs; tests error handling.
- `atomic-read-file-seg.cap` / `atomic-write-file-seg.cap` — segmentation, a classic source of subtle bugs.
- `alerton-plugfest*.cap` — multi-vendor interop traffic = real vendor quirks in one file.
- `BACnet-BBMD-on-same-subnet.cap` — BBMD/routing behavior.

## What "done" looks like for each stage

- Stage 1: `python -m harness.fetch_corpus` mirrors the corpus; `python -m harness.parse_captures captures/atomic-read-file.cap` prints clean structured transactions and writes a JSON transaction file to `baselines/`.
- Stage 2: `python -m harness.diff_harness baselines/atomic-read-file.json` runs every transaction through the simulator adapter and writes a pass/fail report to `reports/` with per-field diffs on failures.
- Stage 3: `python -m harness.reference_device` runs a live bacpypes device you can point a client at.

## Guardrails

- Do not assume capture files are clean — some are deliberately malformed. Parse defensively; a parse failure on one packet must not abort the whole file.
- Keep the parsed-transaction JSON schema stable and documented (`harness/schema.md`) — downstream tools and the corpus-as-asset depend on it.
- Everything here must run **offline** after the corpus is fetched once. No runtime cloud dependencies — this mirrors the air-gapped federal constraint.
