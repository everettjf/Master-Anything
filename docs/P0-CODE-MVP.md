# Master-Anything · P0 代码精通 MVP 技术方案

> 目标:用户连接一个代码仓库 → 系统生成知识图谱与学习路径 → 跑通
> **"学 → 测 → 验"** 闭环,其中"应用级"掌握由**真实测试执行**客观判定。
> 形态:Web 先行。范围见 [VISION](./VISION.md) / [架构](./ARCHITECTURE.md)。

## 0. P0 的成功标准

一个用户能在某仓库里挑一个函数/模块,系统出一道"改坏-修复"或"补测试"的练习,
学习者提交后系统**在沙箱里跑真实测试**给出通过/失败,并据此更新其掌握度。
跑通这一条,P0 即成立——其余都是把这条体验做厚。

## 1. 流水线:仓库 → 知识图谱

```
连接仓库 → 文件遍历/语言识别 → Tree-sitter 解析 → 结构边 → LLM 语义补全 → 聚合学习单元 → 拓扑排序成路径
   (1)          (2)               (3)            (4)         (5)              (6)            (7)
```

1. **连接仓库**:clone 或上传。记录 commit SHA(图谱与某次快照绑定)。
2. **文件遍历**:按语言识别 + `.gitignore` 过滤,跳过 vendored/生成文件。
3. **结构解析(确定性)**:Tree-sitter 抽取符号——文件、类、函数/方法、import。
   这一步**不用 LLM**,保证结构准确、可复现、便宜。
4. **结构边**:`contains`(文件→函数)、`imports`/`depends-on`(模块依赖)、
   `calls`(函数调用,P0 用同仓库内的符号解析,跨文件靠 import + 名称匹配,先做到"够用")。
5. **语义补全(LLM)**:在结构骨架上,对每个符号补 `summary / role / domain 标签 /
   设计模式 / 先修依赖`。批量处理、可并行、带缓存(按符号内容 hash)。
6. **聚合学习单元**:把零散符号聚成大小合适的 **learning unit**(一个连贯概念 ≈
   一个核心函数 + 其紧密协作者,或一个模块)。这是"学习"的最小颗粒,而非单个函数。
7. **拓扑排序**:按 `depends-on` / 先修关系排序,产出**学习路径**(被依赖的先学)。

**P0 范围裁剪**:先全量重建,不做增量更新;调用图做到"够用"即可,不追求跨文件精确解析。

## 2. 知识图谱 Schema(代码)

```ts
KnowledgeNode {
  id: string
  kind: 'file' | 'class' | 'function' | 'unit'   // unit = 聚合后的学习单元
  name: string
  signature?: string
  provenance: { path: string, startLine: number, endLine: number, commit: string }
  summary?: string          // LLM
  role?: string             // LLM:在系统中扮演什么
  domain?: string           // LLM:业务领域标签
  prerequisites: string[]   // 先修单元 id
  bloomCeiling: BloomLevel   // 这个节点最高能练到几级
}
KnowledgeEdge { from, to, type: 'contains'|'imports'|'depends-on'|'calls', weight }
```

`provenance`(路径:行:commit)是所有评估"基于源头 grounding"和"回链验证"的基础。
图谱以 **JSON artifact** 落地(可提交进仓库共享),运行时载入内存/或入库。

## 3. 精通引擎数据模型

```ts
enum BloomLevel { None=0, Remember=1, Understand=2, Apply=3, Analyze=4, Create=5 }

LearnerUnitState {                 // 每个 (用户, 学习单元) 一条
  userId, unitId,
  level: BloomLevel,               // 当前已达层级
  confidence: number,              // 0~1,knowledge tracing
  lastReviewedAt, nextReviewAt,    // 间隔重复调度
  attempts: AttemptRef[]
}

Assessment {
  id, unitId, targetLevel: BloomLevel,
  kind: 'mcq'|'explain'|'trace'|'impact'|'break-fix'|'write-test'|'refactor',
  prompt, grounding: Provenance[],  // 出题所依据的源码位置
  verifier: 'llm' | 'tests' | 'graph'
}

Attempt { id, assessmentId, userId, response, score, passed, verifierLog, createdAt }
```

**学习者掌握图谱**(所有 `LearnerUnitState`)是随时间沉淀的核心数据资产。

## 4. Bloom 层级 → 评估方式(P0 的关键映射)

| 层级 | 题型 | 判定方式 | 是否有 ground truth |
|---|---|---|---|
| Remember 记忆 | 这个函数做什么 / 签名 (MCQ) | LLM 评分 | 弱(对照 summary) |
| Understand 理解 | 解释为何 A 调用 B / 数据流 | LLM 评分 + grounding | 弱 |
| **Apply 应用** | **改坏-修复 / 补测试 / 保行为重构** | **沙箱跑真实测试** | ✅ **强** |
| **Analyze 分析** | 改动 X 会波及哪些节点(影响分析) | **对照调用图判定** | ✅ **强(图谱即答案)** |
| Create 创造 | 扩展/设计一个新能力 | LLM 评分 + 跑测试 | 中 |

两个"强 ground truth"层级(Apply 用测试、Analyze 用图谱)是我们相对理解类工具的
**根本差异点**,P0 必须把 Apply 跑通,Analyze 作为加分项(图谱已有,成本低)。

## 5. 可验证精通:Apply 级怎么用真实测试跑(P0 核心难点)

### 5.1 三种练习生成策略

- **改坏-修复 (break-and-fix)**:取一个**已被现有测试覆盖**的函数,
  对其注入变异(删函数体 / 引入 bug),让学习者修复。
  判定 = 跑该函数关联的测试 → 全过即掌握。
- **补测试 (write-test)**:让学习者为某单元写测试。**双重校验防作弊**:
  测试须 ① 在正确代码上通过,② 在系统注入的变异版本上失败——否则视为空测试/无效测试。
- **保行为重构 (refactor)**:让学习者重构某单元,要求现有测试仍全过。

### 5.2 沙箱执行

```
学习者提交 → 写入隔离工作副本 → 容器内安装依赖 + 跑目标测试(超时/资源/网络限制)→ 解析结果 → 判定 + 回写掌握度
```

- 每次评估**隔离容器**,限制 CPU/内存/时长、禁外网,防恶意代码与逃逸。
- 需要一个**测试运行器抽象**(per 语言/框架),返回结构化结果(passed/failed/用时/日志)。
- **P0 只支持一种语言**(建议 **Python + pytest**:解析干净、测试约定清晰、运行器最简单),
  打通后再加 TS(vitest/jest)。

### 5.3 冷启动:仓库测试覆盖率差怎么办

这是最现实的风险。分层兜底:

1. 单元**有覆盖测试** → 用真实测试(最高可信)。
2. 单元**无测试** → 系统用 LLM 对当前代码生成**特征测试 (characterization tests)**,
   以"当前行为"为 oracle,先在原代码上验证这些测试自身通过,再用于练习判定。
3. 实在无法构造 → 降级为 **LLM 评分的 Apply 任务**,并向用户**如实标注**"本题为 AI 评分,非测试验证"。

诚实区分"可验证"与"AI 评分",是产品可信度的一部分,不藏着。

## 6. API 草图

```
POST /repos                 连接/上传仓库,触发构建
GET  /repos/:id/graph       取知识图谱
GET  /repos/:id/path?user   取该用户的自适应学习路径
GET  /units/:id             单元详情(含 provenance 源码)
POST /units/:id/assessment  生成一道指定 Bloom 层级的评估
POST /attempts              提交作答 → 触发 verifier(llm|tests|graph)→ 回写掌握度
GET  /learners/:id/mastery  掌握图谱/进度看板数据
```

## 7. P0 技术栈(建议,脚手架时定稿)

| 部分 | 选型 | 理由 |
|---|---|---|
| 仓库结构 | TS monorepo | 前后端同栈,减少心智负担 |
| 前端 | React + Vite;图谱用 Cytoscape / react-force-graph | 社区成熟 |
| 后端 | Node + TS(Hono/Express) | tree-sitter 有好用的 Node 绑定 |
| 代码解析 | web-tree-sitter / node-tree-sitter | 多语言、确定性 |
| 沙箱 | Docker 容器,按语言镜像 | 隔离跑测试 |
| 图谱存储 | JSON artifact(可入仓共享) | 早期够用 |
| 学习者状态 | Postgres | 需持久化与查询 |
| LLM | Claude(最新模型);抽取用较快档,评分/难推理用最强档 | 平衡成本与质量 |

## 8. 里程碑(把 P0 切成可独立验收的薄片)

| 切片 | 交付 | 验收 |
|---|---|---|
| **P0.0 行走骨架** | 连接仓库 → tree-sitter 图谱 → 前端渲染 | 能看到真实仓库的结构图 |
| **P0.1 语义+路径** | LLM 补语义 → 聚合单元 → 拓扑排序路径 | 给出"先学什么"的有序列表 |
| **P0.2 精通引擎** | 掌握度模型 + Remember/Understand 评估(LLM 评分) | 答题后掌握度变化 |
| **P0.3 可验证 Apply** | 改坏-修复 + Python 沙箱测试运行器 | 改对了测试过、掌握度升到 Apply |
| **P0.4 看板+自适应** | 掌握图谱看板 + "下一步"推荐 | 闭环成型,可演示 |

> **最小可演示 = P0.0 → P0.3**。P0.3 跑通即证明"可验证精通"成立,是对外讲故事的关键节点。

## 9. P0 主要风险

1. **测试覆盖冷启动**(§5.3 已给兜底)——最现实,需早验证。
2. **沙箱安全与成本**——跑用户/AI 生成代码,必须强隔离 + 配额。
3. **大仓库 LLM 抽取的质量与成本**——靠缓存 + 分级模型 + 先限定单语言。
4. **调用图精度**——P0 接受"够用",不在此过度投入。

---

*上层愿景见 [VISION](./VISION.md),整体分层见 [ARCHITECTURE](./ARCHITECTURE.md)。*
