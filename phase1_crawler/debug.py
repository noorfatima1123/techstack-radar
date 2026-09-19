"""
Debug script — shows exactly WHICH pattern matched and WHERE.
Uses the same flags logic as detect_tech.py so results match reality.
"""
import re
import requests
from detect_tech import SIGNATURES

DOMAINS = [
    "stripe.com",
    "shopify.com",
    "hubspot.com",
    "notion.so",
    "zapier.com",
    "gumroad.com",
    "substack.com",
    "udemy.com",
]

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

for domain in DOMAINS:
    print(f"\n{'='*70}\n{domain}\n{'='*70}")
    url = f"https://{domain}"
    try:
        r = requests.get(url, headers=headers, timeout=15)
    except Exception as e:
        print(f"  [!] fetch failed: {e}")
        continue

    any_match = False
    for sig in SIGNATURES:
        for pattern in sig.get("html_patterns", []):
            # Same flags logic as detect_tech.py
            flags = 0 if sig.get("case_sensitive") else re.IGNORECASE
            m = re.search(pattern, r.text, flags)
            if m:
                any_match = True
                start = max(0, m.start() - 40)
                end = min(len(r.text), m.end() + 40)
                snippet = r.text[start:end].replace("\n", " ").replace("\r", "")
                print(f"  [MATCH] {sig['name']:<25} pattern={pattern!r}")
                print(f"          ...{snippet}...")

    if not any_match:
        print("  (no matches)")