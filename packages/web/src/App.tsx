import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  type GraphNode,
  type KnowledgeGraph,
  type RepoSummary,
  type SourceSlice,
  connectRepo,
  fetchGraph,
  fetchSource,
} from "./api.js";

const KIND_COLOR: Record<string, string> = {
  file: "#6e7681",
  class: "#d29922",
  function: "#58a6ff",
  unit: "#3fb950",
};
const BLOOM = ["None", "Remember", "Understand", "Apply", "Analyze", "Create"];

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [source, setSource] = useState<SourceSlice | null>(null);

  const graphRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph]);

  const onConnect = useCallback(async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setSource(null);
    try {
      const r = await connectRepo(path.trim());
      setRepo(r);
      setGraph(await fetchGraph(r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  const onNodeClick = useCallback(
    async (n: FGNode) => {
      if (!repo) return;
      setSelected(n.node);
      setSource(null);
      try {
        setSource(await fetchSource(repo.id, n.node.id));
      } catch {
        /* file nodes / unreadable: leave source empty */
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
      color: KIND_COLOR[n.kind] ?? "#888",
      node: n,
    }));
    const links = graph.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, type: e.type }));
    return { nodes, links };
  }, [graph]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Master<span>-Anything</span>
        </div>
        <div className="tagline">Master anything, verifiably. · P0.0</div>

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
            Enter a local repo path on the server host to build its knowledge graph.
          </div>
        )}

        {repo && (
          <>
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
                <b>{repo.stats.edges}</b>
                <span>edges</span>
              </div>
            </div>
            <div className="hint">
              {Object.entries(repo.stats.languages)
                .map(([l, n]) => `${l}: ${n}`)
                .join(" · ")}
            </div>
          </>
        )}

        <div className="legend">
          {Object.entries(KIND_COLOR).map(([k, c]) => (
            <div key={k}>
              <span className="dot" style={{ background: c }} /> {k}
            </div>
          ))}
        </div>
      </aside>

      <main className="graph" ref={graphRef}>
        {graph && (
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
            linkDirectionalParticles={0}
            onNodeClick={(n) => onNodeClick(n as FGNode)}
            cooldownTicks={120}
          />
        )}

        {selected && (
          <div className="detail">
            <button className="close" onClick={() => setSelected(null)}>
              ×
            </button>
            <h3>{selected.name}</h3>
            <div className="path">
              {selected.provenance.path}:{selected.provenance.startLine}-
              {selected.provenance.endLine}
            </div>
            <div>
              <span className="badge">{selected.kind}</span>
              <span className="badge">ceiling: {BLOOM[selected.bloomCeiling] ?? selected.bloomCeiling}</span>
            </div>
            {selected.signature && (
              <pre style={{ marginTop: 10 }}>{selected.signature}</pre>
            )}
            {source && <pre>{source.code}</pre>}
          </div>
        )}
      </main>
    </div>
  );
}
