# Stage 1：服务输出 — Codatta 数据服务接入 Agent 生态

## 目标

Codatta Agent 注册到 ERC-8004，以数据标注为业务场景，跑通 Agent 自动发现→接口发现→付费→执行→评价的完整工作流。

## 架构

```
Client Agent                              Provider Agent
     │                                         │
     │  1. ERC-8004 发现 Agent                  │  注册 DID + ERC-8004
     │     解析注册文件，找到 MCP endpoint       │  双向关联 DID ↔ ERC-8004
     │                                         │
     │  2. MCP: tools/list                     │  MCP Server (port 4022)
     │ ───────────────────────────────────────→ │    tool: annotate
     │ ←─ annotate tool schema ─────────────── │
     │                                         │
     │  3. MCP: tools/call annotate            │
     │ ───────────────────────────────────────→ │
     │     (x402: 402 → 付款 → 重试)           │  HTTP Server (port 4021)
     │                                         │    POST /annotate (REST 备用)
     │  4. 执行标注（模拟/调用 Codatta 后端）    │
     │                                         │  更新 ValidationRegistry
     │  5. 返回标注结果 + feedbackAuth          │
     │ ←─────────────────────────────────────── │
     │                                         │
     │  6. ReputationRegistry.giveFeedback()    │
     │                                         │
```

## 一、合约层

**需要部署的合约：**

| 合约 | 说明 | 状态 |
|------|------|------|
| DIDRegistry（UUPS proxy） | Codatta DID 注册、文档存储、service endpoint 管理 | ✅ 已实现 |
| DIDRegistrar | DID 注册工厂，生成 UUIDv4 identifier | ✅ 已实现 |
| IdentityRegistry | ERC-8004 Agent 注册，tokenURI 存储注册文件 | ✅ 已实现 |
| ReputationRegistry | ERC-8004 信誉评价存储 | ✅ 已实现 |
| ValidationRegistry | ERC-8004 验证记录存储 | ✅ 已实现 |

**部署脚本**：`script/Deploy.s.sol`
- DIDRegistry 通过 ERC1967Proxy 部署（UUPS 模式）
- DIDRegistrar 部署后，调用 `didRegistry.updateRegistrars()` 授权
- 部署地址写入 `script/deployment.json`

## 二、身份注册

### Provider Agent 注册流程

**文件**：`agent/src/provider/index.ts`

```
Step 1: 注册 Codatta DID
  └─ 调用 DIDRegistrar.register()
  └─ 从 DIDRegistered event 获取 didIdentifier

Step 2: 注册 ERC-8004 Agent
  └─ 构建标准注册文件（遵循 ERC-8004 registration-v1 格式）
  └─ Base64 编码为 data URI
  └─ 调用 IdentityRegistry.register(agentURI)
  └─ 从 Registered event 获取 agentId
  └─ 更新注册文件（补充 registrations 字段）
  └─ 调用 setAgentUri() 更新

Step 3: 双向关联 DID ↔ ERC-8004
  └─ ERC-8004 → DID: setMetadata(agentId, "codatta:did", encode(didIdentifier))
  └─ DID → ERC-8004: addItemToAttribute(didIdentifier, "service", serviceEndpointJSON)
```

**注册文件格式**（遵循 [ERC-8004 Registration Metadata 规范](./spec-8004-registration-metadata.md)）：

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Codatta Annotation Agent",
  "description": "AI agent for image annotation...",
  "image": "https://codatta.io/agents/annotation/avatar.png",
  "services": [
    { "name": "web", "endpoint": "http://localhost:4021" },
    { "name": "MCP", "endpoint": "http://localhost:4022/mcp", "version": "2025-06-18" },
    { "name": "DID", "endpoint": "did:codatta:{hex}", "version": "v1" }
  ],
  "active": true,
  "registrations": [{ "agentId": "...", "agentRegistry": "0x..." }],
  "supportedTrust": ["reputation"],
  "x402Support": true
}
```

**DID Service Endpoint 格式**（遵循 [DID Service Endpoint 规范](./spec-did-service-endpoint.md)）：

```json
{
  "id": "did:codatta:{hex}#erc8004",
  "type": "ERC8004Agent",
  "serviceEndpoint": "eip155:{chainId}:{identityRegistry}#{agentId}"
}
```

### Client Agent 发现流程

**文件**：`agent/src/client/index.ts`

```
Step 1: 获取 agentId（Demo 中通过 agent-info.json 模拟市场发现）

Step 2: 读取链上注册文件
  └─ IdentityRegistry.tokenURI(agentId) → agentURI
  └─ 解析 Base64 JSON → 注册文件
  └─ 读取 name、description、services、x402Support 等

Step 3: 验证 DID 关联（可选）
  └─ 从 services 中找到 name="DID" → did:codatta:{hex}
  └─ 调用 DIDRegistry.getDidDocument(didIdentifier)
  └─ 在 service 数组中找到 type="ERC8004Agent"
  └─ 验证 serviceEndpoint 中的 agentId 一致
```

## 三、MCP 标注服务

### MCP Server（Provider 端）

**端口**：4022（MCP endpoint），4021（HTTP REST 备用）

**传输协议**：Streamable HTTP（JSON-RPC 2.0 over HTTP POST）

**实现方式**：每个 MCP session 创建独立的 McpServer 实例和 StreamableHTTPServerTransport，避免多连接冲突。

**暴露的 Tool：**

```
annotate
├── 参数
│   ├── images: string[]        (必填) 图片 URL 列表
│   ├── task: enum              (必填) "object-detection" | "segmentation" | "classification"
│   ├── labels: string[]        (可选) 自定义标签集
│   └── clientAddress: string   (可选) Client 钱包地址，用于生成 feedbackAuth
├── 返回
│   └── text content: JSON string
│       ├── status: "completed"
│       ├── annotations: [{ image, labels: [{ class, bbox, confidence }] }]
│       ├── agentId: string
│       └── feedbackAuth: hex string
└── 副作用
    └── 更新 ValidationRegistry（validationRequest + validationResponse）
```

**MCP 路由**：

| Method | Path | 说明 |
|--------|------|------|
| POST | /mcp | 处理 JSON-RPC 请求（initialize、tools/list、tools/call） |
| GET | /mcp | SSE 流式响应（带 mcp-session-id header） |
| DELETE | /mcp | 关闭 session |

**Session 管理**：
- 首次 POST（无 session-id）→ 创建新 transport + 新 McpServer 实例 → 返回 session-id
- 后续 POST（带 session-id）→ 复用已有 transport
- DELETE → 清理 transport

### MCP Client（Client 端）

```
Step 1: 从注册文件 services 中找到 name="MCP" → endpoint URL
Step 2: 创建 StreamableHTTPClientTransport → 连接 MCP Server
Step 3: client.listTools() → 发现 annotate tool 及参数 schema
Step 4: client.callTool({ name: "annotate", arguments: { images, task, clientAddress } })
Step 5: 解析返回的 JSON → 标注结果 + feedbackAuth
Step 6: client.close()
```

## 四、x402 支付集成

**当前状态**：Mock 模式（本地 Anvil 无法使用真实 x402 facilitator）

**生产环境实现方案**：

Provider 端（Express middleware）：
```typescript
import { paymentMiddleware } from "@x402/express";

app.use(paymentMiddleware({
  "POST /annotate": {
    accepts: [{
      scheme: "exact",
      price: "$0.05",              // 每张图 $0.05
      network: "eip155:84532",     // Base Sepolia
      payTo: providerAddress,
    }],
    description: "Image annotation service",
  },
}, resourceServer));
```

Client 端（x402 fetch wrapper）：
```typescript
import { wrapFetchWithPayment } from "@x402/fetch";

const fetchWithPayment = wrapFetchWithPayment(fetch, x402Client);
const response = await fetchWithPayment(endpoint, { method: "POST", body: ... });
// 自动处理 402 → 付款 → 重试
```

**MCP + x402 的集成**：

推荐方案：MCP tool handler 内部调用 x402 保护的 REST endpoint，MCP 和 x402 解耦，各自独立工作。

### 标注任务处理

**Demo 模式**（当前）：同步模拟，2 秒延迟后返回 mock 结果。

**生产模式**：

```
tools/call annotate
  └─ 创建任务 → 返回 taskId
  └─ Client 调用 tools/call get_task_status(taskId)
  └─ 或使用 MCP SSE 流式推送进度
```

## 五、链上信誉更新

### feedbackAuth 机制

ERC-8004 ReputationRegistry 要求评价必须经过 Agent owner 签名授权。

**生成**（Provider 端）：
```typescript
const encoded = abi.encode(
  ["uint256", "address", "uint64", "uint256", "uint256", "address", "address"],
  [agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress]
);
const signature = wallet.signMessage(getBytes(keccak256(encoded)));
return concat([encoded, signature]);
```

**传递**：包含在标注结果响应体中。

### Validation 更新（Provider 端）

```typescript
validationRegistry.validationRequest(validatorAddr, agentId, requestUri, requestHash);
validationRegistry.validationResponse(requestHash, score, responseUri, responseHash, tag);
```

### Reputation 评价（Client 端）

```typescript
reputationRegistry.giveFeedback(agentId, score, tag1, tag2, feedbackUri, feedbackHash, feedbackAuth);
```

## 六、前端页面

> 当前 Demo 为命令行模式，前端页面作为后续补充。

展示 Agent 的身份和链上信息：

- Agent 基本信息（name、description、services）
- Codatta DID 信息（identifier、owner、service endpoints）
- ERC-8004 信息（agentId、Reputation score、Validation 记录）
- 双向关联验证状态

**技术选型**：React + ethers.js，直接读取链上数据。

## 七、部署环境

| 环境 | 链 | x402 | 说明 |
|------|-----|------|------|
| **本地开发** | Anvil (31337) | Mock | 当前 Demo |
| **测试网** | Base Sepolia (84532) | 真实 facilitator | 需要测试网 USDC |
| **主网** | Base (8453) | 生产 facilitator | 真实付费 |

## 当前实现状态

| 项目 | 状态 |
|------|------|
| 合约部署 | ✅ 已实现 |
| Provider DID + ERC-8004 注册 | ✅ 已实现 |
| DID ↔ ERC-8004 双向关联 | ✅ 已实现 |
| Client 链上发现 | ✅ 已实现 |
| MCP Server（annotate tool） | ✅ 已实现 |
| MCP Client 动态发现 + 调用 | ✅ 已实现 |
| feedbackAuth + Reputation | ✅ 已实现 |
| Validation 更新 | ✅ 已实现 |
| x402 真实支付 | ⬜ 需部署到 Base Sepolia 测试网，获取测试 USDC，接入公共 facilitator |
| 标注任务异步处理 | ⬜ 当前为同步模拟，生产环境需改为异步（返回 taskId + 轮询/回调） |
| 对接 Codatta 真实标注后端 | ⬜ 当前为 mock 数据，需对接 Codatta Data Production System API |
| 前端页面 | ⬜ React + ethers.js，展示 Agent 身份、信誉、Validation 记录 |
| DID 关联验证（Client 端） | ⬜ Client 可选验证 DID ↔ agentId 双向一致性，非必须 |
