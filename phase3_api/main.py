"""
TechStack Radar — Phase 3: FastAPI
Exposes the PostgreSQL data as a queryable product for sales/marketing teams.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from db import get_conn

app = FastAPI(title="TechStack Radar API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.get("/")
def root():
    return {"name": "TechStack Radar API", "docs": "/docs"}


@app.get("/companies")
def companies_by_technology(technology: str, limit: int = 50):
    """Which companies use technology X? (e.g. /companies?technology=Cloudflare)"""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT c.domain, d.confidence, d.matched_on,
               d.first_seen, d.last_seen
        FROM companies c
        JOIN detections d ON d.company_id = c.id
        JOIN technologies t ON t.id = d.technology_id
        WHERE LOWER(t.name) = LOWER(%s)
        ORDER BY d.confidence DESC, c.domain
        LIMIT %s
    """, (technology, limit))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"technology": technology, "count": len(rows), "companies": rows}


@app.get("/companies/{domain}/stack")
def company_stack(domain: str):
    """Full detected stack for one company. (e.g. /companies/shopify.com/stack)"""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT t.name, t.category, d.confidence, d.matched_on
        FROM companies c
        JOIN detections d ON d.company_id = c.id
        JOIN technologies t ON t.id = d.technology_id
        WHERE c.domain = %s
        ORDER BY t.category, t.name
    """, (domain,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    if not rows:
        raise HTTPException(404, "company not found or has no detections")
    return {"domain": domain, "stack": rows}


@app.get("/technologies/co-occurring")
def co_occurring(
    with_tech: str = Query(..., alias="with", description="Technology to find co-occurrences for"),
    limit: int = 10,
):
    """
    Which technologies co-occur with X?
    This is the sales insight: 'companies using Shopify also use X'.
    URL uses ?with=X for readability; Python identifier is with_tech
    because 'with' is a reserved keyword.
    """
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT t2.name, t2.category, COUNT(DISTINCT d1.company_id) AS companies
        FROM detections d1
        JOIN detections d2
            ON d1.company_id = d2.company_id
           AND d1.technology_id <> d2.technology_id
        JOIN technologies t1 ON t1.id = d1.technology_id
        JOIN technologies t2 ON t2.id = d2.technology_id
        WHERE LOWER(t1.name) = LOWER(%s)
        GROUP BY t2.name, t2.category
        ORDER BY companies DESC, t2.name
        LIMIT %s
    """, (with_tech, limit))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"with": with_tech, "co_occurring": rows}


@app.get("/technologies/trending")
def trending(limit: int = 10):
    """Most common technologies across the crawled set."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT t.name, t.category,
               COUNT(DISTINCT d.company_id) AS companies
        FROM technologies t
        JOIN detections d ON d.technology_id = t.id
        GROUP BY t.name, t.category
        ORDER BY companies DESC, t.name
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"trending": rows}


@app.get("/stats")
def stats():
    """Overall dataset health — useful for a dashboard header."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM companies")
    companies = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM technologies")
    technologies = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM detections")
    detections = cur.fetchone()["c"]
    cur.close()
    conn.close()
    return {
        "companies": companies,
        "technologies": technologies,
        "detections": detections,
    }