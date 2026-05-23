# Parse the JCI Metasys Site Management Portal Help PDF (already
# converted to text via `pdftotext -layout`) and emit a structured
# JSON catalog of BACnet objects + their attributes. The catalog
# becomes the authoritative reference for the sandbox's conformance
# checker: "JCI's interpretation of ASHRAE 135 §12 is canonical for
# the Metasys product family; here's the table from their own docs."
#
# Input:  /tmp/metasys.txt   (produced by `pdftotext -layout PDF...help.pdf`)
# Output: packages/core/src/bacnet/metasysCatalog.ts
#
# This is one-shot — re-run if JCI updates their help PDF.

import json
import os
import re
import sys
import tempfile
from pathlib import Path

# Resolve /tmp portably — git-bash on Windows aliases /tmp to the user's
# AppData\Local\Temp but Python (when invoked from the same shell)
# reads "/tmp/metasys.txt" as a literal Windows path that doesn't
# exist. Use Python's tempfile.gettempdir() which gives the right
# answer on every platform.
TMP = Path(tempfile.gettempdir())
INPUT = TMP / "metasys.txt"
OUTPUT_JSON = TMP / "metasys-catalog.json"

# Object types we care about — these all appear as section headers in
# the SMP help. The numeric ASHRAE 135 type code comes from §12 of
# the spec; included here for cross-reference.
OBJECT_TYPES = [
    ("Analog Input Object",       "analog-input",        0),
    ("Analog Output Object",      "analog-output",       1),
    ("Analog Value Object",       "analog-value",        2),
    ("Binary Input Object",       "binary-input",        3),
    ("Binary Output Object",      "binary-output",       4),
    ("Binary Value Object",       "binary-value",        5),
    ("Calendar Object",           "calendar",            6),
    ("Device Object",             "device",              8),
    ("Event Enrollment Object",   "event-enrollment",    9),
    ("File Object",               "file",                10),
    ("Group Object",              "group",               11),
    ("Loop Object",               "loop",                12),
    ("Multistate Input Object",   "multi-state-input",   13),
    ("Multistate Output Object",  "multi-state-output",  14),
    ("Notification Class Object", "notification-class",  15),
    ("Program Object",            "program",             16),
    ("Schedule Object",           "schedule",            17),
    ("Averaging Object",          "averaging",           18),
    ("Multistate Value Object",   "multi-state-value",   19),
    ("Trend Log Object",          "trend-log",           20),
    ("Accumulator Object",        "accumulator",         23),
]


def find_section_bounds(lines: list[str], section_name: str) -> tuple[int, int] | None:
    """Return (start_line, end_line) for the BIGGEST (most-detailed)
    occurrence of a section heading. The PDF lists each object twice:
    once briefly in the early TOC area, once in detail later. We want
    the late-detailed occurrence."""
    matches = []
    for i, line in enumerate(lines):
        if line.strip() == section_name:
            matches.append(i)
    if not matches:
        return None
    # Take the last occurrence (detailed section, not the TOC entry).
    start = matches[-1]
    # End = the next OBJECT_TYPES section header, or +800 lines as a
    # generous default.
    next_headers = {st: None for (st, _, _) in OBJECT_TYPES}
    for i in range(start + 1, min(start + 800, len(lines))):
        if lines[i].strip() in next_headers and lines[i].strip() != section_name:
            return (start, i)
    return (start, min(start + 800, len(lines)))


# Attribute rows in the table look like the attribute name on its own line
# (possibly with column data on the same or following lines). The Notes /
# BACnet Notes / Initial Value columns are positioned with fixed indent
# from the layout output. We approximate by recognizing the attribute
# names from a known set + the structure.

# Standard ASHRAE 135 attributes that should appear on most BACnet
# objects. We mark these so the conformance checker can verify the
# sandbox emits them.
STANDARD_BACNET_ATTRIBUTES = {
    "Object Identifier",
    "Object Name",
    "Object Type",
    "Description",
    "Present Value",
    "Status Flags",
    "Event State",
    "Reliability",
    "Out of Service",
    "Units",
    "Min Pres Value",
    "Max Pres Value",
    "COV Increment",
    "Time Delay",
    "Notification Class",
    "Event Enable",
    "Acked Transitions",
    "Notify Type",
    "Event Time Stamps",
    "Polarity",
    "Inactive Text",
    "Active Text",
    "Number Of States",
    "State Text",
    "Priority Array",
    "Relinquish Default",
    "Resolution",
    "Update Interval",
    "Device Type",
}


def parse_section(lines: list[str], start: int, end: int) -> dict:
    """Extract attribute names + their BACnet/notes flags from a
    section's attribute table. Heuristic — looks for lines that match
    attribute-name patterns followed by short codes."""
    description_lines: list[str] = []
    # First paragraph after the section header = description.
    for i in range(start + 1, min(start + 20, end)):
        ln = lines[i].strip()
        if not ln:
            if description_lines:
                break
            continue
        if ln.startswith("Table ") or ln.endswith("Attributes") or "Attribute Name" in ln:
            break
        description_lines.append(ln)
        if len(description_lines) >= 3:
            break

    description = " ".join(description_lines).strip()

    # Collect attribute names. The layout-PDF output uses indentation
    # to separate columns, but tables wrap unpredictably. Strategy:
    # gather every line in the range, then keep ones that look like
    # plausible attribute names (Title Case, 1-4 words, ≤32 chars,
    # not a complete sentence).
    attributes: list[str] = []
    seen: set[str] = set()
    in_commands_section = False
    for i in range(start, end):
        raw = lines[i].rstrip()
        ln = raw.strip()
        if not ln:
            continue
        # Stop attribute collection once we hit the Commands subsection.
        if re.match(r"^.+ Commands$", ln) and "Object" not in ln:
            in_commands_section = True
        if in_commands_section:
            continue
        # Skip table-header rows and "Page N of M" footers.
        if ln.startswith("Page ") or ln.startswith("Table "):
            continue
        if ln.startswith("Attribute Name") or ln == "Description" or ln == "Descriptions":
            continue
        if "Initial Value" in ln and len(ln) < 40:
            continue
        # Skip the notes legend.
        if re.match(r"^[A-Z](\s*-\s*)", ln):
            continue
        # Plausible attribute name: starts at column 0 or 1, title-cased,
        # ≤32 chars, no period at end (not a description sentence).
        if (
            re.match(r"^[A-Z][A-Za-z ]{2,30}$", ln)
            and not ln.endswith(".")
            and 1 <= len(ln.split()) <= 4
            # Must not be a section header.
            and ln not in {st for (st, _, _) in OBJECT_TYPES}
            # Skip random capitalized words that aren't attributes.
            and ln not in {
                "Examples", "Notes", "Description", "Attribute", "Reliable",
                "Unreliable", "True", "False", "Null", "None", "OK", "Cancel",
                "Yes", "No", "Online", "Offline", "Normal", "Fault",
                "Disable Alarms", "Enable Alarms", "In Service", "Out of Service",
                "Temporary Out of Service",
            }
        ):
            if ln not in seen:
                seen.add(ln)
                attributes.append(ln)

    return {
        "description": description,
        "attributes": attributes,
    }


def main() -> None:
    if not INPUT.exists():
        print(f"ERROR: {INPUT} not found.", file=sys.stderr)
        print("Generate it first:", file=sys.stderr)
        print("  pdftotext -layout 'PDF ExportJCImetasysobjecthelp.pdf' /tmp/metasys.txt",
              file=sys.stderr)
        sys.exit(1)

    text = INPUT.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    catalog = []
    for (section_name, type_id, type_code) in OBJECT_TYPES:
        bounds = find_section_bounds(lines, section_name)
        if bounds is None:
            print(f"WARN: no section found for {section_name!r}", file=sys.stderr)
            continue
        start, end = bounds
        section = parse_section(lines, start, end)
        # Tag standard BACnet attributes vs JCI-specific.
        attrs = []
        for a in section["attributes"]:
            attrs.append({
                "name": a,
                "isBacnetStandard": a in STANDARD_BACNET_ATTRIBUTES,
            })
        catalog.append({
            "objectType": type_id,
            "typeCode": type_code,
            "displayName": section_name,
            "description": section["description"],
            "attributes": attrs,
            "attributeCount": len(attrs),
            "source": "JCI Metasys SMP Help (PDF Export)",
        })
        print(f"  {section_name:30s} → {len(attrs)} attrs", file=sys.stderr)

    OUTPUT_JSON.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"\nWrote {len(catalog)} object types to {OUTPUT_JSON}", file=sys.stderr)


if __name__ == "__main__":
    main()
