"""
TechStack Radar — Phase 1: Detection Engine (v3 - FIXED)
Detects technologies used on a website by matching signatures against
HTML source, script tags, cookies, and response headers.

Usage:
    python detect_tech.py https://example.com
    python detect_tech.py --file domains.txt --out results.json
"""

import re
import json
import sys
import time
import argparse
from dataclasses import dataclass, asdict
from typing import List, Optional

import requests


# ---------------------------------------------------------------------------
# Signature definitions — v3
# - GA4 pattern strict (case-sensitive, exactly 10 chars, word boundary)
# - WooCommerce strict (only asset paths, not free text)
# - "case_sensitive": True flag supported per-signature
# ---------------------------------------------------------------------------

SIGNATURES = [
    # --- Analytics ---
    {"name": "Google Analytics 4", "category": "analytics",
     "case_sensitive": True,
     "html_patterns": [
         r"gtag\('config',\s*['\"]G-[A-Z0-9]{10}['\"]",
         r"googletagmanager\.com/gtag/js\?id=G-[A-Z0-9]{10}",
         r"\bG-[A-Z0-9]{10}\b",
     ]},
    {"name": "Google Tag Manager", "category": "analytics",
     "html_patterns": [r"googletagmanager\.com/gtm\.js"]},
    {"name": "Segment", "category": "analytics",
     "html_patterns": [r"cdn\.segment\.com/analytics\.js"]},
    {"name": "Mixpanel", "category": "analytics",
     "html_patterns": [r"cdn\.mxpnl\.com", r"mixpanel\.init"]},
    {"name": "Hotjar", "category": "analytics",
     "html_patterns": [r"static\.hotjar\.com"]},

    # --- CRM / Marketing ---
    {"name": "HubSpot", "category": "crm_marketing",
     "html_patterns": [r"js\.hs-scripts\.com", r"hs-analytics\.net", r"hs-scripts\.com"]},
    {"name": "Marketo", "category": "crm_marketing",
     "html_patterns": [r"munchkin\.marketo\.net"]},
    {"name": "Salesforce", "category": "crm_marketing",
     "html_patterns": [r"force\.com", r"salesforce\.com/embeddedservice"]},
    {"name": "Intercom", "category": "crm_marketing",
     "html_patterns": [
         r"widget\.intercom\.io",
         r"Intercom\('boot'",
         r"intercomcdn\.com",
     ]},
    {"name": "Drift", "category": "crm_marketing",
     "html_patterns": [r"js\.driftt\.com"]},

    # --- Payments ---
    {"name": "Stripe", "category": "payments",
     "html_patterns": [r"js\.stripe\.com", r"stripe\.com/v3"]},
    {"name": "PayPal", "category": "payments",
     "html_patterns": [r"paypalobjects\.com", r"paypal\.com/sdk/js"]},
    {"name": "Braintree", "category": "payments",
     "html_patterns": [r"js\.braintreegateway\.com"]},

    # --- Ecommerce ---
    {"name": "Shopify", "category": "ecommerce",
     "html_patterns": [r"cdn\.shopify\.com", r"shopifycdn\.com"],
     "cookie_patterns": [r"_shopify_"]},
    {"name": "WooCommerce", "category": "ecommerce",
     "html_patterns": [
         r"/wp-content/plugins/woocommerce/",
         r"woocommerce-assets",
         r"wc-ajax=",
     ]},
    {"name": "BigCommerce", "category": "ecommerce",
     "html_patterns": [r"cdn\.bigcommerce\.com"]},

    # --- Ad tech ---
    {"name": "Meta Pixel", "category": "ad_tech",
     "html_patterns": [r"connect\.facebook\.net.*fbevents\.js", r"fbq\('init'"]},
    {"name": "Google Ads", "category": "ad_tech",
     "html_patterns": [r"googleadservices\.com", r"gtag\('config',\s*'AW-"]},
    {"name": "LinkedIn Insight Tag", "category": "ad_tech",
     "html_patterns": [r"snap\.licdn\.com/li\.lms-analytics"]},

    # --- Infra / CDN ---
    {"name": "Cloudflare", "category": "infra",
     "header_patterns": [r"cloudflare"]},
    {"name": "AWS (CloudFront)", "category": "infra",
     "header_patterns": [r"cloudfront"]},
]


@dataclass
class TechMatch:
    name: str
    category: str
    confidence: float
    matched_on: str


def fetch_site(url: str, timeout: int = 10) -> Optional[requests.Response]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        return resp
    except requests.RequestException as e:
        print(f"  [!] fetch failed for {url}: {e}", file=sys.stderr)
        return None


def detect_technologies(html: str, cookies: dict, response_headers: dict) -> List[TechMatch]:
    matches = []
    header_blob = " ".join(f"{k}:{v}" for k, v in response_headers.items()).lower()
    cookie_blob = " ".join(cookies.keys()).lower()

    for sig in SIGNATURES:
        signals_matched = []

        # HTML patterns (respect per-signature case_sensitive flag)
        html_flags = 0 if sig.get("case_sensitive") else re.IGNORECASE
        for pattern in sig.get("html_patterns", []):
            if re.search(pattern, html, html_flags):
                signals_matched.append("html")
                break

        # Cookie patterns
        for pattern in sig.get("cookie_patterns", []):
            if re.search(pattern, cookie_blob, re.IGNORECASE):
                signals_matched.append("cookie")
                break

        # Header patterns
        for pattern in sig.get("header_patterns", []):
            if re.search(pattern, header_blob, re.IGNORECASE):
                signals_matched.append("header")
                break

        if signals_matched:
            if "html" in signals_matched or "cookie" in signals_matched:
                confidence = 0.9
            else:
                confidence = 0.6
            matches.append(TechMatch(
                name=sig["name"],
                category=sig["category"],
                confidence=confidence,
                matched_on=signals_matched[0],
            ))

    return matches


def scan_domain(domain: str) -> dict:
    url = domain if domain.startswith("http") else f"https://{domain}"
    print(f"[*] scanning {url}")

    resp = fetch_site(url)
    if resp is None:
        return {"domain": domain, "status": "unreachable", "technologies": []}

    html = resp.text
    cookies = resp.cookies.get_dict()
    headers = dict(resp.headers)

    matches = detect_technologies(html, cookies, headers)

    return {
        "domain": domain,
        "status": "ok",
        "http_status": resp.status_code,
        "technologies": [asdict(m) for m in matches],
    }


def main():
    parser = argparse.ArgumentParser(description="TechStack Radar detection engine")
    parser.add_argument("url", nargs="?", help="single domain/URL to scan")
    parser.add_argument("--file", help="path to a text file of domains, one per line")
    parser.add_argument("--out", default="results.json", help="output JSON path")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    args = parser.parse_args()

    domains = []
    if args.url:
        domains = [args.url]
    elif args.file:
        with open(args.file, encoding="utf-8") as f:
            domains = [line.strip() for line in f if line.strip()]
    else:
        parser.print_help()
        sys.exit(1)

    results = []
    for i, domain in enumerate(domains):
        results.append(scan_domain(domain))
        if i < len(domains) - 1:
            time.sleep(args.delay)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"\n[+] Done. {len(results)} domains scanned. Results -> {args.out}")


if __name__ == "__main__":
    main()