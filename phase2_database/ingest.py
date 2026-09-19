"""
TechStack Radar — Phase 2: Idempotent ingestion
Reads Phase 1's results.json and upserts into PostgreSQL.

Idempotent: re-running on the same file updates last_seen and confidence
rather than duplicating rows. This is what makes the weekly re-crawl safe.
"""

import json
import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        port=os.getenv("DB_PORT"),
        sslmode="require",
    )


def ingest(results_path: str):
    with open(results_path, encoding="utf-8") as f:
        data = json.load(f)

    conn = get_conn()
    cur = conn.cursor()

    sites_ok = 0
    detections_upserted = 0

    for site in data:
        if site.get("status") != "ok":
            continue

        domain = (
            site["domain"]
            .replace("https://", "")
            .replace("http://", "")
            .strip("/")
        )

        # Upsert company, get id
        cur.execute("""
            INSERT INTO companies (domain, last_seen)
            VALUES (%s, NOW())
            ON CONFLICT (domain) DO UPDATE SET last_seen = NOW()
            RETURNING id
        """, (domain,))
        company_id = cur.fetchone()[0]
        sites_ok += 1

        for tech in site.get("technologies", []):
            # Upsert technology, get id
            cur.execute("""
                INSERT INTO technologies (name, category)
                VALUES (%s, %s)
                ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category
                RETURNING id
            """, (tech["name"], tech["category"]))
            tech_id = cur.fetchone()[0]

            # Upsert detection
            cur.execute("""
                INSERT INTO detections
                    (company_id, technology_id, confidence, matched_on, last_seen)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (company_id, technology_id) DO UPDATE
                    SET confidence = EXCLUDED.confidence,
                        matched_on = EXCLUDED.matched_on,
                        last_seen  = NOW()
            """, (company_id, tech_id, tech["confidence"], tech.get("matched_on")))
            detections_upserted += 1

    conn.commit()
    cur.close()
    conn.close()
    print(f"[+] Ingested {sites_ok} sites, {detections_upserted} detections")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "../phase1_crawler/results.json"
    ingest(path)