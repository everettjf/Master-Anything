# 你的掌握图谱,终于成了资产 —— 自适应追踪 + 目标驱动的 Quest

> 这是 [Master-Anything](https://github.com/everettjf/Master-Anything) 的一篇进展介绍:一个把任意代码库(或文档、PDF)
> 变成知识图谱、再用**真实测试**和**图谱事实**来**证明**你已掌握的开源工具。这一篇交付了三大基础跃迁里的后两个 ——
> 于是 **A→B→C** 这条主线正式收口。

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

之前我把 Master-Anything 三个「言过其实」的核心主张、以及按顺序补齐它们的计划,白纸黑字写了下来:

- **A —— 通用验证。**「可验证的 Apply」过去只在恰好有现成测试覆盖某个函数时才成立。
  ([已交付 —— 特征化 oracle](./blog-universal-verification.zh.html),现已覆盖 Py/JS/TS。)
- **B —— 知识追踪。**「掌握图谱」过去只是一台扁平的「每单元状态机」:一个单元上的证据,从不流向它的邻居。一张不会传播的图,
  根本算不上图。
- **C —— 目标驱动的 Quest。**过去没有「打开这个工具的理由」—— 掌握没有挂到任何你真正想交付的东西上。

**B 和 C 现在都进来了。**下面讲讲变了什么。

## B —— 图谱终于会传播了

真正的理解不是孤立的。单元处在一张前置依赖图里,所以一个单元上的证据,理应影响它的邻居。Master-Anything 现在能从稀疏的几次
attempt,为**每一个**单元推出一个概率信念 **P(掌握)**,分两步:

1. **每单元后验**(贝叶斯知识追踪 BKT)—— 从该单元自身的 attempt 推,slip/guess 按验证器的客观程度调参:真实测试、图谱事实
   可信度高,LLM 打分被当作更噪。每次练习还会把信念往上抬一点,因为「练习本身就在教」。
2. **沿前置边传播。**掌握一个单元,是它所依赖的东西也被掌握的(打折)证据 —— 在图上做一次迭代式 noisy-OR 扩散。于是几次
   attempt 就能在**整张图**上铺出稠密的信念,而不是五个互不相干的数字。

有一个我挺得意的工程细节:**只有「高于先验的部分」才会传播。**否则,一个没练过的底层单元,会仅仅因为「上面压了一堆东西」就
凭空继承到虚假信念。加了这一条,没碰过的图谱就老老实实停在先验,只有**真实的掌握**才往下游流。

基于这些信念,Learn 视图现在会给出一个自适应的 **「Next up」** 面板。它按 **学习价值 = 就绪度 × 剩余掌握差距 × 下游解锁数**
给前沿排序(到期的间隔重复浮到最上),每条都附人话理由:*「Foundational — a good place to start · unlocks 4 units」*。
全程是图上的纯确定性、离线数学 —— 回路里没有大模型。`GET /repos/:id/next`。

## C —— 一个打开工具的理由

这部分把所有东西串了起来。你说出一个目标 —— *「修一下求平均的 bug」*、*「搞 auth 那块」* —— Master-Anything 把它变成一个
**Quest**:

1. **锚定** —— 把目标锚到图里的目标单元(走检索;默认离线词法)。
2. **算出必修子图** —— 目标 + 它的**传递**前置,*仅此而已*。你只掌握这个目标真正需要的,按依赖顺序。
3. **用 B 的信念驱动** —— 实时进度条、有序清单,以及一个**作用域限定在本 Quest 内**的「下一步」。
4. **以 capstone 收尾** —— 对目标单元的一次真实 Apply。那次跑通的改动,就是终极的、客观的验证。

下面是在内置 `py-calc` 上真跑的一遍端到端,目标 = *「fix the average calculation」*(它锚定到 `average` 单元,其必修子图是
`Calculator → average`):

```
fresh   0%    下一步 = Calculator   (Foundational — a good place to start · unlocks 1 unit)   capstone 锁定
+Calc   50%   下一步 = average      (Prerequisites in place)                                  capstone 解锁
+avg    100%  ✓ 完成
```

掌握 `Calculator`,capstone `average` 解锁;再掌握它,Quest 完成 —— 每一步都由真实验证把关,由信念图排序。这就是 **A→B→C**
闭环:*你本来要做的那件事*成了考卷,而你只学它真正需要的那块子图。

## 诚实的边界,以及接下来

- **B** 目前每单元用单一的 P(掌握);接下来是按 Bloom 分层的信念、信念随时间衰减(和间隔重复配合),以及按期望信息增益选题
  (而不只是学习价值)。
- **C** 的 capstone 现在是「重新实现目标」的 Apply;接下来是 *Create* 级 capstone(真的加一个新能力)、从真实 issue/PR
  拆出多目标 Quest,以及把 Quest 跨会话持久化。
- 一切默认确定性、离线;大模型只会**增强**锚定/拆解,绝不卡在关键路径上。

完整设计见
[`docs/MASTERY-ROADMAP.md`](https://github.com/everettjf/Master-Anything/blob/main/docs/MASTERY-ROADMAP.md),代码也小到
可以一口气读完:
[`tracing.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/core/src/tracing.ts) ·
[`quest.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/core/src/quest.ts)。

## 试一下

- **仓库:** <https://github.com/everettjf/Master-Anything>
- **本系列第一篇:** [让「可验证」覆盖任何一个函数](./blog-universal-verification.zh.html)
- **上手指南:** [别只是「读懂」你的代码库 —— 去「掌握」它](./blog.zh.html)

把它指向一个仓库,打开 **Learn**,在 🎯 Quest 框里敲一个目标。看它把确切的路径铺出来,然后一步步爬上去 —— 每一个绿勾都对着
某个真实的东西挣来,最后落在一个你本来就想做的改动上。
