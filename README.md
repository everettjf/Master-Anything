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

## 开发(P0 MVP — 可验证精通闭环)

monorepo(pnpm),四个包:

- `packages/core` — 仓库 → 知识图谱(Tree-sitter:Python/JS/TS/TSX)+ 学习单元聚合 +
  依赖排序的学习路径 + 领域无关的精通引擎(Bloom 分级)
- `packages/verifier` — **可验证精通**:把函数"改坏",用真实测试判定修复是否成功
  (可插拔 TestRunner;P0 内置本地 pytest 子进程运行器,Docker 沙箱后续接入)
- `packages/server` — HTTP API(Hono):连接仓库 / 图谱 / 学习路径 / 出题 / 提交作答 / 掌握度
- `packages/web` — Web 前端(React + Vite):力导向图 + 学习路径 + 练习面板

### 跑起来

```bash
pnpm install
python3 -m pip install pytest          # 本地测试运行器需要

# 启动后端(默认 :8787)
pnpm --filter @ma/server dev
# 启动前端(默认 :5173,/api 代理到后端)
pnpm --filter @ma/web dev
```

打开 http://localhost:5173 ,在输入框填一个**绝对仓库路径**。想直接看"可验证精通"闭环,
填本仓库自带的示例:`<本仓库>/examples/py-calc`。

### 体验闭环

1. **Graph** 标签:浏览知识图谱,点节点看源码(provenance 回链)。
2. **Learn** 标签:看依赖排序的学习路径;点一个单元进入 **Practice**:
   - **Apply(可验证)**:把真实函数"改坏",你重写函数体 → **跑真实 pytest** 判定 →
     通过(且被测试覆盖)升到 **Apply** 级。
   - **Analyze(图谱判分)**:"改了这个单元会波及谁?"——答案图谱里就有,**用调用图客观判分** →
     选全对升到 **Analyze** 级。
3. **Tutor** 标签:用自然语言问代码,回答**基于知识图谱 grounding**、引用 `文件:行`(GraphRAG);
   没配 LLM 时仍会给出最相关的代码位置。

> 这就是 "Master" 与 "Understand" 的区别:不止解释(Tutor),还能用**真实测试**和**图谱真值**
> **验证**你是否真的掌握(Apply / Analyze),而不是 AI 主观打分。

> 命令行也能单独建图谱:`pnpm --filter @ma/core graph <绝对路径> --out artifacts/graph.json`

### 可选:接入 LLM 语义补全

语义补全**可插拔**:不配就用启发式摘要,配了就走 LLM。统一基于 **[Vercel AI SDK](https://ai-sdk.dev)**
(`ai` + `@ai-sdk/*`),纯 TypeScript。两种配置方式:

**A) 指定 provider(OpenAI / Anthropic / Google)**
```bash
export MA_LLM_PROVIDER=anthropic
export MA_LLM_MODEL=claude-3-5-sonnet-latest
export ANTHROPIC_API_KEY=sk-ant-...          # 或 MA_LLM_API_KEY 覆盖
# 其它:MA_LLM_PROVIDER=openai MA_LLM_MODEL=gpt-4o-mini (OPENAI_API_KEY)
#       MA_LLM_PROVIDER=google MA_LLM_MODEL=gemini-1.5-pro (GOOGLE_GENERATIVE_AI_API_KEY)
```

**B) 任意 OpenAI 兼容端点(OpenRouter / LiteLLM 代理 / Ollama)**
不设 `MA_LLM_PROVIDER`,只给 `MA_LLM_BASE_URL` 即走 `@ai-sdk/openai-compatible`:
```bash
# OpenRouter
export MA_LLM_BASE_URL=https://openrouter.ai/api/v1
export MA_LLM_MODEL=anthropic/claude-3.5-sonnet
export MA_LLM_API_KEY=sk-or-...
# LiteLLM 代理(Python:先 `litellm --config ...`,默认 :4000):MA_LLM_BASE_URL=http://localhost:4000
# Ollama(本地,无需 key):MA_LLM_BASE_URL=http://localhost:11434/v1  MA_LLM_MODEL=llama3.1
```

```bash
pnpm --filter @ma/server dev        # 启动时打印 “LLM enrichment: vercel-ai (...)” 或 off
```

> 说明:**LiteLLM 的库本身是 Python**,进不了 Node 进程;我们统一用 **Vercel AI SDK**——
> 原生支持 OpenAI/Anthropic/Google,其余(OpenRouter、LiteLLM 代理、Ollama 等)走
> `openai-compatible` 端点。任一后端报错都会**自动降级为启发式摘要**,不影响主流程。

### 进度

- ✅ **P0.0** 连接仓库 → 图谱 → 渲染
- ✅ **P0.1** 学习单元聚合 + 依赖排序学习路径(语义补全可插拔,无 key 时降级为启发式)
- ✅ **P0.2/3** 精通引擎 + 可验证 Apply(改坏-修复,真实 pytest 判定)
- ✅ **P0.4** Web 端"学 → 测 → 验"闭环
- ✅ **Analyze**(图谱判分的影响分析)+ **Tutor**(GraphRAG,基于图谱 grounding 的问答)
- ✅ LLM 层统一到 **Vercel AI SDK**(OpenAI / Anthropic / Google / 任意 OpenAI 兼容端点)
- ✅ **嵌入式语义检索**(`MA_EMBED_*`,缺省降级词法)
- ✅ **Understand 级问答评分**(LLM 基于源码判分 → Understand 级)
- ✅ **Docker 沙箱**运行器(`MA_SANDBOX=docker`,无 daemon 时降级本地)
- ✅ **P1 文档适配器**:Markdown → 知识图谱,同一套 路径/精通/Tutor/Understand/Analyze
  直接跑在文档上(连接 `examples/md-guide` 体验)。这验证了 "Anything":换适配器即换领域。

> 后续:多语言验证器、增量更新、图存储、更多文档格式(PDF/网页/课程)。
> 详见 [docs/P0-CODE-MVP.md](./docs/P0-CODE-MVP.md) 与 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

### "Anything":代码 vs 文档

连接路径会**自动识别领域**(也可在 `POST /repos` 传 `kind: "code"|"docs"`):

| 领域 | 适配器 | 单元 | 可练的 Bloom 级 |
|---|---|---|---|
| 代码 | Tree-sitter | 函数 / 类 | Understand · **Apply(真实测试)** · **Analyze(图谱)** |
| 文档 | Markdown 分节 | 章节 | Understand · **Analyze(图谱)**(无可执行 Apply) |

精通引擎、学习路径、Tutor、Understand/Analyze 评估**完全复用**,领域差异只存在于适配器内。

---

> 规划文档(VISION / ARCHITECTURE / P0)是项目的北极星。
