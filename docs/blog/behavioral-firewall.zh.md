# 让 AI 重写你没测试的代码 —— 并证明它没改变行为

> 这是 [Master-Anything](https://github.com/everettjf/Master-Anything) 的一个衍生能力。那个让「没测试的函数也能学」的
> oracle,原来也能让「AI 改没测试的代码」变得可信。这就是**行为防火墙(Behavioral Firewall)**。

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

有件关于 AI 编程 agent 的事,大家心照不宣却很少明说:**它最危险的地方,恰恰是你最不敢让它碰的代码 —— 那些没测试的。**
测试套件是一张安全网。把网撤掉,agent 对某个老旧 `utils.py` 的「无害重构」就成了一场信仰行为:diff 看着没问题,PR 是绿的
(根本没测试可以变红),而你**完全不知道** `clamp(12, -1, 7)` 还是不是返回原来那个值。

Master-Anything 早就为「学习」回路造好了那块缺失的拼图:一个**特征化 oracle**,靠真跑函数来捕获它的行为。把同一套机制
对准 AI 的改动,你就给那些从没有过安全网的代码,补上了一张回归网。

## 核心思路:给行为拍快照,再验证它是否幸存

两个命令。

**`snapshot`** 用*反射*(不需要 parser)发现文件里每一个函数(以及零参类的方法),逐个跑一批输入,把确定性的结果钉成
「输入 → 输出」的黄金对:

```
$ ma-firewall snapshot utils.py -o utils.behavior.json
✓ snapshot: 3 functions, 19 behaviors pinned → utils.behavior.json
    clamp  (11)
    running_sum  (4)
    Stats.total  (4)
```

现在让 agent(或同事,或凌晨两点的你)重写这个文件。**`verify`** 把快照重放到新版本上。行为保住了,你拿到一张干净的
合格证 —— 退出码 0:

```
$ ma-firewall verify utils.py utils.behavior.json
✅ behavior preserved — 19/19 behaviors unchanged in utils.py
```

而当行为**没**保住,你拿到的不是含糊的「有东西坏了」—— 而是精确到哪个函数、哪个输入、旧值→新值,并且非零退出:

```
$ ma-firewall verify utils.py utils.behavior.json
❌ behavior CHANGED in utils.py

  3 behavior(s) differ:
    clamp(12, -1, 7)
        was  7
        now  8
    running_sum([1, 2, 3])
        was  [1, 3, 6]
        now  [2, 4, 7]
    running_sum([2, 4, 6])
        was  [2, 6, 12]
        now  [3, 7, 13]
```

一个是 clamp 上界的差一错误,一个是累加器起始值写错了 —— 在零手写测试的代码上,被精确逮住。

## 为什么它不会「狼来了」

一个会乱报的行为守卫,毫无价值。所以防火墙在「钉什么」上刻意保守 —— 宁可沉默,也不误报:

- **只钉确定性行为。**每个输入跑两遍,凡是两遍输出对不上的(时钟、随机数、IO、全局状态)一律丢弃。防火墙绝不会因为
  不确定性而报错。
- **只钉可作字面量比较的结果。**一个返回值只有能往返通过字面量(数字、字符串、列表、字典)才会被钉。不透明对象不参与断言,
  所以你不会因为 repr 顺序变了就收到虚假的「changed」。
- **对缺口诚实。**被删掉、或不再可调用的函数,会被报成 **missing**,而不是悄悄放过。

代价是一个诚实的边界:防火墙钉的是它能**通过一批输入观察到**的行为。对纯的、数据形状的函数,它是一张很强的网 ——
但不是「完全等价」的证明。(下面讲怎么把网织得更密。)

## 它该用在哪

- **在 CI 里:**在 `main` 上拍快照,在 PR 分支上 verify。行为意外变了?非零退出直接让构建失败 —— 哪怕没有测试套件。
- **在 agent 回路里:**让 agent 重构,跑 `verify`,把 diff 作为硬信号喂回去。「你把 `running_sum([1,2,3])` 从
  `[1,3,6]` 改成了 `[2,4,7]` —— 修回去」,远比「测试没跑」是更好的纠错。
- **作为人类的起飞前检查:**要动一段吓人的、没测试的代码?先拍快照,放开手重构,推之前 verify。

目前支持 Python、JavaScript(CommonJS)、TypeScript(走 Node 内置的类型擦除)。纯确定性、离线 —— 不需要任何模型。

## 诚实的边界,以及接下来

- 输入来自一组类型无关的电池;接下来是**大模型提议输入**(接了模型时)和**真实运行轨迹采样** —— 从仓库自带的示例/入口
  采集*真实*入参,把覆盖织得更密。
- 现在钉的是模块级函数和零参类的方法;带构造参数、有状态的对象是下一步。
- server 端点 + 一键 web 面板在路上,这样你不用 CLI、在 Master-Anything 界面里就能拍快照 / 验证改动。

代码很小,可以一口气读完:
[`snapshot.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/verifier/src/snapshot.ts) ·
[`firewall-cli.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/verifier/src/firewall-cli.ts)。

## 试一下

- **仓库:** <https://github.com/everettjf/Master-Anything>
- **它所基于的 oracle:** [让「可验证」覆盖任何一个函数](./blog-universal-verification.zh.html)
- **学习那一侧:** [你的掌握图谱,终于成了资产](./blog-mastery-graph-quests.zh.html)

找出你仓库里最没测试、又最关键的那个文件。给它拍个快照。放你最爱的 agent 进去折腾。然后跑 `verify` —— 看它精确到输入地
告诉你:这次的结果,到底能不能信。
