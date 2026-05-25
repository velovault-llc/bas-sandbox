# Baseline Transaction Schema

The stable contract between `parse_captures.py` (producer) and `diff_harness.py`
plus any future corpus-as-asset tooling (consumers). Keep this in sync if you
change the parser output.

## Top-level object (one per capture)

```jsonc
{
  "capture": "atomic-read-file.cap",     // source filename
  "frame_count": 128,                     // BACnet-bearing frames tshark decoded
  "transactions": [ <Transaction>, ... ], // confirmed request/response pairs
  "unconfirmed_events": [ <Event>, ... ]  // Who-Is, I-Am, COV, etc. (no pairing)
}
```

## Transaction

```jsonc
{
  "kind": "confirmed",
  "status": "complete" | "unanswered-request" | "orphan-response",
  "request": {                 // present unless status == "orphan-response"
    "frame": "3",
    "time": "0.000600000",     // seconds, relative to capture start
    "src": "192.168.0.13",
    "dst": "192.168.0.32",
    "invoke_id": "1",
    "service": "7",            // BACnet confirmed-service choice (int as string)
    "hex": "810a01d7..."       // full BACnet/IP UDP payload, lowercase hex
  },
  "response": {                // present unless status == "unanswered-request"
    "frame": "4",
    "time": "...",
    "src": "192.168.0.32",
    "dst": "192.168.0.13",
    "invoke_id": "1",
    "apdu_type": "complex-ack" | "simple-ack" | "error" | "reject" | "abort" | "segment-ack",
    "error_class": null,       // populated on error responses
    "error_code": null,
    "reject_reason": null,
    "abort_reason": null,
    "hex": "810a000b..."
  }
}
```

### status meanings
- `complete` — request paired with a response. The diffable unit.
- `unanswered-request` — a confirmed request with no matching response in the
  capture. Often a **retransmission** or a real comms failure — exactly the kind
  of error sequence a trainee needs to see. Worth simulating deliberately.
- `orphan-response` — a response whose request wasn't in the capture (capture
  started mid-stream). Usually ignore for diffing.

## Unconfirmed Event

```jsonc
{
  "kind": "unconfirmed",
  "frame": "1",
  "time": "...",
  "src": "192.168.0.13",
  "dst": "192.168.0.255",   // often broadcast
  "service": "8",            // unconfirmed-service choice (e.g. Who-Is, I-Am)
  "hex": "810a0010..."
}
```

## Common service-choice codes (for readability)
Confirmed: 6=AtomicReadFile, 7=AtomicWriteFile, 12=ReadPropertyMultiple,
15=WriteProperty, 16=WritePropertyMultiple, 0=AcknowledgeAlarm.
Unconfirmed: 0=I-Am, 1=I-Have, 2=unconfCOVNotification, 8=Who-Is, 7=Who-Has.
(Full list in ASHRAE 135 / the bacpypes APDU module.)
