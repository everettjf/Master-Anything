# Master-Anything · 架构 (Architecture)

本文件描述系统的分层架构与各模块职责。设计目标:**领域适配层可插拔,精通引擎只写一次。**
关于"为什么这么做",见 [`VISION.md`](./VISION.md)。

> **实现现状(已交付的核心能力)** —— 见 [`MASTERY-ROADMAP.md`](./MASTERY-ROADMAP.md):
> **A** 通用验证(用原始实现当 oracle 合成特征化测试,Py/JS/TS)·
> **B** 图谱传播的知识追踪 + 自适应选题 ·
> **C** 目标驱动的 Quest(只掌握目标所需子图,capstone 验证)·
> 衍生:**行为防火墙**(验证 AI 对未测试代码的改动)与 **AI 认证孪生**(把掌握循环掉头考 agent)。

## 1. 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│  交互层 (Interaction)                                          │  通用
│   对话式问答 · 引导教学 · 测验 · 练习/任务 · 进度看板           │
│   形态: Web 应用(先行) / IDE·CLI(跟进),共享同一后端          │
├──────────────────────────────────────────────────────────────┤
│  精通引擎 (Mastery Engine)                          ★ 护城河    │  通用
│   · 知识拆解   把图谱节点拆成可学习单元 (learning units)        │
│   · 掌握度建模 knowledge tracing,Bloom 五级状态               │
│   · 自适应路径 spaced repetition + 依赖排序                    │
│   · 评估生成   出题 / 出练习,基于源头 grounding               │
│   · 评估判定   通用知识→AI 评分;代码→真实测试 ground truth     │
├──────────────────────────────────────────────────────────────┤
│  通用知识图谱 (Universal Knowledge Graph)                      │  通用 schema
│   节点: 概念 / 实体 / 技能 (+ 来源定位 provenance)             │
│   边:   依赖 depends-on · 包含 contains · 引用 refers-to ·     │
│         因果 causes · 调用 calls(代码)                        │
├──────────────────────────────────────────────────────────────┤
│  领域适配器 (Domain Adapters) —— 可插拔                        │  每领域一个
│   📦 Code   📄 Docs/PDF   📚 Papers   🎥 Video   🌐 Web        │
│   职责: 原始内容 → 抽取节点/边 → 写入通用图谱 schema           │
└──────────────────────────────────────────────────────────────┘
```

中间三层(交互 / 精通 / 图谱)**对领域无感知**。新增一个领域 = 实现一个适配器接口。

## 2. 领域适配器 (Domain Adapter)

每个适配器实现统一接口,把领域内容规约成通用图谱:

```
interface DomainAdapter {
  ingest(source):        RawUnits        // 拉取 + 切分原始内容
  extractNodes(units):   KnowledgeNode[] // 抽取概念/实体/技能
  extractEdges(nodes):   KnowledgeEdge[] // 抽取关系
  // 可选:为"可验证精通"提供 ground-truth 评估器
  buildVerifier?(node):  MasteryVerifier | null
}
```

### P0 · 代码适配器(首先重点支持)
- **结构解析**:Tree-sitter 做确定性的 AST / 符号 / 调用关系抽取(文件、函数、类、import)。
- **语义补全**:LLM 在结构骨架上补"这是干嘛的 / 属于哪个业务领域 / 设计模式"。
- **可验证精通(关键)**:`buildVerifier` 返回一个能跑真实测试的评估器——
  让学习者改代码或补测试,用测试通过与否客观判定掌握。这是代码领域独有的能力。
- **增量更新**:监听文件变化,只重算受影响的子图,解决"图谱过时"的痛点。

### P1+ · 其他适配器
- 📄 **Docs/PDF/书籍**:chunk + 实体/概念抽取(适配器最简单,用于验证通用引擎)。
- 📚 **Papers**:加引用图谱。 🎥 **Video**:转写后按 docs 流程处理。 🌐 **Web/笔记**:抓取 + 清洗。

## 3. 通用知识图谱 (Universal Knowledge Graph)

所有领域产出统一的节点/边 schema(草案):

```
KnowledgeNode {
  id, type: concept|entity|skill,
  title, summary,
  domain: code|docs|paper|...,
  provenance: { sourceRef, locator }   // 回链到源头(文件:行 / 页码 / 时间戳)
  bloomCeiling: 该节点最高可练到的层级
}
KnowledgeEdge { from, to, type: depends-on|contains|refers-to|causes|calls, weight }
```

`provenance`(来源定位)是所有评估"基于源头 grounding"的基础,用于减少幻觉、支持回链验证。

## 4. 精通引擎 (Mastery Engine) — 核心

领域无关,是系统的护城河。五个子模块:

1. **知识拆解 (Decomposer)**:把图谱节点聚合/拆分成大小合适的"可学习单元",并按依赖排序。
2. **掌握度建模 (Tracer)**:对每个 `(学习者, 节点)` 维护 Bloom 五级状态 + 置信度
   (knowledge tracing)。
3. **自适应路径 (Planner)**:结合依赖顺序与间隔重复,决定"下一步学什么 / 复习什么"。
4. **评估生成 (Assessor)**:针对目标 Bloom 层级出题或出练习,全部带 `provenance` grounding。
5. **评估判定 (Verifier)**:
   - 通用知识 → LLM 评分(对照源头)。
   - **代码 → 调用适配器的 ground-truth 评估器,用真实测试结果判定。**

**学习者掌握图谱**(每个用户在每个节点的状态)是随时间沉淀的核心数据资产。

## 5. 交互层 (Interaction)

同一后端,多前端:

- **Web(先行)**:连接仓库 / 上传内容 → 自动生成带测验的学习路线 → 对话式问答(GraphRAG,
  回答时高亮图谱路径)→ 边问边练边评分 → 进度看板。
- **IDE / CLI(跟进)**:类 `/understand` 命令,在开发者工作流内就地精通当前代码。

## 6. 建议技术栈(待定,P0 脚手架时敲定)

| 层 | 倾向选型 | 备注 |
|---|---|---|
| 前端 Web | TS + 现代框架 + 图可视化库 | 力导向图复用社区方案 |
| 后端 API | TS(与前端同栈)或 Python | 与图谱/LLM 编排就近 |
| 代码解析 | Tree-sitter | 多语言、确定性 |
| 图存储 | 先文件型 JSON 图谱 → 后续按需上图数据库 | 早期可提交进仓库共享 |
| 掌握度/学习者状态 | 关系型 DB | 需要持久化与查询 |
| LLM 编排 | Claude(默认最新最强模型) | 抽取、出题、评分 |

## 7. 不做什么(范围控制)

- 不一次性铺开所有领域适配器——严格按 P0→P4 推进。
- 不在中间三层引入任何领域特判逻辑——领域差异只允许存在于适配器内。
- 早期不追求图谱可视化的炫酷度;**优先打通"学—测—验"精通闭环**。

---

*愿景与战略动机见 [`VISION.md`](./VISION.md)。*
