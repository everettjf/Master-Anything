# Grounded characterization —— 让没测试的函数可验证的三种途径

> 这是 [Master-Anything](https://github.com/everettjf/Master-Anything) 的一篇进展笔记。这个开源工具把任意代码库(或文档、
> PDF)变成知识图谱,再用**真实测试**和**图谱真值**来**证明**你真的掌握了它。这一版讲的是*输入*——让特征化 oracle 在真实
> 代码上也能用,而不只是 fuzzer 恰好能覆盖到的那些函数。

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

不久前我们[补上了「可验证 Apply」最大的窟窿](./blog-universal-verification.html):你**不需要**手写测试,因为一个还没被改动的
函数,本身就是它自己的 oracle。给原函数喂一批输入,把输出记成 golden 值,合成一个特征化测试——把函数挖空,这个测试立刻变红。
同一套机制对准 AI 的改动,就成了[行为防火墙](./blog-behavioral-firewall.html)。

但那套机制*内部*还藏着一个诚实的隐患。battery 只会 fuzz **基本类型和小集合**:`0`、`2.5`、`"ab"`、`[1, 2, 3]`。这能覆盖
算术形状的函数,却**覆盖不了**那些参数是配置字典、嵌套订单、领域对象的函数——而真实代码里恰恰大部分是这种。对它们,oracle
什么也找不到,「可验证」就悄悄退化成了「自检」。

这一版通过给 oracle 两条新的取输入途径来解决它——并对所有途径保持同一道诚实的过滤。

## 1. 运行期捕获(captured-run I/O)—— 钉住代码*真实*用到的输入

最干净的真实输入来源就是仓库自己。把 captured-run 指向你项目里已有的某个脚本(一个示例、一个入口),Master-Anything 就会
**给目标模块插桩**、运行这个脚本,记录在每个函数边界上观测到的真实 `(参数 → 返回值)`。

```bash
npx ma-firewall snapshot src/pricing.py --entry examples/demo.py -o pricing.behavior.json
# ✓ snapshot: 2 functions, 4 behaviors pinned
#     total_price  (2)
#     Cart.line_count  (2)
```

一个吃 `{"items": [...], "discount": 0.1}` 的函数——fuzzer 永远造不出这种参数——现在能从代码*真实的*调用方式里变得可验证。
它支持 **Python、JavaScript、TypeScript**,函数和方法都能捕获。(TypeScript 的模块导出是只读的,所以我们注册了一个 loader,
换入一个生成的 shim——顶层的 `export function` 也能像 CommonJS 导出一样被插桩。)参数是在调用*之前*快照的,所以即便函数会
修改入参,记录的也是正确的调用前状态。

在真实代码上到底有多大用?我们在两个知名库上做了测量,driver 只用它们自己文档里的示例:

- **[`pytoolz/toolz`](https://github.com/everettjf/Master-Anything/blob/main/docs/casestudy/captured-run-toolz/README.md)**(Python)——
  防火墙从钉住 4 个函数提升到 6 个(27 → 39 个行为),`assoc`/`merge` 从*不可验证*跨进了*可验证*。
- **[`object-path`](https://github.com/everettjf/Master-Anything/blob/main/docs/casestudy/captured-run-objectpath/README.md)**(JS)——
  结论更锋利。battery 钉住了 47 个行为,但**其中只有 1 个真正碰到了对象**:像 `get(0, 1, 2) -> 2` 这种(路径是个数字,`get`
  只是回显默认值)。这 46 个退化的 case,几乎*任何*对路径遍历逻辑的重写都骗得过去——纯属虚假的安全感。captured-run 补上了
  那 15 个真正考验 `object-path` 用途的 grounded 行为。

## 2. LLM 提议输入 —— 没有 driver?那就问模型

没有现成的脚本可指?如果你配置了模型,它可以直接从函数源码里**提议**输入——一个结构良好的记录、几个边界情况——以普通的
参数列表形式返回。这些并不绕过任何检查:它们会走*完全相同*的「字面量回环 + 两次运行稳定」过滤,所以猜错了就只是产生不了
case。模型负责拓宽覆盖;判定什么是真实的,依然是 oracle。

离线时这些都不会运行,battery 独自工作——还是 Master-Anything 一贯的诚实降级。

## 为什么这是同一个想法的三种形态

特征化的关键从来不是 fuzzer,而是那个 **oracle**:由原始代码来决定什么是真的。这一版只是给这个 oracle 更好的问题去问。
免费的确定性 battery、仓库能驱动时的真实 I/O、不能驱动时模型提议的输入——而它们每一个都经过同一道过滤,所以无论输入从
哪来,判定都保持客观。

## 上手

- **仓库:** <https://github.com/everettjf/Master-Anything>
- **它依赖的 oracle:** [让「可验证」覆盖到任意函数](./blog-universal-verification.zh.html)
- **它驱动的防火墙:** [让 AI 重写你没测试的代码 —— 并证明它没改变行为](./blog-behavioral-firewall.zh.html)

在你的仓库里找出那个最关键、最没测试的文件。用 `--entry` 把 `ma-firewall` 指向你的某个示例脚本。看着它钉住真正重要的行为
——然后放 agent 去重写这个文件,它会精确到具体输入地告诉你:还能不能信。
