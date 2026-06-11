import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  connectRepo,
  fetchGraph,
  fetchMastery,
  fetchNext,
  fetchPath,
  fetchReviews,
  fetchSource,
  type GraphNode,
  type KnowledgeGraph,
  type MasteryUnit,
  type PathUnit,
  type Recommendation,
  type RepoSummary,
  type ReviewItem,
  type SourceSlice,
} from "./api.js";
import { ModelSettings } from "./ModelSettings.js";
import { Practice } from "./Practice.js";
import { Tour } from "./Tour.js";
import { Tutor } from "./Tutor.js";
import { Wiki } from "./Wiki.js";

const USER = "demo";
const KIND_COLOR: Record<string, string> = {
  file: "#6e7681",
  class: "#d29922",
  function: "#58a6ff",
  unit: "#3fb950",
};
const BLOOM = ["None", "Remember", "Understand", "Apply", "Analyze", "Create"];
const BLOOM_COLOR = ["#30363d", "#6e7681", "#58a6ff", "#3fb950", "#a371f7", "#f778ba"];
// Layer palette: foundational (deep) → interface (bright).
const LAYER_COLOR = ["#1f6feb", "#388bfd", "#a371f7", "#db61a2", "#f0883e", "#3fb950"];
const layerColor = (l: number) => LAYER_COLOR[Math.min(l, LAYER_COLOR.length - 1)] ?? "#58a6ff";

interface FGNode {
  id: string;
  name: string;
  kind: string;
  val: number;
  color: string;
  node: GraphNode;
}

export function App() {
  const [path, setPath] = useState("");
  const [view, setView] = useState<"graph" | "learn" | "layers" | "wiki" | "tutor">("graph");
  const [colorMode, setColorMode] = useState<"kind" | "layer">("kind");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [units, setUnits] = useState<PathUnit[]>([]);
  const [mastery, setMastery] = useState<Map<string, MasteryUnit>>(new Map());
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [source, setSource] = useState<SourceSlice | null>(null);
  const [practiceUnit, setPracticeUnit] = useState<PathUnit | null>(null);
  const [touring, setTouring] = useState(false);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [next, setNext] = useState<Recommendation[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const graphRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph, view]);

  const refreshMastery = useCallback(async (id: string) => {
    const [m, r, n] = await Promise.all([
      fetchMastery(id, USER),
      fetchReviews(id, USER),
      fetchNext(id, USER),
    ]);
    setMastery(new Map(m.units.map((u) => [u.unitId, u])));
    setReviews(r.due);
    setNext(n.recommendations);
  }, []);

  const onConnect = useCallback(async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setSource(null);
    setPracticeUnit(null);
    try {
      const r = await connectRepo(path.trim());
      setRepo(r);
      const [g, p] = await Promise.all([fetchGraph(r.id), fetchPath(r.id)]);
      setGraph(g);
      setUnits(p.units);
      await refreshMastery(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [path, refreshMastery]);

  const onNodeClick = useCallback(
    async (n: FGNode) => {
      if (!repo) return;
      setSelected(n.node);
      setSource(null);
      try {
        setSource(await fetchSource(repo.id, n.node.id));
      } catch {
        /* file nodes / unreadable */
      }
    },
    [repo],
  );

  const fgData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const ids = new Set(graph.nodes.map((n) => n.id));
    const nodes: FGNode[] = graph.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      val: n.kind === "file" ? 6 : n.kind === "class" ? 4 : 2,
      color:
        colorMode === "layer" && n.layer !== undefined ? layerColor(n.layer) : (KIND_COLOR[n.kind] ?? "#888"),
      node: n,
    }));
    const links = graph.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, type: e.type }));
    return { nodes, links };
  }, [graph, colorMode]);

  // Units grouped into architectural bands (foundation first).
  const bands = useMemo(() => {
    const m = new Map<string, { band: string; layer: number; units: PathUnit[] }>();
    for (const u of units) {
      const key = u.band ?? "Core";
      if (!m.has(key)) m.set(key, { band: key, layer: u.layer ?? 0, units: [] });
      m.get(key)!.units.push(u);
    }
    return [...m.values()].sort((a, b) => a.layer - b.layer);
  }, [units]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Master<span>-Anything</span>
        </div>
        <div className="tagline">Master anything, verifiably. · P0 MVP</div>
        <button className="modelbtn" onClick={() => setShowSettings(true)}>
          ⚙ Model settings
        </button>

        <div className="field">
          <input
            type="text"
            placeholder="absolute repo path…"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConnect()}
          />
          <button onClick={onConnect} disabled={loading}>
            {loading ? "…" : "Map"}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        {!repo && !error && (
          <div className="hint">
            Enter a local repo path to build its graph. Try the bundled <code>examples/py-calc</code> to see
            the verifiable-mastery loop.
          </div>
        )}

        {repo && (
          <>
            <div className="hint" style={{ margin: "8px 0" }}>
              domain: <b style={{ color: "var(--accent)" }}>{repo.kind}</b>
            </div>
            <div className="stats">
              <div className="stat">
                <b>{repo.stats.files}</b>
                <span>files</span>
              </div>
              <div className="stat">
                <b>{repo.stats.nodes}</b>
                <span>nodes</span>
              </div>
              <div className="stat">
                <b>{units.length}</b>
                <span>units</span>
              </div>
            </div>

            <div className="tabs">
              <button className={view === "graph" ? "tab on" : "tab"} onClick={() => setView("graph")}>
                Graph
              </button>
              <button className={view === "learn" ? "tab on" : "tab"} onClick={() => setView("learn")}>
                Learn
                {reviews.length > 0 && <span className="tab-badge">{reviews.length}</span>}
              </button>
              <button className={view === "layers" ? "tab on" : "tab"} onClick={() => setView("layers")}>
                Layers
              </button>
              <button className={view === "wiki" ? "tab on" : "tab"} onClick={() => setView("wiki")}>
                Wiki
              </button>
              <button className={view === "tutor" ? "tab on" : "tab"} onClick={() => setView("tutor")}>
                Tutor
              </button>
            </div>

            {view === "graph" && (
              <>
                <div className="seg">
                  <button className={colorMode === "kind" ? "on" : ""} onClick={() => setColorMode("kind")}>
                    by kind
                  </button>
                  <button className={colorMode === "layer" ? "on" : ""} onClick={() => setColorMode("layer")}>
                    by layer
                  </button>
                </div>
                <div className="legend">
                  {colorMode === "kind"
                    ? Object.entries(KIND_COLOR).map(([k, c]) => (
                        <div key={k}>
                          <span className="dot" style={{ background: c }} /> {k}
                        </div>
                      ))
                    : bands.map((b) => (
                        <div key={b.band}>
                          <span className="dot" style={{ background: layerColor(b.layer) }} /> {b.band}
                        </div>
                      ))}
                </div>
              </>
            )}

            {view === "layers" && (
              <div className="path-list">
                <div className="hint" style={{ marginBottom: 8 }}>
                  Architectural layers — foundation first. Click a unit to practice.
                </div>
                {bands.map((b) => (
                  <div key={b.band} className="band-group">
                    <div className="band-head">
                      <span className="dot" style={{ background: layerColor(b.layer) }} /> {b.band}
                      <span className="band-count">{b.units.length}</span>
                    </div>
                    {b.units.map((u) => {
                      const lvl = mastery.get(u.id)?.level ?? 0;
                      return (
                        <button key={u.id} className="unit-row" onClick={() => setPracticeUnit(u)}>
                          <span className="unit-main">
                            <span className="unit-title">{u.title}</span>
                            <span className="unit-sub">{u.module ?? u.kind}</span>
                          </span>
                          <span
                            className="lvl"
                            style={{ background: BLOOM_COLOR[lvl], color: lvl ? "#0d1117" : "#8b949e" }}
                          >
                            {BLOOM[lvl]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {view === "learn" && (
              <div className="path-list">
                {next.filter((r) => r.kind === "learn").length > 0 && (
                  <div className="nextup">
                    <div className="nextup-head">◎ Next up · adaptive</div>
                    {next
                      .filter((r) => r.kind === "learn")
                      .slice(0, 3)
                      .map((r) => {
                        const u = units.find((x) => x.id === r.unitId);
                        return (
                          <button
                            key={r.unitId}
                            className="unit-row next-row"
                            onClick={() => u && setPracticeUnit(u)}
                          >
                            <span className="unit-main">
                              <span className="unit-title">{r.title}</span>
                              <span className="unit-sub">{r.reason}</span>
                              <span className="belief-bar" title={`belief ${Math.round(r.belief * 100)}%`}>
                                <span
                                  className="belief-fill"
                                  style={{ width: `${Math.round(r.belief * 100)}%` }}
                                />
                              </span>
                            </span>
                            <span className="lvl next">go</span>
                          </button>
                        );
                      })}
                  </div>
                )}
                {reviews.length > 0 && (
                  <div className="reviews">
                    <div className="reviews-head">↻ Due for review · {reviews.length}</div>
                    {reviews.map((rv) => {
                      const u = units.find((x) => x.id === rv.unitId);
                      return (
                        <button
                          key={rv.unitId}
                          className="unit-row review-row"
                          onClick={() => u && setPracticeUnit(u)}
                        >
                          <span className="unit-main">
                            <span className="unit-title">{rv.title}</span>
                            <span className="unit-sub">retain {BLOOM[rv.level]} — re-practice</span>
                          </span>
                          <span className="lvl due">due</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button className="tourbtn" onClick={() => setTouring(true)}>
                  ▶ Start guided tour
                </button>
                <div className="hint" style={{ margin: "8px 0" }}>
                  Learning path — prerequisites first. Click a unit to practice.
                </div>
                {units.map((u, i) => {
                  const m = mastery.get(u.id);
                  const lvl = m?.level ?? 0;
                  const belief = m?.belief ?? 0;
                  return (
                    <button key={u.id} className="unit-row" onClick={() => setPracticeUnit(u)}>
                      <span className="idx">{i + 1}</span>
                      <span className="unit-main">
                        <span className="unit-title">{u.title}</span>
                        <span className="unit-sub">{u.summary}</span>
                        <span className="belief-bar" title={`belief ${Math.round(belief * 100)}%`}>
                          <span className="belief-fill" style={{ width: `${Math.round(belief * 100)}%` }} />
                        </span>
                      </span>
                      <span
                        className="lvl"
                        style={{ background: BLOOM_COLOR[lvl], color: lvl ? "#0d1117" : "#8b949e" }}
                      >
                        {BLOOM[lvl]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </aside>

      <main className="graph" ref={graphRef}>
        {graph && view === "graph" && (
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={fgData}
            backgroundColor="#0e1116"
            nodeId="id"
            nodeVal="val"
            nodeColor="color"
            nodeLabel={(n) => `${(n as FGNode).kind}: ${(n as FGNode).name}`}
            linkColor={(l) => ((l as { type: string }).type === "calls" ? "#58a6ff66" : "#2a313c")}
            onNodeClick={(n) => onNodeClick(n as FGNode)}
            cooldownTicks={120}
          />
        )}

        {view === "tutor" && repo && <Tutor repoId={repo.id} />}

        {view === "wiki" && repo && <Wiki repoId={repo.id} />}

        {touring && repo && <Tour repoId={repo.id} onClose={() => setTouring(false)} />}

        {showSettings && <ModelSettings onClose={() => setShowSettings(false)} />}

        {view === "learn" && !practiceUnit && (
          <div className="learn-hello">
            <h2>Pick a unit on the left to practice.</h2>
            <p>
              We'll blank a real function, you reimplement it, and the project's actual test suite decides
              whether you've mastered it.
            </p>
          </div>
        )}

        {view === "layers" && !practiceUnit && (
          <div className="learn-hello">
            <h2>Architectural layers</h2>
            <p>
              Units ranked by dependency depth — <b>Foundation</b> at the bottom, <b>Interface</b> at the top.
              Switch the Graph to <b>color by layer</b> to see the same structure visually.
            </p>
          </div>
        )}

        {selected && view === "graph" && (
          <div className="detail">
            <button className="close" onClick={() => setSelected(null)}>
              ×
            </button>
            <h3>{selected.name}</h3>
            <div className="path">
              {selected.provenance.path}:{selected.provenance.startLine}-{selected.provenance.endLine}
            </div>
            <div>
              <span className="badge">{selected.kind}</span>
              <span className="badge">ceiling: {BLOOM[selected.bloomCeiling] ?? selected.bloomCeiling}</span>
            </div>
            {selected.signature && <pre style={{ marginTop: 10 }}>{selected.signature}</pre>}
            {source && <pre>{source.code}</pre>}
          </div>
        )}

        {practiceUnit && repo && (
          <Practice
            repoId={repo.id}
            unit={practiceUnit}
            userId={USER}
            onClose={() => setPracticeUnit(null)}
            onMastered={() => refreshMastery(repo.id)}
          />
        )}
      </main>
    </div>
  );
}
