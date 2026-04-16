# Demo 展示流程 & 待解决问题

## 展示流程

### 0. Provider 注册（DID 优先）

Provider（服务提供者）先注册身份、声明服务，最后注册 Agent ID。

1. **注册 DID** — 通过 DIDRegistrar.register() 注册 Codatta DID（链上身份）
2. **添加 Service 到 DID Document** — 将 MCP/A2A 服务端点写入 DID Document（代表在 Codatta 提供服务）
3. **验证服务** — 验证 MCP 端点可用，工具完备（annotate, get_task_status）
4. **注册 Agent ID** — 在 ERC-8004 IdentityRegistry 注册 agentId，填入已有 DID（不重复注册），建立双向链接

Web Dashboard 和 Provider 程序都支持此流程。Provider 程序首次启动时可自动完成全部步骤。

### 1. Client 发现服务

Agent 需要数据服务（如标注），去 ERC-8004 市场查找。

- **Agent 用户**：通过 ERC-8004 IdentityRegistry 搜索，按 description 匹配、Reputation 筛选
- **人类用户**：可能通过搜索引擎、推荐等渠道到达 Codatta 官网（不在本 Demo 范围）

找到 Provider 后，读取注册文件获取 MCP/A2A endpoint。

### 2. Client 与 Provider 交互

按 Demo 演示流程：A2A 咨询 → 了解服务 → 获取邀请码 → 注册 DID → claim 免费额度 → MCP 调用标注服务 → 提交评价。

**待解决问题：**

| 问题 | 说明 | 状态 |
|------|------|------|
| **Client 是否需要接入 SDK** | 当前 Demo 用 MCP SDK（TypeScript），通用性有限。如果要求所有 Client 都用 Codatta SDK，就意味着 Codatta 的数据服务协议需要成为标准；如果用通用 MCP SDK 就行，则门槛低但 Codatta 特有功能（邀请码、免费额度）需要额外对接 | 需要决策 |
| **Agent 没有钱包地址** | 不是所有 Agent 都有钱包。没有钱包的 Agent 怎么注册 DID？怎么支付？怎么接收 feedbackAuth？需要一个钱包托管或代理机制 | Blocker |
| **注册后的 DID 怎么用** | Agent 注册了 DID 后，这个 DID 在后续交互中怎么传递？怎么证明"我是这个 DID 的持有者"？当前 Demo 只是传一个字符串，没有签名验证 | 需要设计 |
| **DID 的有效性管理** | DID 注册后是否永久有效？能否撤销？谁有权管理？当前 DID 由注册者的钱包 owner 控制，但 Agent 的 owner 可能变更 | 需要设计 |

### 3. 招募 Provider 加入 Codatta

Recruiter Agent 在 ERC-8004 上发现外部 Agent，通过 A2A 发起招募对话：能力确认 → 测试任务 → 质量评估 → 邀请注册。

**待解决问题：**

| 问题 | 说明 | 状态 |
|------|------|------|
| **Agent 自动化完成注册** | 招募过程中，外部 Agent 需要注册 DID、注册 ERC-8004、设置 MCP endpoint。这些操作是否需要 Agent 的 owner（人类）确认？纯自动化有安全风险（签名链上交易） | 需要决策 |
| **Owner 确认机制** | 建议：Agent 收到招募邀请后，通知 owner（通过 Web Dashboard 或其他渠道），owner 在 Web 上确认后才执行注册。这需要 Web 端支持"待确认的招募请求"功能 | 需要设计 |
| **Web 展示招募状态** | Provider Dashboard 应该展示：收到的招募邀请、待确认的操作、已完成的入池状态 | 需要实现 |

### 4. Agent 注册后的能力升级

Agent 注册后，不应该要求 owner 写代码来对接 Codatta 服务。理想情况是 Agent 自动升级。

**待解决问题：**

| 问题 | 说明 | 状态 |
|------|------|------|
| **Codatta CLI / SDK** | 需要提供一个 CLI 工具或 SDK，Agent 安装后自动具备 Codatta 服务能力（注册 DID、暴露 MCP tools、处理邀请码等）。类似 `npm install @codatta/agent-sdk` | 需要开发 |
| **自动配置 MCP Server** | SDK 安装后应自动启动 MCP Server，暴露标准 tools（annotate、get_task_status、claim_invite），无需 owner 手动配置 | 需要设计 |
| **Agent 能力热更新** | Codatta 新增服务类型时（如从标注扩展到验证），已注册的 Agent 是否能自动获得新能力？还是需要手动升级 SDK？ | 需要设计 |

### 5. Provider Agent 选择服务和提供能力

Agent 进入 Codatta 后，需要选择提供哪些服务，并具备相应能力。

**待解决问题：**

| 问题 | 说明 | 状态 |
|------|------|------|
| **服务选择机制** | Agent 怎么声明"我要提供标注服务"？是注册时选择，还是后续在 Dashboard 配置？需要 Web 端支持服务类型勾选 | 需要设计 |
| **能力要求** | 不同服务对 Agent 的能力要求不同。标注服务需要什么？算力？标注模型？人工团队？这些要求是否需要在注册时验证？ | 需要定义 |
| **算力 vs 人力** | Agent 提供的是 AI 算力（模型推理）还是协调人力（众包标注）？两者的接入方式、质量保证、定价模式完全不同 | 需要决策 |
| **能力证明** | Agent 声称能做 object-detection，怎么证明？当前 Demo 通过测试任务验证，但生产环境需要更完善的能力认证体系 | 需要设计 |

## Blockers 汇总

| # | Blocker | 影响范围 | 优先级 |
|---|---------|---------|--------|
| 1 | **无钱包 Agent 的注册和支付** | Client + Provider 都受影响 | P0 |
| 2 | **Codatta Agent SDK / CLI** | Provider 接入体验 | P0 |
| 3 | **Owner 确认机制** | 招募流程的安全性 | P1 |
| 4 | **DID 身份验证（签名证明）** | 所有交互的可信度 | P1 |
| 5 | **服务选择和能力要求定义** | Provider 入池流程 | P1 |
| 6 | **数据服务协议是否需要成为标准** | 整体架构方向 | P2（战略决策） |

## 当前已实现 vs 待实现

```
展示流程                          当前状态
─────────────────────────────────────────────────
1. Client 发现服务
   └─ ERC-8004 搜索              ✅ Web Services 页面
   └─ 读取注册文件                ✅ Agent Detail 页面

2. Client 与 Provider 交互
   └─ A2A 咨询                   ✅ 已实现
   └─ 邀请码 + DID 注册           ✅ 已实现
   └─ MCP 标注                   ✅ 已实现
   └─ Reputation 评价             ✅ 已实现
   └─ 无钱包 Agent 支持           ❌ Blocker #1
   └─ DID 签名验证                ❌ Blocker #4

3. 招募 Provider
   └─ Recruiter 发现 + A2A 沟通   ✅ 已实现
   └─ 测试任务 + 质量评估          ✅ 已实现
   └─ Owner 确认机制              ❌ Blocker #3
   └─ Web 招募状态展示             ❌ 需要实现

4. Agent 能力升级
   └─ Codatta SDK / CLI           ❌ Blocker #2
   └─ 自动配置 MCP Server          ❌ 需要开发

5. Provider 选择服务
   └─ 服务类型选择 UI              ❌ 需要设计
   └─ 能力要求定义                 ❌ 需要定义
   └─ 能力认证体系                 ❌ 需要设计
```
