// Lightweight animated knowledge-graph background + small UX touches.
// No dependencies; respects reduced-motion and pauses when hidden.
(() => {
  const canvas = document.getElementById("bg");
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const COLORS = ["#58a6ff", "#a371f7", "#3fb950", "#3a414d", "#3a414d", "#3a414d"];
  let w, h, dpr, nodes, raf;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    const count = Math.min(70, Math.floor((innerWidth * innerHeight) / 22000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18 * dpr,
      vy: (Math.random() - 0.5) * 0.18 * dpr,
      r: (Math.random() * 1.6 + 1.1) * dpr,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const linkDist = 150 * dpr;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.x += a.vx;
      a.y += a.vy;
      if (a.x < 0 || a.x > w) a.vx *= -1;
      if (a.y < 0 || a.y > h) a.vy *= -1;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < linkDist * linkDist) {
          const o = (1 - Math.sqrt(d2) / linkDist) * 0.5;
          ctx.strokeStyle = `rgba(88,166,255,${o * 0.45})`;
          ctx.lineWidth = dpr * 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const n of nodes) {
      ctx.fillStyle = n.c;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (reduce) {
      frame(); // draw a single static frame
      cancelAnimationFrame(raf);
    } else {
      frame();
    }
  }

  addEventListener("resize", () => {
    resize();
    if (reduce) start();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduce) frame();
  });

  resize();
  start();

  // copy button on the quick-start snippet
  const copy = document.getElementById("copy");
  if (copy) {
    copy.addEventListener("click", async () => {
      const text = document.getElementById("snippet").innerText;
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "copied ✓";
        setTimeout(() => (copy.textContent = "copy"), 1500);
      } catch {
        copy.textContent = "select & copy";
      }
    });
  }
})();
