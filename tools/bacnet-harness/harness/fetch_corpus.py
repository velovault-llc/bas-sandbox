#!/usr/bin/env python3
"""
fetch_corpus.py — Mirror the public BACnet capture corpus locally.

Source: https://kargs.net/captures/  (Steve Karg's collection — real BACnet
traffic organized by behavior and edge case). This is the ground-truth corpus
the validation harness diffs the simulator against.

Usage:
    python -m harness.fetch_corpus                 # fetch the curated edge-case set
    python -m harness.fetch_corpus --all           # scrape & fetch everything listed
    python -m harness.fetch_corpus --list          # just print what's available

Everything is cached under corpus/. Re-running skips files already present.
After the first fetch the whole pipeline runs offline (air-gapped friendly).
"""
import argparse
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

BASE = "https://kargs.net/captures/"
CORPUS_DIR = os.path.join(os.path.dirname(__file__), "..", "corpus")

# Curated high-value edge cases. Each teaches a behavior a simulator commonly
# gets wrong — see CLAUDE.md "Known edge-case captures."
CURATED = [
    "atomic-read-file.cap",
    "atomic-write-file.cap",
    "atomic-write-file-seg.cap",
    "atomic_write_file_bad_ack.cap",
    "bacapp-malform.cap",
    "BACnetARRAY-elements.cap",
    "BACnetARRAY-element-0.cap",
    "BACnet-BBMD-on-same-subnet.cap",
    "alerton-plugfest.cap",
    "alerton-plugfest-2.cap",
]


class LinkParser(HTMLParser):
    """Pull every .cap/.pcap/.pcapng href out of the directory index page."""
    def __init__(self):
        super().__init__()
        self.files = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for k, v in attrs:
            if k == "href" and re.search(r"\.(cap|pcap|pcapng)$", v, re.I):
                self.files.append(v.split("/")[-1])


def list_remote():
    with urllib.request.urlopen(BASE, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    p = LinkParser()
    p.feed(html)
    # de-dup, keep order
    seen, out = set(), []
    for f in p.files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def fetch(names):
    os.makedirs(CORPUS_DIR, exist_ok=True)
    ok, skip, fail = 0, 0, 0
    for name in names:
        dest = os.path.join(CORPUS_DIR, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skip += 1
            continue
        try:
            urllib.request.urlretrieve(BASE + name, dest)
            size = os.path.getsize(dest)
            print(f"  fetched {name} ({size} bytes)")
            ok += 1
        except Exception as e:
            print(f"  FAILED {name}: {e}", file=sys.stderr)
            fail += 1
    print(f"\nDone. {ok} fetched, {skip} already present, {fail} failed.")
    print(f"Corpus dir: {os.path.abspath(CORPUS_DIR)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true", help="fetch everything in the index")
    ap.add_argument("--list", action="store_true", help="list remote files and exit")
    args = ap.parse_args()

    if args.list:
        for f in list_remote():
            print(f)
        return
    if args.all:
        names = list_remote()
        print(f"Fetching all {len(names)} captures from {BASE} ...")
    else:
        names = CURATED
        print(f"Fetching {len(names)} curated edge-case captures ...")
    fetch(names)


if __name__ == "__main__":
    main()
