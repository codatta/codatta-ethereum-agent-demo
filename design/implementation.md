# Codatta DID × Ethereum ERC 集成方案

## 愿景

**Codatta 的定位**：成为 **AI Agent 时代数据服务领域的标准制定者和基础设施提供者**。

Codatta 在数据标注、验证、质检等领域有成熟的业务能力和真实的需求市场。通过将这些能力标准化并接入 ERC-8004 Agent 生态，Codatta 可以：

1. **输出标准** — 定义数据服务的结构化能力声明、交互接口、质量评估框架，供整个 Agent 生态复用
2. **标准即入口** — 外部 Agent 想提供数据服务，按 Codatta 标准来 = 到 Codatta 注册 DID、接入工具链和质量体系
3. **吸引生态参与者** — 对 Agent：接入标准 = 进入真实需求市场；对标注者：加入 Codatta = 获得标准化任务收入；对数据需求方：按标准找服务 = 质量有保障

## 目标

通过 Codatta DID 与 ERC-8004、x402 等 Ethereum 标准的结合，产出可运行的 Demo，跑通 Agent 自动发现、接单、执行、结算的完整工作流，验证上述愿景的技术可行性。

## 各标准的角色

| 标准 | 定位 | 与 Codatta 的结合点 |
|------|------|---------------------|
| **Codatta DID** | 独立身份系统 | 标识用户和 Agent，Agent 可同时获得 DID + ERC-8004 双重身份 |
| **ERC-8004** | Agent 发现与信任层 | Codatta Agent 注册身份、积累信誉，外部 Client 通过 8004 发现并评估 Codatta 服务 |
| **x402** | HTTP 原生支付层 | 基于 HTTP 402 状态码，Client 通过标准 HTTP 请求向 Agent 付费并触发服务 |
| **MCP** | 服务接口协议 | Agent 通过 MCP 暴露标准化的数据服务工具，Client 动态发现并调用 |
| **ERC-8021** | 引流归因（Stage 2） | 链上记录交易出处，Stage 2 多平台参与后启用，用于统计各渠道引流并链下发放奖励 |

## 方案层级

本方案分两个层级：

**Layer 1 — Agent 服务基础层**

任何数据服务 Agent 与 ERC-8004 的结合。Agent 注册身份、通过 MCP 暴露服务接口、通过 x402 收费、积累链上信誉。这是通用的，不依赖 Codatta，任何数据服务提供商都可以这样做。

**Layer 2 — Codatta 生态层**

Codatta 在 Layer 1 基础上，通过 ERC-8004 与所有 Agent 建立联系：
- **输出标准** — 定义数据服务的能力声明、交互接口、质量评估框架
- **获取用户** — 通过 A2A 咨询引导 Client 注册 Codatta DID、发放免费额度
- **招募 Provider** — 通过 A2A 招募外部 Agent 接入 Codatta 任务池
- **需求市场** — Codatta 自身有真实任务和付费能力，Agent 接入即可接单

Layer 1 是基础设施，Layer 2 是 Codatta 的商业价值所在。

## 实现阶段

两个 Demo 分别对应两个层级：

> 详细实现方案：[Stage 1 — 服务输出](./impl-stage1.md) | [Stage 2 — 生态聚合](./impl-stage2.md)

### Stage 1：服务输出 — Codatta 数据服务接入 Agent 生态

Codatta Agent 注册到 ERC-8004，对外提供数据标注服务，跑通完整业务闭环。同时通过 MCP Tool 规范推出数据服务标准的初版 — MCP tool 的参数 schema 和返回格式本身就是标准的载体，外部 Agent 按同样的 schema 实现即可兼容。

**流程**（Client 视角）：
1. Client 在 ERC-8004 Identity Registry 中发现 Agent
2. 查看 Agent 的注册文件（名称、描述、服务 endpoints、信誉）
3. 连接 Agent 的 MCP endpoint，`tools/list` 动态发现标注 tool 及参数
4. 调用 `annotate` tool，传入图片列表
5. x402 完成付费
6. Agent 执行标注，返回结果
7. Client 提交 Reputation 评价

**需要实现**：
- [ ] Agent 在 ERC-8004 Identity Registry 注册（遵循 [Registration Metadata 规范](./spec-8004-registration-metadata.md)）
- [ ] Codatta DID 与 ERC-8004 agentId 双向关联（遵循 [DID Service Endpoint 规范](./spec-did-service-endpoint.md)）
- [ ] MCP Server：暴露标准化的数据服务 tool（`annotate` 等），tool 的参数 schema 即为数据服务标准的初版
- [ ] x402 支付集成
- [ ] 服务完成后更新 ERC-8004 Reputation / Validation
- [ ] **Codatta DID 注册引导**：服务完成后引导用户注册 Codatta DID
- [ ] 前端页面展示 Agent 身份和链上信息
- [ ] 端到端集成测试

**DID 注册激励**：

服务完成后引导用户注册 Codatta DID，注册即享：
- **免费额度** — 注册 DID 赠送一定数量的免费标注额度，降低体验门槛
- **信誉积累** — 有 DID 的用户在 Codatta 上积累持久的使用记录和信誉，信誉高的用户享受优先服务和更优价格
- **数据资产关联** — 标注结果和数据指纹关联到 DID，形成可验证的数据资产记录，方便后续复用和溯源

> Demo 实现中，重点落在免费额度赠送：注册 DID 后自动发放免费标注配额。

### Stage 2：生态聚合 — 标准驱动的生态扩展

在 Stage 1 MCP 标准的基础上，完善数据服务标准体系，通过 A2A 协议与外部 Agent 建立协作关系，将其拉入 Codatta 生态。

**为什么是 A2A**：Stage 1 用 MCP 解决了"确定性的工具调用"，但要拉外部 Agent 进来，涉及能力协商、任务分配、质量沟通等多轮交互，这正是 A2A 擅长的场景。Codatta Agent 通过 A2A 主动与外部 Agent 沟通："你能做什么标注？质量标准能满足吗？来注册 DID 接入我们的任务池。"

**外部 Service Provider 接入流程**：
1. Codatta Agent 通过 A2A 发现并联系外部数据服务 Agent
2. 多轮对话协商：确认能力匹配、质量标准、报价
3. 引导外部 Agent 注册 Codatta DID
4. 通过 Codatta 的能力验证（测试任务）
5. 进入 Codatta 任务分发池，接单赚取奖励

**需要实现**：
- [ ] **完善数据服务标准**：在 Stage 1 MCP tool schema 基础上，扩展结构化能力声明、质量评估框架
- [ ] **A2A 协议集成**：Codatta Agent 发布 Agent Card，支持多轮任务协商，主动招募外部 Agent
- [ ] 集成 Codatta 完整角色体系（Maintainer、Data Contributor、Data Consumer 及子类）
- [ ] 外部 Agent 注册和能力验证流程
- [ ] 标注者/验证者的激励机制和任务分发
- [ ] **ERC-8021 App Code**：多平台参与后，引流归因变得有意义

## 架构设计

```
┌──────────────────────────┐                ┌──────────────────────────┐
│      Codatta              │                │      ERC-8004            │
│                          │                │                          │
│  ┌────────────────────┐  │                │  ┌────────────────────┐  │
│  │ Data Production    │  │                │  │ Identity Registry  │  │
│  │ System             │  │                │  │                    │  │
│  │ 标注/验证/质检      │  │                │  │ Reputation Registry│  │
│  └────────────────────┘  │                │  │                    │  │
│  ┌────────────────────┐  │                │  │ Validation Registry│  │
│  │ Reputation Engine  │  │                │  └────────────────────┘  │
│  │ 信誉计算            │  │                │                          │
│  └────────────────────┘  │                │                          │
│  ┌────────────────────┐  │                │                          │
│  │ Task Distribution  │  │                │                          │
│  │ 任务分发 + 激励     │  │                │                          │
│  └────────────────────┘  │                │                          │
│  ┌────────────────────┐  │                │                          │
│  │ Codatta DID        │  │                │                          │
│  └────────────────────┘  │                │                          │
└──────────────┬───────────┘                └──────────────┬───────────┘
               │                                           │
               │          ┌──────────────────┐             │
               └─────────►│     Agent        │◄────────────┘
                          │                  │
                          │  Codatta DID     │
                          │  ERC-8004 agentId│
                          │                  │
                          │  MCP  / x402     │
                          │  A2A             │
                          └──────────────────┘
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

### MCP 标注服务接口

Provider 通过 MCP Server 暴露标注能力，Client 通过 `tools/list` 动态发现，无需预先知道接口定义。

**Tool 定义：**

```json
{
  "name": "annotate",
  "description": "Label images with object detection bounding boxes, semantic segmentation, or classification",
  "inputSchema": {
    "type": "object",
    "properties": {
      "images": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Image URLs to annotate"
      },
      "task": {
        "type": "string",
        "enum": ["object-detection", "segmentation", "classification"],
        "description": "Annotation task type"
      },
      "labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Label set, e.g. ['car', 'pedestrian', 'traffic-light']"
      }
    },
    "required": ["images", "task"]
  }
}
```

Client 连接 MCP endpoint 后，调用 `tools/list` 获取上述定义，即可知道如何调用标注服务。ERC-8004 注册文件的 services 中声明 MCP endpoint 地址。

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

### 数据服务标准（Stage 2 — 核心战略）

Codatta 基于自身在数据标注、验证、质检领域的业务积累，定义**数据服务标准**，使其成为数据领域的行业规范。

**标准内容**（详见 [Stage 2 详细方案](./impl-stage2.md)）：
- **能力声明格式**：结构化地描述 Agent 支持的数据服务类型、可处理的数据格式、质量等级
- **MCP Tool 规范**：数据标注、验证等服务的标准 tool 定义（参数 schema、返回格式）
- **质量评估框架**：标注质量的量化指标、验收标准、争议处理流程

**Codatta 的核心优势**：Codatta 自身就是一个活跃的数据需求市场 — 有真实的标注、验证、数据处理任务，有付费能力，能给提供服务的 Agent 发放奖励。Agent 接入 Codatta 标准，不只是获得一个规范，而是接入一个有真实任务和收入的市场。

**标准如何吸引生态参与者**：

| 角色 | 吸引力 | 路径 |
|------|--------|------|
| **数据服务 Agent** | 接入标准 = 接入 Codatta 的真实需求市场，获得任务和奖励 | 接入 Codatta 标准 → 注册 DID → 使用 Codatta 工具链 |
| **标注者/验证者（人）** | 加入 Codatta = 获得标准化的任务流和收入 | 注册 DID → 参与 Frontier 任务 |
| **数据需求方（Client）** | 按标准找服务 = 质量有保障，Provider 可比较和替换 | 在 8004 上按标准筛选 Agent |
| **其他数据平台** | 实现同一标准 = 接入 Codatta 需求市场和 8004 生态 | 按 Codatta 标准实现接口 |

**适配责任在 Provider 侧**：Client 只面对标准协议，不关心 Provider 背后是 Codatta 还是其他平台。这保证了 Client 侧的可扩展性，也意味着 Codatta 标准一旦被采纳，所有数据服务 Provider 都在 Codatta 定义的规则下竞争。