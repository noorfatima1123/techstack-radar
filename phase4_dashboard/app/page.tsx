"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Company = { domain: string; confidence: number; matched_on: string };
type CoOcc = { name: string; category: string; companies: number };
type Trending = { name: string; category: string; companies: number };
type Stats = { companies: number; technologies: number; detections: number };

/* ------------------------------------------------------------------ */
/* Scope geometry                                                      */
/* ------------------------------------------------------------------ */

const SIZE = 680;
const C = SIZE / 2;
const R_MIN = 64; // strongest overlap sits here
const R_MAX = 215; // weakest overlap sits here
const R_EDGE = 226;
const SWEEP_S = 1.6;
const PAGE = 25;

const CATEGORY_COLORS = [
  "#7FA6FF",
  "#FFB454",
  "#5FD8B4",
  "#FF7C93",
  "#C7A8FF",
  "#9AD86B",
  "#F2E27A",
  "#7ED3F2",
];

const FILTERS = [
  { label: "All", min: 0 },
  { label: "65%+", min: 0.65 },
  { label: "85%+", min: 0.85 },
];

type Sector = { category: string; start: number; end: number; color: string };
type ScopeNode = CoOcc & {
  angle: number;
  r: number;
  size: number;
  color: string;
  delay: number;
};

/** Angle is degrees clockwise from 12 o'clock. */
function polar(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
}

function wedgePath(a0: number, a1: number, r: number) {
  const p0 = polar(a0, r);
  const p1 = polar(a1, r);
  return `M${C} ${C} L${p0.x} ${p0.y} A${r} ${r} 0 0 1 ${p1.x} ${p1.y} Z`;
}

/**
 * Category → wedge. Overlap → distance from center (closer = more shared companies).
 * Company count → dot size.
 */
function layoutScope(items: CoOcc[]) {
  const nodes: ScopeNode[] = [];
  const sectors: Sector[] = [];
  if (items.length === 0) return { nodes, sectors };

  const max = Math.max(...items.map(i => i.companies), 1);
  const groups = new Map<string, CoOcc[]>();
  for (const item of items) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

  let cursor = 0;
  ordered.forEach(([category, list], gi) => {
    const span = (360 * list.length) / items.length;
    const color = CATEGORY_COLORS[gi % CATEGORY_COLORS.length];
    sectors.push({ category, start: cursor, end: cursor + span, color });

    [...list]
      .sort((a, b) => b.companies - a.companies)
      .forEach((item, i) => {
        const angle = cursor + (span * (i + 0.5)) / list.length;
        const ratio = item.companies / max;
        nodes.push({
          ...item,
          angle,
          r: R_MIN + (1 - ratio) * (R_MAX - R_MIN),
          size: 5 + 10 * Math.sqrt(ratio),
          color,
          delay: (angle / 360) * SWEEP_S,
        });
      });
    cursor += span;
  });

  return { nodes, sectors };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const pretty = (s: string) => s.replace(/_/g, " ");

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function exportCsv(tech: string, rows: Company[]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const body = [
    ["domain", "confidence", "matched_on"],
    ...rows.map(r => [r.domain, r.confidence, r.matched_on]),
  ]
    .map(r => r.map(esc).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tech.toLowerCase().replace(/\s+/g, "-")}-companies.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trending, setTrending] = useState<Trending[]>([]);
  const [query, setQuery] = useState("Cloudflare");
  const [activeTech, setActiveTech] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [coOcc, setCoOcc] = useState<CoOcc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minConf, setMinConf] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  const [hovered, setHovered] = useState<string | null>(null);

  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(async (raw: string) => {
    const tech = raw.trim();
    if (!tech) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setQuery(tech);
    try {
      const [cRes, coRes] = await Promise.all([
        fetchJson<{ companies: Company[] }>(`${API}/companies?technology=${encodeURIComponent(tech)}`),
        fetchJson<{ co_occurring: CoOcc[] }>(`${API}/technologies/co-occurring?with=${encodeURIComponent(tech)}`),
      ]);
      if (id !== reqId.current) return; // a newer search won
      setCompanies(cRes.companies ?? []);
      setCoOcc(coRes.co_occurring ?? []);
      setActiveTech(tech);
      setVisible(PAGE);
      setHovered(null);
    } catch {
      if (id !== reqId.current) return;
      setError(`Can't reach the API at ${API}. Start the FastAPI server and try again.`);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJson<Stats>(`${API}/stats`).then(setStats).catch(() => {});
    fetchJson<{ trending: Trending[] }>(`${API}/technologies/trending`)
      .then(d => setTrending(d.trending ?? []))
      .catch(() => {});
    runSearch("Cloudflare");
  }, [runSearch]);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(
    () => companies.filter(c => c.confidence >= minConf).sort((a, b) => b.confidence - a.confidence),
    [companies, minConf]
  );

  const { nodes, sectors } = useMemo(() => layoutScope(coOcc.slice(0, 24)), [coOcc]);

  const topNames = useMemo(
    () => [...coOcc].sort((a, b) => b.companies - a.companies).slice(0, 3).map(c => c.name),
    [coOcc]
  );
  const labeled = useMemo(
    () => new Set([...nodes].sort((a, b) => b.companies - a.companies).slice(0, 6).map(n => n.name)),
    [nodes]
  );
  const drawOrder = hovered
    ? [...nodes.filter(n => n.name !== hovered), ...nodes.filter(n => n.name === hovered)]
    : nodes;

  const n = companies.length;

  return (
    <div className="min-h-screen bg-chart text-ink">
      {/* ------------------------------ Header ------------------------------ */}
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
              <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity=".45" />
              <path d="M16 16 L26 9" stroke="#2341E8" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="16" cy="16" r="2.5" fill="#2341E8" />
            </svg>
            <span className="font-display text-lg font-semibold tracking-tight">TechStack Radar</span>
          </div>

          <div className="flex items-center gap-8 text-sm">
            <dl className="hidden items-center gap-6 md:flex">
              <Stat value={stats?.companies} label="companies" />
              <Stat value={stats?.technologies} label="technologies" />
              <Stat value={stats?.detections} label="detections" />
            </dl>
            <a
              href={`${API}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-ink/30 underline-offset-4 hover:decoration-signal hover:text-signal"
            >
              API docs
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-16 pt-10">
        {/* ------------------------------ Search ------------------------------ */}
        <form
          onSubmit={e => {
            e.preventDefault();
            runSearch(query);
          }}
          className="flex items-end gap-4"
        >
          <div className="relative flex-1">
            <label htmlFor="tech" className="text-sm text-ink/60">
              Find companies by technology
            </label>
            <input
              id="tech"
              ref={inputRef}
              list="tech-options"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Shopify, HubSpot, Stripe"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full border-0 border-b-2 border-ink bg-transparent py-2 pr-10 font-display text-3xl font-semibold placeholder:text-ink/25 focus:border-signal focus:outline-none sm:text-4xl"
            />
            <kbd className="pointer-events-none absolute bottom-3 right-0 hidden rounded-sm border border-ink/20 px-1.5 text-xs text-ink/50 sm:block">
              /
            </kbd>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-sm bg-ink px-6 text-sm font-medium text-chart transition-colors hover:bg-signal disabled:opacity-50"
          >
            {loading ? "Searching" : "Search"}
          </button>
        </form>
        <datalist id="tech-options">
          {trending.map(t => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>

        <nav aria-label="Trending technologies" className="mt-5 flex items-center gap-x-5 overflow-x-auto pb-1">
          <span className="shrink-0 text-sm text-ink/60">Trending</span>
          {trending.map(t => {
            const active = activeTech?.toLowerCase() === t.name.toLowerCase();
            return (
              <button
                key={t.name}
                onClick={() => runSearch(t.name)}
                className={`shrink-0 border-b-2 pb-0.5 text-sm transition-colors ${
                  active ? "border-signal font-medium text-ink" : "border-transparent text-ink/70 hover:text-ink"
                }`}
              >
                {t.name} <span className="tabular-nums text-ink/45">{t.companies}</span>
              </button>
            );
          })}
        </nav>

        {error && (
          <div role="alert" className="mt-8 flex items-center justify-between gap-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900">
            <span>{error}</span>
            <button onClick={() => runSearch(query)} className="shrink-0 font-medium underline underline-offset-4">
              Retry
            </button>
          </div>
        )}

        {/* ------------------------------ Headline ------------------------------ */}
        <section className="mt-12" aria-live="polite">
          {activeTech === null ? (
            <div className="h-16 w-2/3 animate-pulse rounded-sm bg-ink/10" />
          ) : (
            <>
              <h1 className="max-w-4xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                {n === 0
                  ? `No companies found for ${activeTech}`
                  : `${n.toLocaleString()} ${n === 1 ? "company runs" : "companies run"} ${activeTech}`}
              </h1>
              <p className="mt-3 max-w-xl text-lg text-ink/70">
                {n === 0
                  ? "Check the spelling, or pick a trending technology above."
                  : topNames.length > 0
                  ? `Most often alongside ${joinNames(topNames)}.`
                  : "No overlap data for this technology yet."}
              </p>
            </>
          )}
        </section>

        {/* ------------------------------ Scope + table ------------------------------ */}
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Scope */}
          <section
            aria-label="Technology overlap"
            className={`self-start rounded-md bg-scope p-5 text-white transition-opacity sm:p-6 lg:sticky lg:top-6 ${
              loading ? "opacity-60" : "opacity-100"
            }`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg font-semibold">Runs alongside</h2>
              <span className="text-xs text-white/50">{nodes.length} technologies</span>
            </div>

            {nodes.length === 0 ? (
              <p className="py-16 text-center text-sm text-white/55">No overlap data for this technology yet.</p>
            ) : (
              <>
                <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mt-2 h-auto w-full" aria-hidden="true">
                  {/* rings */}
                  {[R_MIN, R_MIN + (R_MAX - R_MIN) / 3, R_MIN + (2 * (R_MAX - R_MIN)) / 3, R_MAX].map(r => (
                    <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="#22384A" strokeWidth={1} />
                  ))}
                  <circle cx={C} cy={C} r={R_EDGE} fill="none" stroke="#2E4A60" strokeWidth={1.5} />
                  <line x1={C} y1={C - R_EDGE} x2={C} y2={C + R_EDGE} stroke="#22384A" strokeWidth={1} />
                  <line x1={C - R_EDGE} y1={C} x2={C + R_EDGE} y2={C} stroke="#22384A" strokeWidth={1} />

                  {/* category wedges */}
                  {sectors.length > 1 &&
                    sectors.map(s => {
                      const p = polar(s.start, R_EDGE);
                      return <line key={`d-${s.category}`} x1={C} y1={C} x2={p.x} y2={p.y} stroke="#2E4A60" strokeWidth={1} />;
                    })}
                  {sectors.map(s => {
                    const mid = (s.start + s.end) / 2;
                    const p = polar(mid, R_EDGE + 16);
                    const sin = Math.sin((mid * Math.PI) / 180);
                    return (
                      <text
                        key={`l-${s.category}`}
                        x={p.x}
                        y={p.y}
                        fill={s.color}
                        fontSize={13}
                        fontWeight={500}
                        textAnchor={sin > 0.25 ? "start" : sin < -0.25 ? "end" : "middle"}
                        dominantBaseline="middle"
                      >
                        {pretty(s.category)}
                      </text>
                    );
                  })}

                  {/* one sweep per search */}
                  <g key={`sweep-${activeTech}`} className="scope-sweep" style={{ animationDuration: `${SWEEP_S}s` }}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <path key={i} d={wedgePath(-(i + 1) * 5, -i * 5, R_EDGE)} fill="#FFB454" fillOpacity={0.16 * (1 - i / 8)} />
                    ))}
                    <line x1={C} y1={C} x2={C} y2={C - R_EDGE} stroke="#FFB454" strokeOpacity={0.7} strokeWidth={1.5} />
                  </g>

                  {/* spoke to hovered node */}
                  {hovered &&
                    nodes
                      .filter(nd => nd.name === hovered)
                      .map(nd => {
                        const p = polar(nd.angle, nd.r);
                        return <line key="spoke" x1={C} y1={C} x2={p.x} y2={p.y} stroke={nd.color} strokeOpacity={0.55} strokeWidth={1.5} />;
                      })}

                  {/* nodes */}
                  <g key={`nodes-${activeTech}`}>
                    {drawOrder.map(nd => {
                      const p = polar(nd.angle, nd.r);
                      const isHover = hovered === nd.name;
                      const showLabel = isHover || labeled.has(nd.name);
                      const right = p.x >= C;
                      return (
                        <g
                          key={nd.name}
                          transform={`translate(${p.x} ${p.y})`}
                          className="cursor-pointer"
                          onMouseEnter={() => setHovered(nd.name)}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => runSearch(nd.name)}
                        >
                          <g className="scope-blip" style={{ animationDelay: `${nd.delay}s` }}>
                            <circle r={nd.size + 9} fill="transparent" />
                            <circle
                              r={nd.size}
                              fill={nd.color}
                              fillOpacity={isHover ? 1 : 0.85}
                              stroke={isHover ? "#fff" : "none"}
                              strokeWidth={2}
                            />
                            {showLabel && (
                              <text
                                x={right ? nd.size + 7 : -(nd.size + 7)}
                                y={4}
                                fontSize={13}
                                fontWeight={isHover ? 600 : 500}
                                fill="#fff"
                                textAnchor={right ? "start" : "end"}
                                paintOrder="stroke"
                                stroke="#0C1620"
                                strokeWidth={4}
                                strokeLinejoin="round"
                              >
                                {nd.name}
                                {isHover && <tspan fillOpacity={0.6}>{`  ${nd.companies}`}</tspan>}
                              </text>
                            )}
                          </g>
                        </g>
                      );
                    })}
                  </g>

                  {/* center */}
                  <circle cx={C} cy={C} r={16} fill="none" stroke="#FFB454" strokeOpacity={0.5} strokeWidth={1.5} />
                  <circle cx={C} cy={C} r={7} fill="#FFB454" />
                  <text
                    x={C}
                    y={C + 38}
                    fontSize={15}
                    fontWeight={600}
                    fill="#fff"
                    textAnchor="middle"
                    paintOrder="stroke"
                    stroke="#0C1620"
                    strokeWidth={4}
                    strokeLinejoin="round"
                  >
                    {activeTech}
                  </text>
                </svg>

                <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/55">
                  Closer to the center means more shared companies. Larger dots mean more companies. Each wedge is a category.
                </p>

                <ul className="mt-5 max-h-72 divide-y divide-white/10 overflow-y-auto border-t border-white/10">
                  {[...nodes]
                    .sort((a, b) => b.companies - a.companies)
                    .map(nd => (
                      <li key={nd.name}>
                        <button
                          onClick={() => runSearch(nd.name)}
                          onMouseEnter={() => setHovered(nd.name)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(nd.name)}
                          onBlur={() => setHovered(null)}
                          className={`flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ping ${
                            hovered === nd.name ? "bg-white/5" : ""
                          }`}
                        >
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nd.color }} />
                          <span className="flex-1 text-sm font-medium">{nd.name}</span>
                          <span className="text-xs capitalize text-white/50">{pretty(nd.category)}</span>
                          <span className="w-10 text-right text-sm tabular-nums">{nd.companies}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>

          {/* Companies */}
          <section aria-label="Companies" className={`transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-3">
              <h2 className="font-display text-lg font-semibold">
                Companies
                <span className="ml-2 text-sm font-normal tabular-nums text-ink/55">
                  {shown.length.toLocaleString()} shown
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <div role="radiogroup" aria-label="Minimum confidence" className="inline-flex rounded-sm border border-ink/20">
                  {FILTERS.map(f => (
                    <button
                      key={f.label}
                      role="radio"
                      aria-checked={minConf === f.min}
                      onClick={() => {
                        setMinConf(f.min);
                        setVisible(PAGE);
                      }}
                      className={`px-3 py-1.5 text-sm transition-colors ${
                        minConf === f.min ? "bg-ink text-chart" : "text-ink/70 hover:text-ink"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => activeTech && exportCsv(activeTech, shown)}
                  disabled={shown.length === 0}
                  className="rounded-sm border border-ink/20 px-3 py-1.5 text-sm font-medium transition-colors hover:border-signal hover:text-signal disabled:opacity-40"
                >
                  Export CSV
                </button>
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="py-14 text-sm text-ink/55">
                {activeTech === null
                  ? "Loading companies."
                  : n === 0
                  ? "Nothing to list yet. Search another technology."
                  : `No companies at this confidence level. Choose All to see ${n.toLocaleString()}.`}
              </p>
            ) : (
              <>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-ink/55">
                      <th className="py-3 pr-4 font-normal">Domain</th>
                      <th className="py-3 pr-4 font-normal">Confidence</th>
                      <th className="hidden py-3 font-normal sm:table-cell">Detected from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, visible).map(c => {
                      const pct = Math.round(c.confidence * 100);
                      const tone = c.confidence >= 0.85 ? "#2341E8" : c.confidence >= 0.65 ? "#7A8DF0" : "#A7B0BD";
                      return (
                        <tr key={c.domain} className="border-t border-ink/10">
                          <td className="py-3 pr-4">
                            <a
                              href={`https://${c.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium underline-offset-4 hover:text-signal hover:underline"
                            >
                              {c.domain}
                            </a>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-3">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10 sm:w-28">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
                              </div>
                              <span className="w-10 text-sm tabular-nums">{pct}%</span>
                            </div>
                          </td>
                          <td className="hidden max-w-[16rem] truncate py-3 text-sm text-ink/60 sm:table-cell" title={c.matched_on}>
                            {c.matched_on}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {visible < shown.length && (
                  <button
                    onClick={() => setVisible(v => v + PAGE)}
                    className="mt-4 w-full border-t border-ink/10 py-4 text-sm font-medium text-ink/70 hover:text-signal"
                  >
                    Show {Math.min(PAGE, shown.length - visible)} more
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="mt-20 border-t border-ink/10 pt-6 text-sm text-ink/55">
          A scoped-down MixRank-style data product: crawl, detect, structure, query. Built with Python, PostgreSQL,
          FastAPI and Next.js.
        </footer>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value?: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="order-first font-display font-semibold tabular-nums">
        {value === undefined ? "–" : value.toLocaleString()}
      </dd>
      <dt className="text-ink/55">{label}</dt>
    </div>
  );
}