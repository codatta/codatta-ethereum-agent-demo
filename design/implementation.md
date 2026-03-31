# Codatta DID × Ethereum ERC 集成方案

## 目标

通过 Codatta DID 与 ERC-8004、x402 等 Ethereum 标准的结合，让 Codatta 融入 Ethereum Agent 生态，并产出实际可用的展示 Demo——跑通 Agent 自动发现、接单、执行、结算的完整工作流。

## 各标准的角色

| 标准 | 定位 | 与 Codatta 的结合点 |
|------|------|---------------------|
| **Codatta DID** | 独立身份系统 | 标识用户和 Agent，Agent 可同时获得 DID + ERC-8004 双重身份 |
| **ERC-8004** | Agent 发现与信任层 | Codatta 将业务数据（数据血缘、验证结果、用工评价）写入 Registry |
| **x402** | HTTP 原生支付层 | 基于 HTTP 402 状态码，Client 通过标准 HTTP 请求向 Agent 付费并触发服务 |
| **ERC-8021** | 引流归因（待定） | 链上记录交易出处，统计各平台给 Codatta 引流，链下发放奖励。当前场景下使用较牵强，待有明确业务需求时再接入 |

## Demo 规划

### Stage 1：Agent 发现与信任（ERC-8004）

**展示目标**：Client 通过 ERC-8004 发现 Agent，查看其身份信息和服务能力，判断是否合作。

**流程**（Client 视角）：
1. Client 在 ERC-8004 Identity Registry 中搜索/浏览 Agent
2. 查看 Agent 的注册文件（名称、描述、服务 endpoints）
3. 通过 Agent 提供的服务接口查询其可靠性（信誉、历史记录等）
4. 根据 Agent 的能力描述和服务地址，决定是否合作

**需要实现**：
- [ ] Agent 在 ERC-8004 Identity Registry 注册
- [ ] Codatta DID 与 ERC-8004 agentId 的双向关联，确保双向可验证
- [ ] **ERC-8004 Registration Metadata 规范**：定义注册文件的标准字段填写方式
- [ ] **DID Service Endpoint 规范**：DID Document 中声明 ERC-8004 关联（`eip155:{chainId}:{registry}#{agentId}`）
- [ ] 前端页面展示 Agent 的双重身份和链上信息

### Stage 2：数据标注服务（全协议串联）

**展示目标**：以数据标注为具体业务，串联 Codatta DID、ERC-8004、x402 全流程。

**流程**（Client 视角）：
1. Client 通过 ERC-8004 发现标注 Agent（Stage 1 的延续）
2. Client 通过 A2A/MCP 与 Agent 沟通，确认标注类型、参数格式和报价
3. Client 向 Agent 发起 HTTP 请求（POST 图片列表 + 标注要求）
4. Agent 返回 HTTP 402，要求付费
5. Client 通过 x402 完成链上支付
6. Agent 确认收款，执行标注（异步），返回任务 ID
7. Client 轮询或回调获取标注结果
8. Client 向 ERC-8004 Reputation Registry 提交评价

**需要实现**：
- [ ] 完成 Agent 开发（Provider Agent 提供 HTTP 标注服务，Client Agent 发起请求并付费）
- [ ] x402 支付集成：Agent 端实现 402 响应和支付验证，Client 端实现自动付款
- [ ] 标注任务的异步处理机制（任务提交、状态查询、结果返回）
- [ ] **ERC-8021 App Code 嵌入（待定）**：待有明确多平台业务需求时再接入
- [ ] 完成后更新 ERC-8004 Reputation / Validation
- [ ] 端到端集成测试

### Stage 3：生态扩展（后续）

- [ ] 集成 Codatta 完整角色体系（Maintainer、Data Contributor、Data Consumer 及子类），对接现有 Codatta 业务实现
- [ ] **定义数据服务标准**：在 ERC-8004 之上的垂直领域协议层，标准化 Agent 的能力声明、服务接口、质量评估格式，使 Client 在发现阶段即可识别 Agent 的业务能力

## 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                     Codatta 平台层                            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Data Production System (核心业务)                       │  │
│  │ Sample → Label → Validation → Data Asset               │  │
│  │ 数据血缘追踪、数据指纹                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Reputation Engine (链下计算)                            │  │
│  │ 基于历史履约、资产质押、用户行为的综合评分               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────┬────────────────────┘
           │                              │
    业务数据上链                      身份标识
           │                              │
           ▼                              ▼
┌──────────────────────────────┐  ┌──────────────────────────┐
│ ERC-8004 Registry            │  │ Codatta DID              │
│                              │  │                          │
│ Identity Registry (ERC-721)  │  │ - W3C DID 标准           │
│ - Agent 发现、能力声明        │  │ - id (UUIDv4, uint128)  │
│                              │  │ - owner, controller     │
│ Reputation Registry          │  │ - verificationMethod    │
│ - ← 写入用工评价             │  │ - service endpoints     │
│                              │  │                          │
│ Validation Registry          │←─│ DID 通过 service         │
│ - ← 写入验证结果             │  │ endpoint 关联 agentId   │
└──────────────┬───────────────┘  └──────────────────────────┘
               │
        服务完成后回写
        Reputation / Validation
               │
               ▲
┌──────────────┴───────────────┐
│ x402 支付层                   │
│                              │
│ Client ──HTTP 请求──→ Agent  │
│        ←─HTTP 402────        │
│        ──链上支付────→        │
│        ←─执行结果────        │
└──────────────────────────────┘
```

## Codatta 角色体系

### Actor

DID 中的 actor 字段，标识身份持有者的类型：

| Actor | 说明 |
|-------|------|
| **Human** | 自然人用户 |
| **AI Agent** | AI Agent |

### Role

Codatta 业务中的角色，由平台层管理，不写入 DID 基础字段：

| Role | 子类 | 说明 |
|------|------|------|
| **Maintainer** | Codatta, Frontier Owner, Frontier Administer, Frontier Operator | 平台和 Frontier 的管理者 |
| **Data Contributor** | Submitter, Annotator, Validator | 数据贡献者，按贡献类型细分 |
| **Data Consumer** | — | 数据消费者 |

> 具体分工和业务流程后续补充。

## 关键设计决策

### 交互规范

两份规范文档定义了 Codatta DID 与 ERC-8004 之间的双向关联方式：

| 规范 | 方向 | 说明 |
|------|------|------|
| [DID Service Endpoint 规范](./spec-did-service-endpoint.md) | DID → ERC-8004 | DID Document 中声明 ERC-8004 agentId 关联 |
| [ERC-8004 Registration Metadata 规范](./spec-8004-registration-metadata.md) | ERC-8004 → DID | 遵循 ERC-8004 标准注册文件格式，通过 `services` 中的 DID 条目声明 Codatta DID |

两者配合实现双向可验证的身份关联：
- **DID 持有者** → 查 DID service endpoint → 找到链上 agentId
- **agentId 持有者** → 查 Agent URI 文档的 services → 找到 Codatta DID

### Codatta 自有 Reputation 体系

独立于 ERC-8004 Reputation Registry，服务于 Codatta 内部业务决策：

| 维度 | 说明 |
|------|------|
| 在 Codatta 的工作表现 | 数据贡献质量、任务完成率、历史履约 |
| 资产质押情况 | 质押金额、质押时长 |
| 综合计算 | 平台基于大数据分析计算信誉分 |

### x402 与 ERC-8004 的配合

- ERC-8004 负责 Agent 的**发现和信任**（Identity + Reputation + Validation）
- x402 负责**服务的付费和触发**（HTTP 请求级即时支付）
- 服务完成后，结果回写 ERC-8004 的 Reputation 和 Validation Registry

**流程**：
1. Client 通过 ERC-8004 发现 Agent，获取服务 endpoint
2. Client 向 Agent 发起 HTTP 请求
3. Agent 返回 402，Client 通过 x402 链上支付
4. Agent 确认收款，执行服务，返回结果
5. 结果回写 ERC-8004 Reputation / Validation Registry

### ERC-8021 App Code（引流归因）

ERC-8021 的 App Code 用于标识链上交易的出处。不限于 x402 支付场景，Codatta 的任何业务操作都可以携带 App Code 记录归因。

**应用场景示例**：
- x402 服务调用：记录请求来源平台和 Frontier
- 数据上链：记录数据血缘中的贡献来源
- Registry 更新：记录是谁在哪个 Frontier 触发的信誉/验证更新

**实现方式**：Codatta 合约预留 App Code 接口，各业务操作在提交链上交易时携带 App Code。链上只负责记录归因，奖励由链下根据统计数据发放。

> Codatta 合约具体设计待定，Demo 中模拟一个业务场景即可。

### 数据服务标准（Stage 3）

ERC-8004 定义了通用的 Agent 发现与信任层，但不涉及具体业务的能力声明格式、服务接口、质量指标等。Codatta 应在 ERC-8004 之上定义一套**数据服务标准**，使 Client 在发现阶段即可识别 Agent 的业务能力，标准化数据标注、验证等场景的交互方式。

**意义**：
- Client 不需要了解 Codatta 内部细节，按标准发任务即可
- 其他数据服务平台也可实现同一标准，Provider 可互换
- Codatta 从"一个数据平台"变为"数据服务标准的定义者"

**适配责任在 Provider 侧**：外部 ERC-8004 Agent 要接入 Codatta，需要 Provider 适配业务逻辑。Client 只面对标准协议，不关心 Provider 背后是哪个平台。这保证了 Client 侧的可扩展性。