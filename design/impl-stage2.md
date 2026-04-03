# Stage 2：生态聚合 — 标准驱动的生态扩展

## 目标

定义 ERC-8004 上的数据服务标准，集成 Codatta 完整角色体系，设计生态参与者的引入路径和激励机制。将 Codatta 从"一个数据平台"转变为"数据服务标准的制定者和基础设施提供者"。

## 一、数据服务标准

### 1.1 能力声明格式

ERC-8004 注册文件的 `description` 是自由文本，Client 无法结构化筛选。Codatta 数据服务标准在注册文件中增加一个约定的 `services` 条目，声明结构化能力：

```json
{
  "services": [
    {
      "name": "codatta-data-service",
      "endpoint": "https://agent.example/mcp",
      "version": "1.0.0",
      "capabilities": {
        "serviceTypes": ["annotation", "validation", "data-collection"],
        "dataFormats": ["image/jpeg", "image/png", "text/csv"],
        "taskTypes": ["object-detection", "segmentation", "classification", "ner"],
        "qualityTier": "standard",
        "maxBatchSize": 10000,
        "avgTurnaround": "24h"
      }
    }
  ]
}
```

**字段定义**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `serviceTypes` | string[] | 支持的服务类型（annotation, validation, data-collection, data-cleaning） |
| `dataFormats` | string[] | 可处理的数据格式（MIME type） |
| `taskTypes` | string[] | 具体任务类型（object-detection, segmentation, classification, ner, ocr 等） |
| `qualityTier` | string | 质量等级（basic, standard, premium） |
| `maxBatchSize` | number | 单次最大处理量 |
| `avgTurnaround` | string | 平均交付时间 |

> 注意：这些字段放在 `services` 条目中，不修改 ERC-8004 标准格式，任何不认识 `codatta-data-service` 的 Client 可以忽略。

### 1.2 标准 MCP Tool 规范

定义数据服务领域的标准 MCP Tool 集合，所有实现 Codatta 标准的 Agent 都应暴露这些 tool：

**核心 Tool 集**：

#### `annotate` — 数据标注

```json
{
  "name": "annotate",
  "description": "Label data with specified annotation task type",
  "inputSchema": {
    "properties": {
      "data": { "type": "array", "items": { "type": "string" }, "description": "Data URLs" },
      "taskType": { "type": "string", "enum": ["object-detection", "segmentation", "classification", "ner", "ocr"] },
      "labels": { "type": "array", "items": { "type": "string" }, "description": "Label taxonomy" },
      "guidelines": { "type": "string", "description": "Annotation guidelines URL or text" }
    },
    "required": ["data", "taskType"]
  }
}
```

#### `validate` — 数据验证

```json
{
  "name": "validate",
  "description": "Validate data quality or annotation accuracy",
  "inputSchema": {
    "properties": {
      "data": { "type": "array", "items": { "type": "string" }, "description": "Data URLs to validate" },
      "annotations": { "type": "array", "items": { "type": "object" }, "description": "Annotations to verify" },
      "criteria": { "type": "object", "description": "Validation criteria (accuracy threshold, etc.)" }
    },
    "required": ["data"]
  }
}
```

#### `get_task_status` — 任务状态查询

```json
{
  "name": "get_task_status",
  "description": "Query the status of an async task",
  "inputSchema": {
    "properties": {
      "taskId": { "type": "string", "description": "Task ID returned by annotate/validate" }
    },
    "required": ["taskId"]
  }
}
```

#### `get_pricing` — 报价查询

```json
{
  "name": "get_pricing",
  "description": "Get pricing for a data service task",
  "inputSchema": {
    "properties": {
      "taskType": { "type": "string" },
      "dataCount": { "type": "number", "description": "Number of data items" },
      "qualityTier": { "type": "string", "enum": ["basic", "standard", "premium"] }
    },
    "required": ["taskType", "dataCount"]
  }
}
```

### 1.3 质量评估框架

定义标注质量的量化标准，写入 ERC-8004 Validation Registry：

**质量指标**：

| 指标 | 类型 | 说明 |
|------|------|------|
| `accuracy` | 0-100 | 标注准确率 |
| `consistency` | 0-100 | 标注一致性（同一数据多次标注的吻合度） |
| `completeness` | 0-100 | 标注完整性（是否遗漏目标） |
| `timeliness` | 0-100 | 是否按时交付 |

**Validation 记录格式**：

```
requestHash: keccak256(taskId + data_hash)
response: 综合质量分 (0-100)
tag: "annotation" / "validation" / "data-collection"
responseUri: 指向详细质量报告（JSON）
```

**质量报告结构**：

```json
{
  "taskId": "task-001",
  "metrics": {
    "accuracy": 95,
    "consistency": 88,
    "completeness": 92,
    "timeliness": 100
  },
  "sampledItems": 50,
  "totalItems": 1000,
  "issues": [
    { "type": "mislabel", "count": 12, "severity": "minor" }
  ]
}
```

## 二、Codatta 角色体系集成

### 2.1 角色与 Agent 的映射

Stage 1 中 Provider Agent 是一个整体。Stage 2 将其拆分为多个角色，各自有独立的 DID：

```
Provider Agent（对外统一入口）
├── Frontier Owner — 定义标注规范、标签体系、质量要求
├── Annotator — 执行实际标注
│   ├── AI Agent（自动标注）
│   └── Human（人工标注）
├── Validator — 抽检标注质量
└── Frontier Operator — 管理任务分发和进度
```

**对外**：Client 只看到一个 Provider Agent（在 ERC-8004 上的一个 agentId）。
**对内**：Codatta 平台根据角色分配子任务，每个参与者有自己的 DID。

### 2.2 内部任务分发

```
Client → Provider Agent (MCP: annotate)
  └─ Provider 收到任务
  └─ 查询 Frontier 配置（标签体系、质量要求）
  └─ 分发子任务给 Annotator（按能力匹配、按信誉排序）
  └─ Annotator 完成标注
  └─ 分发验证任务给 Validator
  └─ Validator 抽检，生成质量报告
  └─ 汇总结果 → 返回 Client
  └─ 更新各参与者的 Codatta 内部信誉
  └─ 更新 ERC-8004 Reputation/Validation（Provider 级别）
```

### 2.3 DID 与角色的关系

| 角色 | DID 注册 | 在 8004 上可见 | 说明 |
|------|---------|---------------|------|
| Provider Agent | ✅ | ✅ | 对外的服务入口 |
| Frontier Owner | ✅ | ❌ | 内部管理角色 |
| Annotator | ✅ | 可选 | 可独立在 8004 注册，也可只在 Codatta 内部 |
| Validator | ✅ | 可选 | 同上 |

## 三、A2A 协议设计 — 外部 Agent 招募

Stage 1 用 MCP 解决了"Client 调用确定性工具"的问题。Stage 2 需要解决"主动把外部 Agent 拉进来"的问题 — 这涉及能力协商、资质验证、条件谈判等多轮交互，正是 A2A 的场景。

### 3.1 Codatta Recruiter Agent

Codatta 部署一个专门的 **Recruiter Agent**，负责在 ERC-8004 上发现外部数据服务 Agent 并主动发起招募。

**Agent Card**（发布在 `/.well-known/agent.json`）：

```json
{
  "name": "Codatta Recruiter",
  "description": "Recruits data service agents into the Codatta ecosystem. Offers real task demand, payment, and reputation building.",
  "skills": [
    {
      "name": "recruit-provider",
      "description": "Evaluate and onboard external data service agents"
    },
    {
      "name": "capability-assessment",
      "description": "Assess agent capabilities via test tasks"
    }
  ],
  "capabilities": {
    "streaming": false,
    "pushNotifications": true
  }
}
```

### 3.2 招募流程（A2A 多轮对话）

```
Codatta Recruiter                          外部 Agent
       │                                        │
       │  1. 在 ERC-8004 发现 Agent               │
       │     读取 description，判断是数据服务       │
       │                                        │
       │  2. A2A: SendMessage (招募邀请)           │
       │ ──────────────────────────────────────→ │
       │  "我们有真实的标注任务和付费需求，         │
       │   感兴趣接入 Codatta 生态吗？"             │
       │                                        │
       │  3. Agent 回复意向                       │
       │ ←────────────────────────────────────── │
       │  "有兴趣，我支持 object-detection，       │
       │   日处理量 5000 张"                       │
       │                                        │
       │  4. 能力确认 + 条件协商                   │
       │ ──────────────────────────────────────→ │
       │  "请完成测试任务验证质量，                 │
       │   通过后按 $0.05/张结算"                  │
       │                                        │
       │  5. 发送测试任务                         │
       │ ──────────────────────────────────────→ │
       │  Task: { images: [...], task: "object-detection" }
       │                                        │
       │  6. 返回测试结果                         │
       │ ←────────────────────────────────────── │
       │  Artifact: { annotations: [...] }       │
       │                                        │
       │  7. 质量评估通过 → 引导注册               │
       │ ──────────────────────────────────────→ │
       │  "质量达标，请注册 Codatta DID             │
       │   并实现标准 MCP Tool 接入任务池"          │
       │                                        │
       │  8. Agent 注册 DID + 接入                 │
       │ ←────────────────────────────────────── │
       │  "已注册 DID: did:codatta:xxx，           │
       │   MCP endpoint: https://..."             │
       │                                        │
       │  9. 确认入池，开始分发任务                 │
       │ ──────────────────────────────────────→ │
       │  status: completed                      │
       │                                        │
```

### 3.3 A2A 消息设计

**Message 1 — 招募邀请**：

```json
{
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Hi, I'm Codatta Recruiter. We have real demand for object-detection annotation tasks with paid rewards. Would you be interested in joining the Codatta data service ecosystem?"
        },
        {
          "type": "data",
          "data": {
            "action": "recruit",
            "ecosystem": "codatta",
            "taskTypes": ["object-detection", "segmentation"],
            "rewardModel": "per-item",
            "estimatedVolume": "10000 images/week"
          }
        }
      ]
    }
  }
}
```

**Message 2 — 测试任务**：

```json
{
  "method": "SendMessage",
  "params": {
    "taskId": "recruit-test-001",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Please complete this test task to verify your annotation quality."
        },
        {
          "type": "data",
          "data": {
            "action": "test-task",
            "images": ["https://codatta.io/test/img-001.jpg", "https://codatta.io/test/img-002.jpg"],
            "taskType": "object-detection",
            "labels": ["car", "pedestrian", "traffic-light"],
            "expectedAccuracy": 80
          }
        }
      ]
    }
  }
}
```

**Message 3 — 注册引导**：

```json
{
  "method": "SendMessage",
  "params": {
    "taskId": "recruit-test-001",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Test passed (accuracy: 92%). Please register a Codatta DID and set up your MCP endpoint following our standard."
        },
        {
          "type": "data",
          "data": {
            "action": "onboard",
            "testResult": { "accuracy": 92, "passed": true },
            "didRegistrarContract": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
            "mcpToolSpec": "https://codatta.io/standards/data-service/mcp-tools.json",
            "rewardRate": "$0.05/image"
          }
        }
      ]
    }
  }
}
```

### 3.4 Task 状态流转

```
招募任务生命周期：

  working (Recruiter 发起邀请)
     │
     ├→ input-required (等待 Agent 回复意向)
     │     │
     │     ├→ working (Agent 有兴趣 → 发送测试任务)
     │     │     │
     │     │     ├→ input-required (等待测试结果)
     │     │     │     │
     │     │     │     ├→ working (评估测试质量)
     │     │     │     │     │
     │     │     │     │     ├→ completed (通过 → 引导注册 → 入池)
     │     │     │     │     └→ rejected (质量不达标)
     │     │     │     │
     │     │     │     └→ failed (Agent 无法完成测试)
     │     │     │
     │     │     └→ canceled (Agent 中途放弃)
     │     │
     │     └→ rejected (Agent 不感兴趣)
     │
     └→ failed (Agent 无响应)
```

### 3.5 A2A vs MCP 的分工

| 场景 | 协议 | 说明 |
|------|------|------|
| Client 调用标注服务 | **MCP** | 参数确定，一次调用 |
| Client 查询报价/能力 | **MCP** | get_pricing / tools/list |
| Codatta 招募外部 Agent | **A2A** | 多轮协商，能力评估，条件谈判 |
| Agent 之间协作分工 | **A2A** | 任务拆分，质量沟通 |
| 争议处理 | **A2A** | 多轮对话解决质量争议 |

## 四、生态参与者引入路径

### 4.1 外部 Agent 接入（A2A 驱动）

```
Codatta Recruiter 在 ERC-8004 扫描数据服务 Agent
  └─ 通过 A2A 发起招募对话
  └─ 多轮协商：确认能力、发送测试任务、评估质量
  └─ 通过 → 引导注册 Codatta DID
  └─ Agent 按标准实现 MCP Tool
  └─ 在注册文件 services 中声明 codatta-data-service
  └─ 进入 Codatta 任务分发池
  └─ 开始接单、赚取奖励
```

### 4.2 标注者（人）接入

```
标注者想参与 Codatta 标注任务
  └─ 注册 Codatta 账户 + DID
  └─ 选择感兴趣的 Frontier（如图像标注、文本标注）
  └─ 完成入门测试
  └─ 进入任务池，按能力和信誉分配任务
  └─ 完成任务获得奖励（XNY token 或 USDC）
```

## 四、激励机制

### 4.1 奖励来源

| 来源 | 说明 |
|------|------|
| Client 付费 | x402 支付的服务费，按比例分配给参与者 |
| Codatta 平台奖励 | 平台补贴，激励早期参与者 |
| 信誉奖励 | 高信誉 Agent/标注者获得优先派单和额外奖励 |

### 4.2 分配规则

```
Client 支付 $1.00 / 张标注
  ├── Annotator:  70% ($0.70)
  ├── Validator:  10% ($0.10)
  ├── Frontier Owner: 5% ($0.05)
  └── Codatta 平台: 15% ($0.15)
```

> 具体比例由 Frontier Owner 配置，Codatta 平台费率固定。

### 4.3 信誉与激励的联动

| 信誉等级 | 任务优先级 | 单价加成 | 说明 |
|----------|-----------|---------|------|
| 新手（< 50） | 低 | 0% | 入门阶段，分配简单任务 |
| 标准（50-80） | 中 | 0% | 正常分配 |
| 优秀（80-95） | 高 | +10% | 优先分配高价值任务 |
| 专家（> 95） | 最高 | +20% | 分配复杂任务 + 验证任务 |

## 五、技术实现计划

### 5.1 需要新增的合约

| 合约 | 链上职责 | 链下职责 |
|------|---------|---------|
| CodattaRewardPool | 资金托管、按比例自动分配（Annotator/Validator/Frontier Owner/平台） | — |
| CodattaFrontierRegistry | Frontier ID 注册、费率配置、状态（active/paused） | Frontier 的标签体系、标注规范等业务细节 |

> 任务创建、分发、状态管理的业务复杂度高（匹配算法、优先级排序、负载均衡），放链下由 Codatta 平台处理，链上只记录最终结算结果。

### 5.2 需要新增的 MCP Tool

在 Stage 2 的 `annotate` 基础上，增加：

| Tool | 说明 | 阶段 |
|------|------|------|
| `annotate` | 标注任务 | ✅ Stage 2 已实现 |
| `validate` | 验证任务 | 本阶段 |
| `get_task_status` | 查询异步任务状态 | 本阶段 |
| `get_pricing` | 查询报价 | 本阶段 |
| `list_frontiers` | 查询可用的 Frontier 列表 | 本阶段 |
| `get_frontier_info` | 查询 Frontier 详情（标签体系、质量要求） | 本阶段 |

### 5.3 实现优先级

```
P0 — 数据服务标准定义
  └─ 能力声明格式（codatta-data-service）
  └─ 标准 MCP Tool 规范（annotate, validate, get_pricing, get_task_status）
  └─ 质量评估框架（metrics + 质量报告格式）

P1 — A2A 招募机制
  └─ Codatta Recruiter Agent 开发
  └─ Agent Card 发布
  └─ 招募对话流程（邀请→协商→测试→入池）
  └─ 测试任务自动评估

P2 — 角色体系集成
  └─ Provider Agent 内部拆分角色
  └─ 子任务分发逻辑
  └─ 各角色独立 DID 注册

P3 — 激励机制
  └─ 奖励分配合约
  └─ 信誉联动规则
  └─ Frontier 配置管理
```
