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
def sidebar(active: str, heading: str = "Learning path — prerequisites first", body: str = "") -> str:
    def tab(x, label, on, w=49):
        fill = "#58a6ff" if on else "#0d1117"
        stroke = "" if on else 'stroke="#2a313c"'
        tcol = "#0d1117" if on else "#8b949e"
        weight = "700" if on else "400"
        return (
            f'<rect x="{x}" y="268" width="{w}" height="30" rx="7" fill="{fill}" {stroke}/>'
            f'<text x="{x + w / 2}" y="288" text-anchor="middle" font-size="11" font-weight="{weight}" fill="{tcol}">{label}</text>'
        )

    tabs = "".join(
        tab(x, lbl, active == key)
        for x, (lbl, key) in zip(
            [24, 78, 132, 186, 240],
            [("Graph", "graph"), ("Learn", "learn"), ("Layers", "layers"), ("Wiki", "wiki"), ("Tutor", "tutor")],
        )
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
    {tabs}
    <text x="24" y="328" font-size="11.5" fill="#8b949e">{heading}</text>
    {body or rowsvg}
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


# ---------- Tutor conversation card (for tutor.gif) ----------
def _chip(x, y, name, ref):
    w = 30 + len(name) * 7 + len(ref) * 6
    s = (
        f'<rect x="{x}" y="{y}" width="{w}" height="24" rx="12" fill="#0d1117" stroke="#2a313c"/>'
        f'<text x="{x + 12}" y="{y + 16}" font-size="11.5" fill="#8b949e">{name} <tspan fill="#58a6ff" font-style="italic">{ref}</tspan></text>'
    )
    return s, x + w + 8


def _answer_box(x, y, w, lines, badge=None):
    h = 22 + len(lines) * 22 + 8
    body = ""
    yy = y + 30
    if badge:
        body += f'<rect x="{x + 16}" y="{y + 12}" width="168" height="20" rx="10" fill="#161b22" stroke="#2a313c"/><text x="{x + 26}" y="{y + 26}" font-size="11" fill="#8b949e">{badge}</text>'
        yy = y + 56
        h += 28
    for ln in lines:
        body += f'<text x="{x + 16}" y="{yy}" font-size="13.5" fill="#c9d1d9">{ln}</text>'
        yy += 22
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#0d1117" stroke="#2a313c"/>{body}', y + h


def _thinking(x, y):
    dots = "".join(f'<circle cx="{x + 16 + i * 14}" cy="{y + 20}" r="3.5" fill="#8b949e"/>' for i in range(3))
    return f'<rect x="{x}" y="{y}" width="120" height="38" rx="10" fill="#0d1117" stroke="#2a313c"/>{dots}'


A1 = ["It builds on <tspan font-family='monospace' fill='#79c0ff'>Calculator.add_many</tspan> to sum the list, then",
      "divides by the count — 0 for an empty list (calc.py:14)."]
A2 = ["<tspan font-family='monospace' fill='#79c0ff'>average</tspan> is documented by the <tspan fill='#a371f7'>Averages</tspan> section of the README",
      "(a cross-domain <tspan font-family='monospace' fill='#79c0ff'>documents</tspan> edge), called from tests."]
Q1 = "how is the average computed?"
Q2 = "what about its callers?"


def tutor_frame(stage):
    W = 920
    parts = []
    # turn 1
    if stage >= 1:
        parts.append(f'<text x="20" y="44" font-size="14.5" font-weight="700" fill="#d6dde6">› {Q1}</text>')
    if stage == 1:
        parts.append(_thinking(20, 58))
    if stage >= 2:
        box, yend = _answer_box(20, 58, 852, A1)
        parts.append(box)
        c1, x = _chip(20, yend + 8, "average", "calc.py:14")
        c2, _ = _chip(x, yend + 8, "Calculator.add_many", "calc.py:6")
        parts.append(c1 + c2)
    # turn 2
    if stage >= 3:
        parts.append(f'<text x="20" y="232" font-size="14.5" font-weight="700" fill="#d6dde6">› {Q2}</text>')
    if stage == 3:
        parts.append(_thinking(20, 246))
    if stage >= 4:
        box, yend = _answer_box(20, 246, 852, A2, badge="remembers context ↺")
        parts.append(box)
        c3, _ = _chip(20, yend + 8, "Averages", "README.md:9")
        parts.append(c3)

    # input bar
    typed = ""
    if stage == 0:
        typed = f'<text x="40" y="565" font-size="13.5" fill="#c9d1d9">how is the aver<tspan fill="#58a6ff">|</tspan></text>'
    else:
        typed = '<text x="40" y="565" font-size="13.5" fill="#6e7681">Ask about this codebase…</text>'
    inp = (
        f'<rect x="20" y="544" width="724" height="40" rx="10" fill="#0d1117" stroke="#2a313c"/>{typed}'
        f'<rect x="756" y="544" width="96" height="40" rx="10" fill="#58a6ff"/><text x="804" y="569" text-anchor="middle" font-size="14" font-weight="700" fill="#0d1117">Ask</text>'
    )
    return f"""<svg width="920" height="600" viewBox="0 0 920 600" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">
  <rect width="920" height="600" rx="14" fill="#161b22" stroke="#2a313c"/>
  <svg x="24" y="20">{''.join(parts)}{inp}</svg>
</svg>"""


# ---------- Layers tab ----------
LAYER_C = {"Foundation": "#1f6feb", "Core": "#a371f7", "Interface": "#3fb950"}


def layers_sidebar_body() -> str:
    groups = [
        ("Foundation", [("Calculator", "calc.py"), ("Overview", "README.md")]),
        ("Core", [("average", "calc.py"), ("Using Calculator", "README.md")]),
        ("Interface", [("Averages", "README.md")]),
    ]
    out = ""
    y = 344
    for band, units in groups:
        c = LAYER_C[band]
        out += f'<circle cx="30" cy="{y}" r="5" fill="{c}"/><text x="44" y="{y + 4}" font-size="11" font-weight="700" fill="#d6dde6" letter-spacing="0.4">{band.upper()}</text>'
        y += 16
        for title, sub in units:
            out += (
                f'<g transform="translate(24,{y})"><rect width="264" height="38" rx="9" fill="#0d1117" stroke="#2a313c"/>'
                f'<text x="14" y="18" font-size="13" fill="#d6dde6" font-weight="600">{title}</text>'
                f'<text x="14" y="31" font-size="10" fill="#8b949e">{sub}</text>'
                f'<circle cx="248" cy="19" r="5" fill="{c}"/></g>'
            )
            y += 44
        y += 8
    return out


def layers_main() -> str:
    # same node layout as the graph, recolored by architectural layer
    nodes = [
        (560, 360, 13, "#1f6feb"), (700, 300, 9, "#1f6feb"), (640, 470, 8, "#a371f7"),
        (820, 380, 8, "#a371f7"), (760, 520, 7, "#3fb950"), (900, 300, 7, "#1f6feb"),
        (980, 430, 11, "#a371f7"), (1080, 360, 9, "#3fb950"), (520, 520, 7, "#1f6feb"),
        (470, 380, 7, "#a371f7"), (880, 540, 7, "#3fb950"),
    ]
    edges = [(0, 1), (1, 2), (1, 3), (3, 4), (1, 5), (0, 9), (0, 8), (2, 4), (3, 6), (6, 7), (6, 10), (1, 6)]
    e = "".join(
        f'<line x1="{nodes[a][0]}" y1="{nodes[a][1]}" x2="{nodes[b][0]}" y2="{nodes[b][1]}" stroke="#8b949e" stroke-opacity="0.22" stroke-width="1.4"/>'
        for a, b in edges
    )
    n = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r, c in nodes)
    seg = (
        '<rect x="372" y="92" width="200" height="30" rx="8" fill="#0d1117" stroke="#2a313c"/>'
        '<rect x="374" y="94" width="98" height="26" rx="7" fill="#0d1117"/><text x="423" y="111" text-anchor="middle" font-size="12" fill="#8b949e">by kind</text>'
        '<rect x="472" y="94" width="98" height="26" rx="7" fill="#58a6ff"/><text x="521" y="111" text-anchor="middle" font-size="12" font-weight="700" fill="#0d1117">by layer</text>'
    )
    legend = "".join(
        f'<circle cx="372" cy="{700 + i * 24}" r="6" fill="{c}"/><text x="388" y="{705 + i * 24}" font-size="13" fill="#8b949e">{lab}</text>'
        for i, (lab, c) in enumerate([("Foundation", "#1f6feb"), ("Core", "#a371f7"), ("Interface", "#3fb950")])
    )
    return f"{seg}{e}{n}{legend}"


# ---------- Wiki tab ----------
def wiki_sidebar_body() -> str:
    pages = ["Calculator", "Overview", "average", "Using Calculator", "Averages"]
    out = ""
    for i, p in enumerate(pages):
        y = 344 + i * 40
        out += (
            f'<g transform="translate(24,{y})"><rect width="264" height="32" rx="8" fill="#0d1117" stroke="#2a313c"/>'
            f'<text x="14" y="21" font-size="12.5" fill="#58a6ff">{p}.md</text></g>'
        )
    return out


def wiki_main() -> str:
    return """
    <rect x="344" y="78" width="904" height="684" rx="12" fill="#161b22" stroke="#2a313c"/>
    <rect x="344" y="78" width="904" height="48" rx="12" fill="#0d1117"/>
    <rect x="364" y="92" width="80" height="22" rx="7" fill="#161b22" stroke="#2a313c"/><text x="404" y="107" text-anchor="middle" font-size="12" fill="#8b949e">← Index</text>
    <text x="470" y="107" font-size="11.5" fill="#8b949e">6 pages</text>
    <rect x="1108" y="92" width="120" height="22" rx="7" fill="#58a6ff"/><text x="1168" y="107" text-anchor="middle" font-size="11.5" font-weight="700" fill="#0d1117">Export markdown</text>

    <text x="392" y="172" font-size="26" font-weight="800" fill="#d6dde6">Calculator</text>
    <text x="392" y="196" font-size="12.5" font-family="monospace" fill="#8b949e">calc.py:4-12</text>
    <text x="497" y="196" font-size="12.5" fill="#8b949e">· </text>
    <text x="510" y="196" font-size="12.5" font-weight="700" fill="#1f6feb">Foundation</text>
    <text x="606" y="196" font-size="12.5" fill="#8b949e">layer · class</text>
    <text x="392" y="230" font-size="14.5" fill="#c9d1d9">The Calculator class provides add and add_many; it's the foundation the rest of</text>
    <text x="392" y="251" font-size="14.5" fill="#c9d1d9">the app builds on (calc.py:4).</text>
    <text x="392" y="286" font-size="13.5" fill="#c9d1d9">Used by: <tspan fill="#58a6ff">average</tspan> · <tspan fill="#58a6ff">Using the Calculator</tspan> · <tspan fill="#58a6ff">Averages</tspan></text>
    <text x="392" y="330" font-size="17" font-weight="700" fill="#d6dde6">Source</text>
    <rect x="392" y="344" width="808" height="150" rx="8" fill="#0d1117" stroke="#2a313c"/>
    <g font-family="monospace" font-size="13.5">
      <text x="408" y="370" fill="#ff7b72">class <tspan fill="#d2a8ff">Calculator</tspan><tspan fill="#c9d1d9">:</tspan></text>
      <text x="408" y="392" fill="#ff7b72" xml:space="preserve">    def <tspan fill="#d2a8ff">add</tspan><tspan fill="#c9d1d9">(self, a, b):</tspan></text>
      <text x="408" y="414" fill="#ff7b72" xml:space="preserve">        return <tspan fill="#c9d1d9">a + b</tspan></text>
      <text x="408" y="436" fill="#ff7b72" xml:space="preserve">    def <tspan fill="#d2a8ff">add_many</tspan><tspan fill="#c9d1d9">(self, nums):</tspan></text>
      <text x="408" y="458" fill="#c9d1d9" xml:space="preserve">        total = 0</text>
      <text x="408" y="480" fill="#ff7b72" xml:space="preserve">        for <tspan fill="#c9d1d9">n in nums: total = self.add(total, n)</tspan></text>
    </g>
    <text x="392" y="528" font-size="13" fill="#58a6ff">← back to index</text>
    """


def main():    # static tab screenshots
    open(os.path.join(HERE, "app-graph.png"), "wb").write(to_png(window(sidebar("graph") + graph_main()), 1280, 800))
    open(os.path.join(HERE, "app-tutor.png"), "wb").write(to_png(window(sidebar("tutor") + tutor_main()), 1280, 800))
    open(os.path.join(HERE, "app-layers.png"), "wb").write(
        to_png(window(sidebar("layers", "Architectural layers — foundation first", layers_sidebar_body()) + layers_main()), 1280, 800)
    )
    open(os.path.join(HERE, "app-wiki.png"), "wb").write(
        to_png(window(sidebar("wiki", "6 pages", wiki_sidebar_body()) + wiki_main()), 1280, 800)
    )
    print("wrote app-graph.png, app-tutor.png, app-layers.png, app-wiki.png")

    # Apply-loop GIF
    stages = [0, 1, 2, 3]
    durations = [1500, 1400, 900, 2600]
    frames = [Image.open(io.BytesIO(to_png(gif_frame(s), 920, 520))).convert("RGB") for s in stages]
    frames[0].save(
        os.path.join(HERE, "demo.gif"),
        save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True,
    )
    print("wrote demo.gif")

    # Tutor GIF (GraphRAG conversation with memory)
    tstages = [0, 1, 2, 3, 4]
    tdur = [1400, 1100, 2600, 1300, 3000]
    tframes = [Image.open(io.BytesIO(to_png(tutor_frame(s), 920, 600))).convert("RGB") for s in tstages]
    tframes[0].save(
        os.path.join(HERE, "tutor.gif"),
        save_all=True, append_images=tframes[1:], duration=tdur, loop=0, optimize=True,
    )
    print("wrote tutor.gif")


if __name__ == "__main__":
    main()
