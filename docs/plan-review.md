# Plan 评论核验

日期：2026-09-27。结论：大部分问题成立，需要修订；部分建议只解决了一部分问题，不能直接转化为可靠性或安全保证。本文只记录产品与工程判断。

原评论存在重复、截断和旧行号。以下按其可确认的完整意思逐项处理，不推断被截断部分。

## 第一轮核验与处理（历史记录）

以下记录第一轮的判断与当时方案；第二轮结论及当前 plan 优先，特别是 prompt 摄取时机、错误分类和预算实现。

| 评论 | 结论 | 本次处理 |
| --- | --- | --- |
| 1. candidate 自报工具记录不可信 | 成立，但同进程注入 harness 不足以抵御恶意代码 | v1 限为 prompt-only；不执行候选代码。固定 harness 收集真实调用，Go 计算断言 |
| 2. 访客发布会污染共享演示状态 | 成立 | session 独立 project / release 指针；Reset 递增 generation；全局预算不可由 Reset 重置 |
| 3. Sandbox 生命周期、鉴权与配额 | 主要事实成立；命名消除所有不确定窗口的说法过强 | 显式非持久化、image、外部 access token、清理策略；保留命令启动不确定窗口 |
| 4. 工程量与降级 | 简化方向成立；精确工期估计缺少实际依据，且旧固定工期已不适用 | Go 单进程、8 个用例、删除事件流、复用 runner；明确部署目标与阶段退出条件 |
| 5. Agent FAIL 与基础设施 ERROR 混淆 | 成立；所有单用例超时都算 FAIL 不正确 | 按来源归类；baseline 的业务失败允许比较，网络 / 平台故障不评分 |
| 6. 非工具行为断言、随机性 | 成立；删规则不能保证必然退化 | 结构化 decision 联合轨迹断言；保存至少 3 次验证结果，说明小样本限制 |
| 7. Playground 不完整 | 接口和数据缺口成立；POST 本身不代表同步；快照不是必需方案 | 显式 202 + 查询接口、固定订单和请求表；保存发布 prompt，省去重复 clone；缓存延后 |
| 8. DB / Temporal 双写与 baseline 时机 | 成立；仅用 WorkflowID 不能恢复从未再次请求的孤儿行 | queued 行作为持久待派发队列，dispatcher 自动扫描；创建时固定 release / SHA |
| 9. heartbeat 与取消 | 长 Activity 情况成立；短轮询 Activity 也可实现恢复，并非所有设计都必须长等待 | 本计划选择长等待 + heartbeat；区分本地子进程退出与远端命令停止 |
| 10. 文件收集与 exactly-once | 方向成立；存在文件即跳过不安全 | 原子写入、完整 schema / 上下文校验、单 attempt 汇总；允许有限重复费用 |
| 11. gate、初始化、相同 SHA、状态混合 | 成立 | 非关键回归只警告；bootstrap 语义；无变更拒绝；拆分 execution / gate / promotion |
| 12. suite 原文、Playground 数据、事件游标 | 成立 | 不可变 suite_versions、playground_requests；首版直接不做 run_events 游标 |
| 13. commit API、鉴权、代理 | 成立 | 缓存允许的 commits、session 授权、异步查询和 Reset；同源代理仍需鉴权与 CSRF |
| 14. Promote 目标由 run 决定 | 简化成立，但来源与完整性检查仍必要 | 从 run 复制产物；run 唯一发布；事务比较 release ID + generation，不只比较 SHA |
| 15. 镜像 / runner 指纹 | 成立 | 固定模型、runner、平台 lockfile、镜像及 Node；只存 repo SHA 不够 |
| 16. 展示与独立仓库一致性 | 成立 | 核心页面移除必显成本卡；用文字区分错误；明确独立 prompt 示例仓库 |

## 不直接采用的建议

1. **把 harness 注入同一个进程就能防伪造**：不是可靠安全边界。若运行任意候选代码，代码仍可能修改共享状态或伪造产物。v1 只读取 prompt 文本，直接避免执行候选代码。
2. **固定 Sandbox 名称就没有不确定窗口**：名称能帮助找回环境，不能让初始化步骤、命令启动和 DB 写入变成原子操作。`getOrCreate` 复用时还应核对原有配置。
3. **仅设置 RejectDuplicate 就解决双写**：它不负责重新发送 DB 中尚未启动的任务。需要持久派发记录和后台重试；运行中冲突与已结束 ID 的复用策略也要分别处理。
4. **安装阶段一律 allow-all**：当前已知 Git 和包源可使用白名单，不必扩宽网络。凭据注入 matcher 不是路径级阻断规则。
5. **每次 Promote 都创建快照**：会加入缓存、失效、存储与清理复杂度。prompt-only 可以直接保存通过评测的 prompt 产物，先复用固定 runner；测量冷启动后再做缓存。
6. **所有 timeout 都算 Agent FAIL**：provider timeout、环境消失和来源不明的超时应为 ERROR，否则会把环境问题当成版本质量差异。

## 官方资料核验

- [Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference)：默认持久化、name / getOrCreate、image、命令重新获取、delete 与快照独立。
- [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication)：本地 OIDC 12 小时；本方案的外部容器使用 access token。不能泛化成任何外部运行环境都绝不可能使用有效 OIDC。
- [Sandbox quotas](https://vercel.com/docs/sandbox/pricing)：评论所列 Hobby 核心数值与目前文档相符；Active CPU 不等于总运行时长，升级套餐也需预算控制。
- [Sandbox firewall](https://vercel.com/docs/sandbox/concepts/firewall)：动态网络策略、凭据注入及 matcher 不阻断请求的语义。
- [Temporal heartbeats](https://docs.temporal.io/design-patterns/long-running-activity)：长 Activity 的及时故障发现和取消。
- [Temporal Workflow IDs](https://docs.temporal.io/workflow-execution/workflowid-runid)：运行中 ID 冲突和结束后复用是不同策略。
- [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)：未认证 REST 调用通常按 IP 每小时 60 次。

本次完成的是文档与设计核验，没有运行 Sandbox、部署基础设施或证明上述恢复机制已经实现。

## 第二轮核验与处理

| 建议 | 判断 | 当前决策 |
| --- | --- | --- |
| 创建 run 前读取一次 prompt，baseline 取 release | 成立，是此前计划的实质不一致 | Go 控制层按固定 SHA 读取 / 命中缓存；事务内固定 baseline 与 hash，之后只注入产物 |
| runner 用 esbuild 单文件打包，Sandbox 不安装依赖 | 采纳，但需要实际验证依赖可打包 | 构建时产出固定 bundle；无 node_modules 的目标 Node 环境 smoke test；Sandbox 仅放行模型目标 |
| 环境指纹只剩 bundle hash | 部分成立 | bundle hash 可标识打包的代码及依赖，但仍须保存 Node、镜像、模型、suite / gate；构建来源单独追溯 |
| 固定 runner 的异常不应算 candidate FAIL | 成立 | 业务断言之外只有四类执行 FAIL；未分类异常为 Harness ERROR；wall-clock 超时统一 Infra ERROR |
| B 要提前在演示 session 的项目里通过 | 成立 | 写明 B 预跑、A 现场运行、B Promote 的顺序及失效条件；session / cookie TTL 均为 7 天 |
| 预算无需预留与释放账本 | 采纳 | 单行全局累计计数，按 job 最坏额度加权；接纳后不退款，幂等请求不重复计数 |
| bearer token 可以省去 CSRF | 有条件成立，不代表整体更省事 | 保留 HttpOnly cookie，加 Origin 与自定义请求头，无独立 CSRF token 服务；避免新增浏览器 token 保存策略 |
| 先实测两类关键故障 | 采纳为端到端实验范围 | Worker 重启、Sandbox 丢失；gate / 发布 / 权限 / 计数仍做必要自动化检查，其余故障窗口注明未验证 |
| v1 的 Sandbox 主要为后续不可信代码执行铺路 | 基本成立 | 写明现阶段主要是运行环境与资源生命周期隔离，不夸大候选代码安全收益 |
| v2 只换 harness 和工具代理，架构不变 | 不能承诺 | 编排 / 执行分层可复用，但候选代码、凭据、可信证据和网络策略仍需专项设计 |

### 重要边界

- “读取一次”是冻结一次逻辑产物，不表示网络请求永远不会重试。幂等请求命中原 run 后不重新解析移动的 ref。
- esbuild 对原生模块、动态加载和运行时资源存在限制，单文件产物必须在目标环境验证；不能因成功打包就声称运行不依赖外部文件。
- 取消 Git / npm 网络请求后，仍有文件传输、进程启动、排队与模型延迟，不能把全部冷启动成本归结为 VM 创建。
- 非法工具参数是模型行为，记录后返回给模型；平台异常不是模型行为。最终输出 schema 可做固定次数修复，两侧一致，所有修复计入资源上限。
- wall-clock 超时记 Infra ERROR 是保守产品规则，不是关于所有超时根因的事实判断。
- 全局计数必须与 job 创建在同一事务中，weight 包含有限重试的最坏额度；仅限制任务数量却允许任务无限调用模型不构成预算控制。
- 预跑 B 不保证未来永远可发布：session、release / generation、suite / gate 和产物有效性都必须通过检查。

### 本轮来源

- [GitHub Git Trees](https://docs.github.com/en/rest/git/trees)、[Git Blobs](https://docs.github.com/en/rest/git/blobs)：按确切版本定位普通文件并读取内容。
- [esbuild bundling](https://esbuild.github.io/api/#bundle)：代码打包与 Node 依赖限制。
- [Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference)：通过控制 API 写文件并执行命令。
- [OWASP CSRF custom headers](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)：基于自定义头与受限跨域策略的 API 防护。

本轮仍只修改和检查设计文档，未运行 bundle、模型或 Sandbox；相关 smoke test 保持待实施。
