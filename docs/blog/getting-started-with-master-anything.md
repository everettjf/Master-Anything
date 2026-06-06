# Don't just *understand* your codebase — *master* it, verifiably

> A walkthrough of [Master-Anything](https://github.com/everettjf/Master-Anything): an open-source tool that turns any
> codebase (or docs, web pages, PDFs) into a knowledge graph, then **proves** you've mastered it with real tests and
> graph ground-truth — not an LLM's opinion.

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

A whole category of tools now promises to help you "understand" a codebase: point them at a repo and they render a
pretty map — a call graph, an architecture diagram, an auto-generated wiki. That's genuinely useful. But if you've ever
read all the docs, nodded along to the diagram, and *still* couldn't confidently change the code… you know the gap.

**Understanding is a one-time snapshot. Mastery is a state you reach, prove, and retain.** Master-Anything is built for
that second thing. Here's how it works and how to use it.

## The idea in one sentence

A domain is just an *input*. Once you turn it into a **knowledge graph**, "how do I make a person actually master
this?" becomes the same engine — regardless of whether the input is Python, a README, or a PDF.

So Master-Anything has two layers:

1. **Domain adapters** turn an input into a universal knowledge graph (Tree-sitter for code; heading/page splitting for
   docs/PDF).
2. A **mastery engine** sits on top and drives *your* skill up Bloom's ladder — **Understand → Apply → Analyze →
   Create** — with an objective check at each rung.

The headline feature is that those checks are *real*, not vibes.

## A 5-minute tour

It's a pnpm + TypeScript monorepo. You need Node ≥ 22 and (for Python exercises) `pytest`.

```bash
git clone https://github.com/everettjf/Master-Anything.git
cd Master-Anything
pnpm install
python3 -m pip install pytest          # for Python Apply/Create tasks

pnpm --filter @ma/server dev           # API  → http://localhost:8787
pnpm --filter @ma/web dev              # web  → http://localhost:5173
```

Open the web app, paste an **absolute repo path**, and hit *Map*. To see everything at once, use a bundled example like
`examples/mixed-app` (code + docs) or `examples/py-calc` (pure Python). You'll land on a knowledge graph with five tabs:
**Graph · Learn · Layers · Wiki · Tutor**.

### Climb the ladder (the core loop)

Open the **Learn** tab and click a unit — say, the `Calculator` class. You get four challenges:

![The Apply loop](https://everettjf.github.io/Master-Anything/assets/demo.gif)

- **Understand** — the tutor asks a comprehension question; an LLM grades your answer *against the source*.
- **Apply** — the body of a real function is blanked out. You reimplement it, hit **Run tests**, and the project's
  **actual test suite** decides whether you pass. Get it right and you're promoted to *Apply*. This is the moment that
  separates "I think I get it" from "I can provably do it."
- **Analyze** — "If you change `Calculator`, which units are affected?" Your answer is graded against the real
  **call/dependency graph** — objective truth, computed from the code.
- **Create** — add a *new* capability (e.g. a `mul` method) **and a test for it**. The whole suite must stay green with
  strictly more passing tests than before. You don't just reproduce existing code; you extend it and prove it works.

Every promotion above *Understand* is backed by an objective check — real test execution or graph ground-truth. No
"great job!" from a model that never ran your code.

And because mastery should *last*, units you've mastered resurface on a **spaced-repetition** schedule. Fail a review
and your level drops a rung — forgetting is modeled, so "mastered" means *retained*.

## It works on more than code

Point it at a folder of Markdown, HTML, or PDFs and the same engine kicks in — each section (or PDF page) becomes a
learning unit with Understand and graph-verified Analyze challenges.

The fun part is **mixed repos**: a project with code *and* a README gets merged into one graph, and Master-Anything
draws **cross-domain edges** linking a doc section to the code symbol it describes. Now Analyze can answer a very
"senior engineer" question: *"If I change `Calculator`, which docs go stale?"* — and the tutor can cite code and its
docs together.

## Navigate, not just drill

Beyond the mastery loop, three features help you find your way around:

- **Architectural layers** rank units by dependency depth — Foundation at the bottom, Interface at the top — so you can
  see the *system*, not just functions. Color the graph by layer to see it at a glance.
- **Guided tours** turn the dependency-ordered path into a narrated walkthrough: what each unit is, why it matters, and
  what it connects to.
- An **auto-generated wiki** produces a cross-linked Markdown page per unit (grouped by layer) — viewable in-app and
  **exportable to commit into your repo**. Or run it straight from the CLI:

```bash
pnpm --filter @ma/core wiki /abs/path/to/project   # writes <repo>/.master-anything/wiki/
```

## Bring any model — or none

The tutor and LLM-graded steps run on the [Vercel AI SDK](https://ai-sdk.dev) with **11 vendor presets** (OpenAI,
Anthropic, Google, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Ollama) plus any OpenAI-compatible
endpoint. The DX is deliberately low-friction:

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # that's it — auto-detected, default model chosen
```

You can also pick a provider explicitly, use `provider/model` shorthand, set a **failover** chain, or switch live from a
**Model settings** panel in the UI. Best of all: with **no key at all**, it still runs — falling back to heuristic
summaries and lexical search, so the graph, layers, wiki, and the verifiable Apply/Analyze loops all work offline.

## Honest about what's verified

I think credibility matters more than hype, so to be clear:

- **Apply** and **Analyze** are objectively verified (real tests; the graph). This is the real, defensible core.
- **Understand** is LLM-graded against the source — useful, but it's a model's judgment.
- **Create** comes in two flavors: an "open" mode (you add a feature + test; the suite must stay green with new
  coverage) and, with an LLM, a "spec" mode (a hidden acceptance test that must fail on the current code, then pass
  after your change).
- What it does *not* yet claim: a validated study that using it makes you learn faster. That's an empirical question for
  real usage.

Apply works for Python, JavaScript, and TypeScript today (pytest / `node --test`). Everything is SQLite-backed and
incremental, with a CI-checked test suite covering the graph, mastery, and the real break-and-fix loop.

## Try it

- **Repo:** <https://github.com/everettjf/Master-Anything>
- **Website & tutorial:** <https://everettjf.github.io/Master-Anything/>

If you've ever shipped a change to code you only *thought* you understood, give it a folder and try to reach *Apply* on
one unit. The first time a real test suite turns green because of code *you* wrote into a function you'd never seen — that's
the difference between understanding and mastery, and it's the whole point.
