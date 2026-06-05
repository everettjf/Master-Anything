#!/usr/bin/env python3
"""Generate landing-page media from SVG: tab screenshots + an Apply-loop GIF.

Reproducible build of pages/assets/{app-graph,app-tutor}.png and demo.gif.
Requires: cairosvg, Pillow.  Run:  python3 pages/assets/generate.py
"""
import io
import os

import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "DejaVu Sans, Segoe UI, Roboto, Helvetica, Arial, sans-serif"


def to_png(svg: str, w: int, h: int) -> bytes:
    return cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h)


# ---------- shared window chrome + sidebar ----------
def sidebar(active: str) -> str:
    def tab(x, label, on):
        fill = "#58a6ff" if on else "#0d1117"
        stroke = "" if on else 'stroke="#2a313c"'
        tcol = "#0d1117" if on else "#8b949e"
        weight = "700" if on else "400"
        return (
            f'<rect x="{x}" y="268" width="84" height="30" rx="7" fill="{fill}" {stroke}/>'
            f'<text x="{x + 42}" y="288" text-anchor="middle" font-size="12.5" font-weight="{weight}" fill="{tcol}">{label}</text>'
        )

    rows = [
        ("1", "Calculator", "class · calc.py", "Apply", "#3fb950", 196, 56),
        ("2", "average", "def average(nums):", "Analyze", "#a371f7", 188, 64),
        ("3", "Using Calculator", "section · README.md", "Understand", "#58a6ff", 180, 72),
        ("4", "Averages", "section · README.md", "None", "#30363d", 196, 56),
    ]
    rowsvg = ""
    for i, (idx, title, sub, lvl, col, px, pw) in enumerate(rows):
        y = 340 + i * 52
        tcol = "#8b949e" if lvl == "None" else "#0d1117"
        fs = "10" if len(lvl) > 7 else "10.5"
        rowsvg += (
            f'<g transform="translate(24,{y})">'
            f'<rect width="264" height="44" rx="9" fill="#0d1117" stroke="#2a313c"/>'
            f'<text x="16" y="27" font-size="11" fill="#8b949e">{idx}</text>'
            f'<text x="34" y="22" font-size="13.5" fill="#d6dde6" font-weight="600">{title}</text>'
            f'<text x="34" y="37" font-size="10.5" fill="#8b949e">{sub}</text>'
            f'<rect x="{px}" y="13" width="{pw}" height="20" rx="10" fill="{col}"/>'
            f'<text x="{px + pw / 2}" y="27" text-anchor="middle" font-size="{fs}" font-weight="700" fill="{tcol}">{lvl}</text>'
            f"</g>"
        )

    return f"""
    <rect x="0" y="46" width="312" height="754" fill="#161b22"/>
    <line x1="312" y1="46" x2="312" y2="800" stroke="#2a313c"/>
    <rect x="24" y="74" width="24" height="24" rx="7" fill="url(#logo)"/>
    <text x="33" y="91" text-anchor="middle" font-size="15" font-weight="800" fill="#0b0e13">M</text>
    <text x="58" y="91" font-size="16" font-weight="700" fill="#d6dde6">Master<tspan fill="#58a6ff">-Anything</tspan></text>
    <text x="24" y="116" font-size="12" fill="#8b949e">Master anything, verifiably.</text>
    <rect x="24" y="132" width="210" height="34" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <text x="36" y="154" font-size="13" fill="#c9d1d9" font-family="monospace">examples/mixed-app</text>
    <rect x="240" y="132" width="48" height="34" rx="8" fill="#58a6ff"/>
    <text x="264" y="154" text-anchor="middle" font-size="13" font-weight="700" fill="#0d1117">Map</text>
    <text x="24" y="190" font-size="12.5" fill="#8b949e">domain: <tspan fill="#58a6ff" font-weight="700">mixed</tspan></text>
    <rect x="24" y="204" width="80" height="48" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <text x="36" y="228" font-size="17" font-weight="700" fill="#d6dde6">2</text><text x="36" y="243" font-size="10" fill="#8b949e">files</text>
    <rect x="112" y="204" width="80" height="48" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <text x="124" y="228" font-size="17" font-weight="700" fill="#d6dde6">14</text><text x="124" y="243" font-size="10" fill="#8b949e">nodes</text>
    <rect x="200" y="204" width="88" height="48" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <text x="212" y="228" font-size="17" font-weight="700" fill="#d6dde6">6</text><text x="212" y="243" font-size="10" fill="#8b949e">units</text>
    {tab(24, "Graph", active == "graph")}{tab(114, "Learn", active == "learn")}{tab(204, "Tutor", active == "tutor")}
    <text x="24" y="328" font-size="11.5" fill="#8b949e">Learning path — prerequisites first</text>
    {rowsvg}
    """


def window(main: str) -> str:
    return f"""<svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">
  <defs>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#58a6ff"/><stop offset="1" stop-color="#a371f7"/></linearGradient>
    <clipPath id="round"><rect width="1280" height="800" rx="16"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="1280" height="800" fill="#0d1117"/>
    <rect width="1280" height="46" fill="#161b22"/>
    <circle cx="24" cy="23" r="6.5" fill="#ff5f56"/><circle cx="46" cy="23" r="6.5" fill="#ffbd2e"/><circle cx="68" cy="23" r="6.5" fill="#27c93f"/>
    <rect x="430" y="11" width="420" height="24" rx="12" fill="#0d1117" stroke="#2a313c"/>
    <text x="640" y="28" text-anchor="middle" font-size="12.5" fill="#8b949e">localhost:5173 — Master-Anything</text>
    {main}
  </g>
  <rect x="0.5" y="0.5" width="1279" height="799" rx="16" fill="none" stroke="#2a313c"/>
</svg>"""


# ---------- Graph tab ----------
def graph_main() -> str:
    nodes = [
        (560, 360, 9, "#6e7681"), (700, 300, 13, "#d29922"), (640, 470, 8, "#58a6ff"),
        (820, 380, 8, "#58a6ff"), (760, 520, 7, "#58a6ff"), (900, 300, 7, "#6e7681"),
        (980, 430, 11, "#3fb950"), (1080, 360, 9, "#3fb950"), (520, 520, 7, "#58a6ff"),
        (470, 380, 7, "#58a6ff"), (880, 540, 7, "#58a6ff"),
    ]
    edges = [(0, 1), (1, 2), (1, 3), (3, 4), (1, 5), (0, 9), (0, 8), (2, 4), (3, 6), (6, 7), (6, 10), (1, 6)]
    e = "".join(
        f'<line x1="{nodes[a][0]}" y1="{nodes[a][1]}" x2="{nodes[b][0]}" y2="{nodes[b][1]}" stroke="#58a6ff" stroke-opacity="0.28" stroke-width="1.4"/>'
        for a, b in edges
    )
    n = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r, c in nodes)
    legend = "".join(
        f'<circle cx="372" cy="{712 + i * 22}" r="5" fill="{c}"/><text x="386" y="{716 + i * 22}" font-size="12" fill="#8b949e">{lab}</text>'
        for i, (c, lab) in enumerate([("#6e7681", "file"), ("#d29922", "class"), ("#58a6ff", "function"), ("#3fb950", "section")])
    )
    detail = """
    <rect x="876" y="92" width="372" height="250" rx="10" fill="#161b22" stroke="#2a313c"/>
    <text x="896" y="122" font-size="15" font-weight="700" fill="#d6dde6">Calculator.add_many</text>
    <text x="896" y="142" font-size="11.5" fill="#8b949e">calc.py:6-10</text>
    <rect x="896" y="152" width="60" height="20" rx="10" fill="#0d1117" stroke="#2a313c"/><text x="926" y="166" text-anchor="middle" font-size="10.5" fill="#8b949e">function</text>
    <rect x="896" y="182" width="332" height="142" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <g font-family="monospace" font-size="12.5">
      <text x="910" y="206" fill="#ff7b72">def <tspan fill="#d2a8ff">add_many</tspan><tspan fill="#c9d1d9">(self, nums):</tspan></text>
      <text x="910" y="226" fill="#c9d1d9" xml:space="preserve">    total = 0</text>
      <text x="910" y="246" fill="#ff7b72" xml:space="preserve">    for <tspan fill="#c9d1d9">n in nums:</tspan></text>
      <text x="910" y="266" fill="#c9d1d9" xml:space="preserve">        total = self.add(total, n)</text>
      <text x="910" y="286" fill="#ff7b72" xml:space="preserve">    return <tspan fill="#c9d1d9">total</tspan></text>
    </g>
    """
    return f"{e}{n}{detail}{legend}"


# ---------- Tutor tab ----------
def chip(x, y, name, ref):
    w = 34 + len(name) * 7 + len(ref) * 6
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="24" rx="12" fill="#0d1117" stroke="#2a313c"/>'
        f'<text x="{x + 12}" y="{y + 16}" font-size="11.5" fill="#8b949e">{name} <tspan fill="#58a6ff" font-style="italic">{ref}</tspan></text>'
    ), x + w + 8


def tutor_main() -> str:
    c1, x = chip(372, 250, "average", "calc.py:14")
    c2, _ = chip(x, 250, "Calculator.add_many", "calc.py:6")
    c3, x3 = chip(372, 470, "Averages", "README.md:9")
    return f"""
    <rect x="344" y="78" width="904" height="640" rx="12" fill="#161b22" stroke="#2a313c"/>
    <!-- turn 1 -->
    <text x="372" y="124" font-size="15" font-weight="700" fill="#d6dde6">› how is the average computed?</text>
    <rect x="372" y="140" width="848" height="118" rx="10" fill="#0d1117" stroke="#2a313c"/>
    <text x="392" y="172" font-size="14" fill="#c9d1d9">It builds on <tspan font-family="monospace" fill="#79c0ff">Calculator.add_many</tspan> to sum the list, then divides by</text>
    <text x="392" y="194" font-size="14" fill="#c9d1d9">the count — returning 0 for an empty list (calc.py:14).</text>
    <text x="392" y="232" font-size="11" fill="#8b949e">sources</text>
    {c1}{c2}
    <!-- turn 2 (memory) -->
    <text x="372" y="320" font-size="15" font-weight="700" fill="#d6dde6">› what about its callers?</text>
    <rect x="372" y="336" width="848" height="140" rx="10" fill="#0d1117" stroke="#2a313c"/>
    <rect x="392" y="352" width="150" height="20" rx="10" fill="#161b22" stroke="#2a313c"/><text x="402" y="366" font-size="11" fill="#8b949e">remembers context ↺</text>
    <text x="392" y="398" font-size="14" fill="#c9d1d9"><tspan font-family="monospace" fill="#79c0ff">average</tspan> is documented by the <tspan fill="#a371f7">Averages</tspan> section of the README</text>
    <text x="392" y="420" font-size="14" fill="#c9d1d9">(a cross-domain <tspan font-family="monospace" fill="#79c0ff">documents</tspan> edge), and called from tests (README.md:9).</text>
    <text x="392" y="456" font-size="11" fill="#8b949e">sources</text>
    {c3}
    <!-- input -->
    <rect x="372" y="660" width="740" height="40" rx="10" fill="#0d1117" stroke="#2a313c"/>
    <text x="392" y="685" font-size="13.5" fill="#6e7681">Ask about this codebase…</text>
    <rect x="1124" y="660" width="96" height="40" rx="10" fill="#58a6ff"/><text x="1172" y="685" text-anchor="middle" font-size="14" font-weight="700" fill="#0d1117">Ask</text>
    """


# ---------- Practice card (for the GIF) ----------
def practice_card(body_lines, button, result):
    body = "".join(
        f'<text x="20" y="{40 + i * 24}" font-family="monospace" font-size="15" xml:space="preserve">{ln}</text>'
        for i, ln in enumerate(body_lines)
    )
    return f"""<svg width="920" height="520" viewBox="0 0 920 520" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">
  <rect width="920" height="520" rx="14" fill="#161b22" stroke="#2a313c"/>
  <text x="32" y="48" font-size="18" font-weight="700" fill="#d6dde6">Practice · Calculator</text>
  <text x="32" y="84" font-size="14" font-weight="700" fill="#3fb950">Apply challenge · real tests</text>
  <text x="32" y="110" font-size="14.5" fill="#d6dde6">Reimplement `add` so the project's tests pass.</text>
  <text x="32" y="132" font-size="12.5" fill="#8b949e">calc.py:5-6 · <tspan fill="#3fb950">✓ test-verified</tspan></text>
  <svg x="32" y="148" width="856" height="120"><rect width="856" height="120" rx="8" fill="#0d1117" stroke="#2a313c"/>{body}</svg>
  {button}
  {result}
</svg>"""


def gif_frame(stage):
    blank = ['<tspan fill="#ff7b72">def</tspan> <tspan fill="#d2a8ff">add</tspan><tspan fill="#c9d1d9">(self, a, b):</tspan>',
             '<tspan fill="#ff7b72" xml:space="preserve">    raise </tspan><tspan fill="#c9d1d9">NotImplementedError("implement me")</tspan>']
    fixed = ['<tspan fill="#ff7b72">def</tspan> <tspan fill="#d2a8ff">add</tspan><tspan fill="#c9d1d9">(self, a, b):</tspan>',
             '<tspan fill="#ff7b72" xml:space="preserve">    return </tspan><tspan fill="#c9d1d9">a + b</tspan>']
    btn_idle = '<rect x="32" y="296" width="120" height="36" rx="9" fill="#58a6ff"/><text x="92" y="319" text-anchor="middle" font-size="13.5" font-weight="700" fill="#0d1117">Run tests</text>'
    btn_run = '<rect x="32" y="296" width="150" height="36" rx="9" fill="#2a313c"/><text x="107" y="319" text-anchor="middle" font-size="13.5" font-weight="700" fill="#8b949e">Running tests…</text>'
    res_ok = ('<rect x="32" y="348" width="856" height="74" rx="9" fill="#16241a" stroke="#3fb950" stroke-opacity="0.5"/>'
              '<text x="52" y="378" font-size="14.5" font-weight="700" fill="#3fb950">✓ Mastered (Apply) — tests pass</text>'
              '<text x="52" y="402" font-size="12.5" font-family="monospace" fill="#8b949e"># pass 4, # fail 0 · 12ms · level 3</text>')
    if stage == 0:
        return practice_card(blank, btn_idle, "")
    if stage == 1:
        return practice_card(fixed, btn_idle, "")
    if stage == 2:
        return practice_card(fixed, btn_run, "")
    return practice_card(fixed, btn_idle, res_ok)


def main():
    # static tab screenshots
    open(os.path.join(HERE, "app-graph.png"), "wb").write(to_png(window(sidebar("graph") + graph_main()), 1280, 800))
    open(os.path.join(HERE, "app-tutor.png"), "wb").write(to_png(window(sidebar("tutor") + tutor_main()), 1280, 800))
    print("wrote app-graph.png, app-tutor.png")

    # Apply-loop GIF
    stages = [0, 1, 2, 3]
    durations = [1500, 1400, 900, 2600]
    frames = [Image.open(io.BytesIO(to_png(gif_frame(s), 920, 520))).convert("RGB") for s in stages]
    frames[0].save(
        os.path.join(HERE, "demo.gif"),
        save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True,
    )
    print("wrote demo.gif")


if __name__ == "__main__":
    main()
