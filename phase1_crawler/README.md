# Phase 1 — Detection Engine

## Overview
Crawls a list of domains, fetches HTML + headers + cookies, and matches
against a signature list of ~21 technologies across 6 categories
(analytics, CRM/marketing, payments, ecommerce, ad tech, infra).

## Detection method
Each signature has one or more patterns matched against:
- HTML source (case-insensitive by default, case-sensitive with `"case_sensitive": True`)
- Response headers (lowercased before matching)
- Cookie names (lowercased before matching)

Confidence scoring:
- 0.9 for html/cookie matches
- 0.6 for header-only matches (shared infra is weak evidence)

## Iteration log (this is the real engineering story)

### v1 — initial
- 20 signatures, all case-insensitive
- `woocommerce` matched free text → **3 false positives** (stripe.com, mailchimp.com, zapier.com)
- GA4 pattern `G-[A-Z0-9]{8,}` matched CSS hashes and JS class names
  → **9/10 sites "used GA4"** (obviously wrong)

### v2 — tightened WooCommerce
- Anchored to asset paths: `/wp-content/plugins/woocommerce/`, `wc-ajax=`
- WooCommerce false positives: **3 → 0**

### v3 — tightened GA4 + case sensitivity
- GA4 pattern now requires exact spec format: `\bG-[A-Z0-9]{10}\b`
- Added per-signature `case_sensitive` flag (regex flags must not be forced globally)
- GA4 detections: **9 → 1** (only substack.com, verified by debug script showing
  the actual measurement ID in source)

## Final metrics (13 sites)
- Sites with detections: 10/13 (77%)
- False positives: 0
- False negatives: stripe.com, mailchimp.com, airbnb.com
  → these are SPAs; tech is injected by client-side JS after page load

## Known limitations (deliberate trade-offs)
1. **Static HTML only.** Sites rendering tech via JS (React/Vue SPAs) are
   under-detected. Fix: Phase 1.5 — Playwright fallback for pages whose
   `resp.text` is under ~5KB meaningful content.
   Trade-off: Playwright is 10x slower and needs headless Chrome.
2. **No client-side Stripe detection.** Stripe.js only loads on checkout
   pages, not homepages. Detecting payment processors needs scoped crawling
   (`/pricing`, `/checkout`) — a Phase 2+ enhancement.
3. **21 signatures is deliberately small.** Growing the signature list is
   the product moat; 21 across 6 categories is enough to prove the concept
   and generate meaningful co-occurrence queries in Phase 3.

## What I'd do differently at scale
- Move signature store to a versioned config service (JSON in DB, hot-reloadable)
  so pattern updates don't require a crawler redeploy
- Multi-signal confidence: HTML + cookie match → 0.99, HTML-only → 0.85, header-only → 0.5
- Per-signature precision tracking in prod: log every match and periodically
  re-verify against ground-truth labels