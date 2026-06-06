import { type ReactNode, useEffect, useState } from "react";
import { exportWiki, fetchWiki, type WikiPage } from "./api.js";

/** Inline markdown: **bold**, `code`, [text](url). Links to ./*.md navigate in-app. */
function inline(text: string, go: (slug: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex walk
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={k++}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={k++}>{m[2]}</code>);
    else if (m[3] && m[4]) {
      const href = m[4];
      const md = href.match(/^\.\/(.+)\.md$/);
      if (md) {
        const slug = md[1];
        out.push(
          <a key={k++} className="wlink" onClick={() => go(slug)}>
            {m[3]}
          </a>,
        );
      } else {
        out.push(
          <a key={k++} href={href} target="_blank" rel="noreferrer">
            {m[3]}
          </a>,
        );
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(md: string, go: (slug: string) => void): ReactNode[] {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  let list: ReactNode[] | null = null;
  const flushList = () => {
    if (list) {
      blocks.push(<ul key={key++}>{list}</ul>);
      list = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) buf.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      blocks.push(<h1 key={key++}>{inline(line.slice(2), go)}</h1>);
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={key++}>{inline(line.slice(3), go)}</h2>);
    } else if (line.startsWith("- ")) {
      if (!list) list = [];
      list.push(<li key={key++}>{inline(line.slice(2), go)}</li>);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++}>{inline(line, go)}</p>);
    }
    i++;
  }
  flushList();
  return blocks;
}

export function Wiki({ repoId }: { repoId: string }) {
  const [index, setIndex] = useState("");
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [current, setCurrent] = useState<string>("index"); // "index" or a slug
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchWiki(repoId)
      .then((w) => {
        setIndex(w.index);
        setPages(w.pages);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [repoId]);

  const go = (slug: string) => setCurrent(slug);
  const md = current === "index" ? index : (pages.find((p) => p.slug === current)?.markdown ?? index);

  const onExport = async () => {
    try {
      const r = await exportWiki(repoId);
      setExported(`${r.files} files → ${r.dir}`);
    } catch (e) {
      setExported(`export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  if (loading)
    return (
      <div className="wiki">
        <div className="hint">Generating wiki…</div>
      </div>
    );
  if (error)
    return (
      <div className="wiki">
        <div className="error">{error}</div>
      </div>
    );

  return (
    <div className="wiki">
      <div className="wiki-toolbar">
        {current !== "index" && (
          <button className="ghostbtn" onClick={() => setCurrent("index")}>
            ← Index
          </button>
        )}
        <span className="hint">{pages.length} pages</span>
        <button onClick={onExport}>Export markdown</button>
        {exported && <span className="hint">{exported}</span>}
      </div>
      <article className="wiki-page">{renderMarkdown(md, go)}</article>
    </div>
  );
}
