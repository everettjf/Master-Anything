# Master-Anything

> **Master anything, verifiably.** 不只让你看懂,而是练到会、并且能证明你会。

Master-Anything 把**任何知识**(首先是代码仓库)转化为知识图谱,并在其上叠加一个
**精通引擎**:为每个学习者建模掌握度,生成自适应的学习路径、测验与练习,
并尽可能用**可验证**的方式判定"你是否真的掌握了"。

与"看懂即止"的理解类工具不同,我们的核心是 **从理解到精通**,且面向 **Anything**——
代码先行,逐步扩展到文档、论文、课程、网页等任意知识。

## 文档

- [愿景 VISION.md](./docs/VISION.md) — 定位、核心原则、"Anything" 扩展路线
- [架构 ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 分层架构、领域适配器、精通引擎
- [P0 代码精通 MVP](./docs/P0-CODE-MVP.md) — 图谱构建、精通数据模型、可验证精通、里程碑

## 开发(P0.0 行走骨架)

monorepo(pnpm),三个包:

- `packages/core` — 仓库 → 知识图谱(Tree-sitter,支持 Python / JS / TS / TSX)
- `packages/server` — HTTP API(Hono):连接仓库、取图谱、读节点源码
- `packages/web` — Web 前端(React + Vite):力导向图渲染 + 节点详情

### 跑起来

```bash
pnpm install

# 1) 命令行:把任意目录解析成图谱 JSON
pnpm --filter @ma/core graph <绝对路径> --out artifacts/graph.json

# 2) 启动后端(默认 :8787)
pnpm --filter @ma/server dev

# 3) 启动前端(默认 :5173,/api 代理到后端)
pnpm --filter @ma/web dev
```

打开 http://localhost:5173 ,输入服务器主机上的一个**绝对仓库路径**,即可看到知识图谱;
点击节点可查看其源码切片(基于 provenance 回链)。

> 当前进度:**P0.0**(连接仓库 → 图谱 → 渲染)。下一步 P0.1:LLM 语义补全 + 学习单元聚合 + 学习路径。

---

> 规划文档(VISION / ARCHITECTURE / P0)是项目的北极星。
