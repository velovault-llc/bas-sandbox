# Capture catalog — real-BACnet ground truth

Companion to [tools/real-bacnet-rig/README.md](../tools/real-bacnet-rig/README.md).
One line per capture: what's in it, why it matters.

| File | What | Notable |
|---|---|---|
| `lab1-first-contact.pcapng` | **First rig capture (2026-06-10).** YABE (192.168.1.150, desktop) discovers bacserv 1.4.1 device 1234 (192.168.1.165, laptop, aliased "ClaudeSimDevice"). 47 BACnet frames over ~4 min. | Full **I-Am reference encoding**: device id + Max APDU 1476 + Segmentation no-segmentation(3) + Vendor 260, NPDU global-broadcast (DNET 65535, hop 255) — the fix-template for the sandbox's abbreviated I-Am conformance ⚠. Also on the wire and **unmodeled by the sandbox**: `readPropertyMultiple` (YABE's default read), `timeSynchronization` + `utcTimeSynchronization`, `who-Has`/`i-Have`, and an **unsubscribed broadcast** `unconfirmedCOVNotification` (AV:1) — COV without any SubscribeCOV. I-Am observed ×2 per trigger ~150 µs apart (multi-send or capture artifact — unresolved). |
| `lab1-yabe-aliases.YabeMap` | YABE's local alias cache from the same session (binary .NET serialization). | Maps (device 1234 @ C0A801A5, TRENDLOG:2) → display names. Kept for session reproducibility; not device data. |
| `lab2-polling-cadence.pcapng` | **Polling-cadence fixture (2026-06-10).** Intended as the COV-lifecycle capture; YABE silently fell back to POLL mode ("Use polling by default"=True), so instead: a real client's RPM poll train at a metronomic 1.000 s with ACK latencies 3–120 ms (Wi-Fi), two clean writeProperty→Simple-ACK exchanges, and TWO device outage/recovery cycles (laptop Wi-Fi power-save — flapping, not crashing). | **bacserv boot dance**: on startup it sends `who-Is <own-range>` BEFORE i-Am — a real device checking for instance collision. Teaching material + sim candidate. Poll cadence + RTTs = tuning data for `APP_LAYER_POLL_CADENCE_S` / `BACNET_IP_RTT_SECONDS`. COV retry: unanswered poll → next attempt ~1.5 s (timeout 500 ms × 1 retry, per YABE settings). |
| `captureforclaude1.pcapng` / `cp2.pcapng` | Earlier exploratory captures (pre-rig). | — |
| `dgfwegw.csv` | Exploratory export. | — |
