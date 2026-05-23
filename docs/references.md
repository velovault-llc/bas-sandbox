# BACnet + HVAC reference material

Authoritative sources the sandbox draws from, with access notes for each.

## ASHRAE Standard 135 — the BACnet spec

**Standard 135-2024** is the current published version (released Dec 2024). It supersedes 135-2020.

### Free read-only access (just published — May 2025)

ASHRAE now offers free read-only PDF previews of every standard:

```
https://ashrae.iwrapper.com/ASHRAE_PREVIEW_ONLY_STANDARDS/STD_135_2024
```

No signup required. Loads in browser, can't be saved/printed, but lets you read every clause. Use this to verify any specific claim the conformance checker makes ("ASHRAE 135 §16.10.2 requires Max-APDU-Length-Accepted in I-Am" — go read §16.10.2).

### Paywalled formats (for offline use)

- ASHRAE webstore PDF: $200 — https://www.ashrae.org/technical-resources/bookstore/bacnet
- ANSI webstore: same price — https://webstore.ansi.org/standards/ashrae/ansiashrae1352024

### Free addenda and errata

Published addenda + errata are free on the ASHRAE site:

```
https://www.ashrae.org/technical-resources/standards-and-guidelines/standards-addenda
```

Useful when the released spec is corrected mid-cycle.

## bacpypes3 — Python BACnet reference implementation

The cleanest free interpretation of the spec we have. Joel Bender (former BACnet SSPC member) maintains it. When the sandbox needs to know "what's the canonical encoding of X," we read bacpypes3's source.

```
pip install bacpypes3
```

Then read source at:

```
C:\Users\jmsbo\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\site-packages\bacpypes3\
```

Or on GitHub: https://github.com/JoelBender/bacpypes3

The sandbox already uses `tools/bacnet-reference/bacserv.py` as a live reference device built on bacpypes3.

## bacnet-stack — C BACnet reference implementation

C-language equivalent of bacpypes3. ASHRAE-aligned, open source, used in production by hundreds of vendors. Useful when you want to see "how does a real bacstack encode this field" in low-level C with comments referencing spec sections.

```
https://github.com/bacnet-stack/bacnet-stack
```

Pre-built Windows binaries on SourceForge:

```
https://sourceforge.net/projects/bacnet/files/bacnet-stack/
```

## JCI Metasys — vendor-specific reference

Johnson Controls' Metasys product family is the dominant BACnet supervisor in North America. Their docs serve as a practical reference for "how vendors interpret + extend the spec."

### FAN-410 — Metasys Installation Quick Reference Handbook

JCI's compact field installation reference for HVAC controls cable + wiring standards + best practices. Used as the official ground-truth for JCI install crews.

- **iOS app:** https://apps.apple.com/us/app/fan-410-installation-reference/id1527588808 — free download, contains the handbook content
- **PDF:** behind JCI partner portal (jci-partners.com / docs.johnsoncontrols.com) — accessible to certified Metasys techs

The iOS app is the most accessible form for non-employees. Search "FAN-410 Installation Reference" in the App Store.

### Metasys Site Management Portal Help

The 790-page PDF help for the supervisor side of Metasys (the SMP). Documents every Metasys BACnet object, attribute table, alarm extension, scheduling primitive, etc.

PDF lives at: `C:\Users\jmsbo\Desktop\jci\PDF ExportJCImetasysobjecthelp.pdf` (user-local).

The sandbox's `packages/core/src/bacnet/objectCatalog.ts` is partially derived from this PDF — specifically the JCI-proprietary attribute extensions (Use COV Min Send Time, Use Remote Alarming, Intrinsic Alarming Defined) appearing on standard BACnet objects.

### CCT (Controller Configuration Tool) help

PDF: `C:\Users\jmsbo\Desktop\jci\PDF Exportcct help.pdf` (57 MB). Documents JCI's block-graph language used to program field controllers. The sister project `dbexport-viewer` mines this to map class IDs to block names.

## BTL — BACnet Testing Laboratories

Conformance test suite + listings for certified BACnet devices.

```
https://www.bacnetinternational.net/btl/
```

The BTL test plan is purchasable (~$500 USD) but a free summary is available. Useful when the sandbox wants to claim "we'd pass the BTL test for service X."

## Free BACnet Wireshark dissector

Wireshark's `bacapp` dissector decodes BACnet PDUs natively. Source: https://github.com/wireshark/wireshark/blob/master/epan/dissectors/packet-bacapp.c

Reading this dissector teaches the spec by example — every service has a function that parses its tagged-encoding into fields, with comments pointing to the §-clauses.
