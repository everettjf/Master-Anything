# 别只是「读懂」你的代码库 —— 去「掌握」它，而且可被验证

> 本文介绍 [Master-Anything](https://github.com/everettjf/Master-Anything)：一个开源工具，把任意代码库（或文档、网页、PDF）
> 变成一张知识图谱，然后用**真实测试**和**图谱事实**来**证明**你已经掌握了它 —— 而不是听一个大模型说「你答得不错」。

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

这两年冒出来一整类工具，都在帮你「读懂」一个代码库：把仓库丢进去，它画出一张漂亮的地图 —— 调用关系图、架构图、自动生成的
wiki。这确实有用。但如果你曾经把文档全读完、对着架构图点头如捣蒜，结果**还是**不敢动那段代码……你就懂那种落差。

**「读懂」是一张一次性的快照；「掌握」是一种你达到、证明、并且能保持的状态。** Master-Anything 就是为后者而生的。
下面讲讲它怎么用、怎么运作。

## 一句话讲清楚

「领域（domain）」只是一种*输入*。一旦你把它变成一张**知识图谱**，「怎么让一个人真正掌握它？」就变成了同一套引擎能解决的问题 ——
不管输入是 Python 代码、一篇 README，还是一份 PDF。

所以 Master-Anything 分成两层：

1. **领域适配器（domain adapters）** 把输入转成一张通用知识图谱（代码用 Tree-sitter；文档/PDF 用标题/分页切分）。
2. **掌握引擎（mastery engine）** 跑在上面，沿着布鲁姆认知层级把*你的*技能往上推 —— **理解 → 应用 → 分析 → 创造**
   （Understand → Apply → Analyze → Create）—— 每一级都有一个客观的检查点。

最关键的卖点是：这些检查是*真的*，不是凭感觉。

## 5 分钟上手

它是一个 pnpm + TypeScript 的 monorepo。你需要 Node ≥ 22，以及（跑 Python 练习时）`pytest`。

```bash
git clone https://github.com/everettjf/Master-Anything.git
cd Master-Anything
pnpm install
python3 -m pip install pytest          # Python 的 Apply/Create 任务需要

pnpm --filter @ma/server dev           # API  → http://localhost:8787
pnpm --filter @ma/web dev              # web  → http://localhost:5173
```

打开 web 应用，粘贴一个**绝对路径**的仓库目录，点 *Map*。想一次看全所有能力，就用内置示例，比如
`examples/mixed-app`（代码 + 文档）或 `examples/py-calc`（纯 Python）。你会进入一张知识图谱，上面有五个标签页：
**Graph · Learn · Layers · Wiki · Tutor**。

### 爬阶梯（核心循环）

打开 **Learn** 标签，点一个单元 —— 比如 `Calculator` 类。你会拿到四种挑战：

![Apply 循环](https://everettjf.github.io/Master-Anything/assets/demo.gif)

- **Understand（理解）** —— 导师抛出一个理解性问题，大模型会拿你的回答*对照源码*打分。
- **Apply（应用）** —— 一个真实函数的函数体被挖空了。你把它重新实现出来，点 **Run tests**，由项目里**真实存在的测试套件**
  来判定你是否通过。做对了，你就被晋升到 *Apply*。这一刻，把「我感觉我懂了」和「我能证明我会做」彻底区分开来。
- **Analyze（分析）** —— 「如果你改了 `Calculator`，哪些单元会受影响？」你的答案会拿真实的**调用/依赖图**来判分 ——
  这是从代码里算出来的客观事实。
- **Create（创造）** —— 加一个*新*能力（比如一个 `mul` 方法）**并且为它写一个测试**。整个测试套件必须依然全绿，
  且通过的测试数严格比之前多。你不只是复述已有代码，而是扩展它并证明它能跑通。

每一次 *Understand* 以上的晋升，背后都有一个客观检查 —— 真实跑测试，或图谱事实。没有那种「干得漂亮！」的客套 ——
那个模型可从来没真的跑过你的代码。

而且，因为掌握应该*持久*，你掌握过的单元会按**间隔重复（spaced repetition）**的节奏重新浮现出来。一次复习没过，
你的等级就掉一级 —— 遗忘被建模进来了，所以「掌握」意味着*保持住*的掌握。

## 不止于代码

把它指向一个装满 Markdown、HTML 或 PDF 的文件夹，同一套引擎照样启动 —— 每个章节（或 PDF 的每一页）都会变成一个学习单元，
带上 Understand 和图谱验证的 Analyze 挑战。

有意思的是**混合仓库**：一个既有代码*又*有 README 的项目会被合并进同一张图，而 Master-Anything 会画出**跨域边
（cross-domain edges）**，把一个文档章节连到它所描述的代码符号上。于是 Analyze 就能回答一个非常「资深工程师」的问题：
*「我要是改了 `Calculator`，哪些文档会过时？」* —— 而导师也能把代码和它的文档一起引用出来。

## 不只是刷题，还能导航

除了掌握循环，还有三个功能帮你找到方向：

- **架构分层（Architectural layers）** 按依赖深度给单元排序 —— 底层是 Foundation，顶层是 Interface —— 让你看到*系统*，
  而不只是一堆函数。把图按层着色，一眼看清。
- **引导式漫游（Guided tours）** 把依赖排序后的路径变成一段有讲解的走读：每个单元是什么、为什么重要、它连到了哪里。
- **自动生成的 wiki** 为每个单元产出一篇交叉链接的 Markdown 页面（按层分组）—— 应用内可看，也可**导出后提交进你的仓库**。
  或者直接用命令行跑：

```bash
pnpm --filter @ma/core wiki /abs/path/to/project   # 写入 <repo>/.master-anything/wiki/
```

## 接任意模型 —— 或者不接

导师和大模型打分的步骤跑在 [Vercel AI SDK](https://ai-sdk.dev) 上，内置 **11 个厂商预设**（OpenAI、Anthropic、
Google、OpenRouter、Groq、DeepSeek、Mistral、xAI、Together、Fireworks、Ollama），外加任意 OpenAI 兼容端点。
开发体验刻意做得很轻：

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # 这样就行了 —— 自动识别，自动选默认模型
```

你也可以显式指定厂商、用 `provider/model` 简写、配一条**故障转移（failover）**链，或者在 UI 里从一个
**Model settings** 面板实时切换。最棒的是：**一个 key 都不给**，它照样能跑 —— 退化成启发式摘要 + 词法检索，
所以图谱、分层、wiki，以及可验证的 Apply/Analyze 循环，全都能离线工作。

## 老实说，哪些是「验证过」的

我觉得可信比吹牛重要，所以把话说清楚：

- **Apply** 和 **Analyze** 是客观验证的（真实测试；图谱）。这是真正的、站得住脚的核心。
- **Understand** 是大模型对照源码打分的 —— 有用，但终究是一个模型的判断。
- **Create** 有两种模式：「开放」模式（你加一个功能 + 一个测试；套件必须保持全绿且覆盖增加），以及（接了大模型时的）
  「规格」模式（一个隐藏的验收测试，必须在当前代码上*先失败*，在你改完后*再通过*）。
- 它*暂时还不*声称的：一项「用了它你就学得更快」的对照研究。那是个需要真实使用来回答的实证问题。

Apply 目前支持 Python、JavaScript 和 TypeScript（pytest / `node --test`）。一切都用 SQLite 落库、增量更新，
并有一套经 CI 检查的测试覆盖图谱、掌握引擎，以及真实的「挖空再修复」循环。

## 试一下

- **仓库：** <https://github.com/everettjf/Master-Anything>
- **官网 & 教程：** <https://everettjf.github.io/Master-Anything/>

如果你曾经给一段「自以为读懂了」的代码提过改动，那就给它一个文件夹，挑一个单元试着冲到 *Apply*。当一套真实的测试套件
因为*你*往一个从没见过的函数里写下的代码而第一次变绿的那一刻 —— 那就是「读懂」和「掌握」的区别，也正是这一切的意义所在。
