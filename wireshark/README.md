# Capture catalog — real-BACnet ground truth

Companion to [tools/real-bacnet-rig/README.md](../tools/real-bacnet-rig/README.md).
One line per capture: what's in it, why it matters.

| File | What | Notable |
|---|---|---|
| `lab1-first-contact.pcapng` | **First rig capture (2026-06-10).** YABE (192.168.1.150, desktop) discovers bacserv 1.4.1 device 1234 (192.168.1.165, laptop, aliased "ClaudeSimDevice"). 47 BACnet frames over ~4 min. | Full **I-Am reference encoding**: device id + Max APDU 1476 + Segmentation no-segmentation(3) + Vendor 260, NPDU global-broadcast (DNET 65535, hop 255) — the fix-template for the sandbox's abbreviated I-Am conformance ⚠. Also on the wire and **unmodeled by the sandbox**: `readPropertyMultiple` (YABE's default read), `timeSynchronization` + `utcTimeSynchronization`, `who-Has`/`i-Have`, and an **unsubscribed broadcast** `unconfirmedCOVNotification` (AV:1) — COV without any SubscribeCOV. I-Am observed ×2 per trigger ~150 µs apart (multi-send or capture artifact — unresolved). |
| `lab1-yabe-aliases.YabeMap` | YABE's local alias cache from the same session (binary .NET serialization). | Maps (device 1234 @ C0A801A5, TRENDLOG:2) → display names. Kept for session reproducibility; not device data. |
| `captureforclaude1.pcapng` / `cp2.pcapng` | Earlier exploratory captures (pre-rig). | — |
| `dgfwegw.csv` | Exploratory export. | — |
