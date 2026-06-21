# master-anything

> Learn any codebase to **mastery** — not just read it. One local app, one command.

```bash
npx master-anything
# or point it straight at a repo:
npx master-anything /path/to/repo
```

This boots the full [Master-Anything](https://github.com/everettjf/Master-Anything)
app — the **knowledge graph**, the **GraphRAG tutor**, and the **verifiable
mastery loop** (Understand → Apply → Analyze → Create, checked by *real tests*
and *graph truth*) — on a single local port, and opens your browser.

No build step, no two terminals: the API and the web UI are served together.

## Usage

```
npx master-anything [path] [options]

Arguments:
  path              a repo/folder to pre-connect (optional)

Options:
  -p, --port <n>    port to listen on        (default 8787, or $PORT)
      --no-open     do not open the browser
  -h, --help        show help
```

## Optional: an LLM backend

Works out of the box with heuristic summaries. Set a provider key to enable
LLM enrichment and the tutor — it auto-detects:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx master-anything
# OPENAI_API_KEY, GROQ_API_KEY, … also work; see the repo's .env.example
```

## Requirements

- **Node ≥ 20**
- **`python3`** on `PATH` — only if you want verifiable **Apply** on Python repos
  (it runs the project's real `pytest`). JS/TS use Node's test runner.

Data (your mastery + cached graphs) lives in `./.ma-data` by default
(`MA_DATA_DIR` to change).

## How it's packaged

A single esbuild bundle (`@ma/server` + `@ma/core` + `@ma/verifier` inlined)
plus the prebuilt web UI. The only native dependencies — `better-sqlite3` and
the `tree-sitter` grammars — install as prebuilt binaries on first run.

MIT · part of [Master-Anything](https://github.com/everettjf/Master-Anything).
