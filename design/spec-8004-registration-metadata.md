# ERC-8004 Registration Metadata 规范

## 概述

定义 Codatta Agent 在 ERC-8004 IdentityRegistry 中注册时使用的 Registration Metadata 文档结构。该文档遵循 [ERC-8004 标准](https://eips.ethereum.org/EIPS/eip-8004) 定义的注册文件格式，是 Client 发现和了解 Agent 的主要入口。

## ERC-8004 标准格式

ERC-8004 规定 agentURI 必须解析为一个注册文件，包含以下标准字段：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `type` | 是 | string | 固定为 `"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` |
| `name` | 是 | string | Agent 名称 |
| `description` | 是 | string | Agent 的自然语言描述，包含能力、工作方式、定价、交互方式等 |
| `image` | 是 | string | Agent 图片 URL |
| `services` | 是 | array | 服务端点数组，声明 Agent 的通信协议入口 |
| `active` | 是 | boolean | Agent 是否在线 |
| `registrations` | 是 | array | Agent 在各 Registry 中的注册信息 |
| `supportedTrust` | 否 | string[] | 支持的信任机制（`"reputation"`、`"crypto-economic"`、`"tee-attestation"` 等） |
| `x402Support` | 否 | boolean | 是否支持 x402 支付协议 |

### services 数组

每个条目代表同一个 Agent 的**不同通信协议入口**（不是不同的业务能力）：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `name` | 是 | string | 协议名称（`"web"`、`"A2A"`、`"MCP"`、`"ENS"`、`"DID"` 等） |
| `endpoint` | 是 | string | 协议入口地址 |
| `version` | 否 | string | 协议版本 |

### registrations 数组

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `agentId` | 是 | string | Agent 在 Registry 中的 ID |
| `agentRegistry` | 是 | string | Registry 合约地址 |

## Codatta Agent 注册文件

Codatta Agent 遵循 ERC-8004 标准格式，通过以下方式声明 Codatta 相关信息：

- **`description`**：描述 Agent 的业务能力（标注、验证、指纹上链等）
- **`services`**：在标准协议入口之外，添加 `name: "DID"` 条目声明 Codatta DID

### 完整示例

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Codatta Annotation Agent",
  "description": "AI agent for image annotation in the Codatta data production ecosystem. Supports object detection labeling, semantic segmentation, and classification. Capable of processing large-scale datasets with quality assurance.",
  "image": "https://codatta.io/agents/annotation/avatar.png",
  "services": [
    {
      "name": "web",
      "endpoint": "https://codatta.io/agent/annotation"
    },
    {
      "name": "A2A",
      "endpoint": "https://codatta.io/a2a/annotation",
      "version": "0.3.0"
    },
    {
      "name": "MCP",
      "endpoint": "https://codatta.io/mcp/annotation",
      "version": "2025-06-18"
    },
    {
      "name": "DID",
      "endpoint": "did:codatta:f9a852f817ff42009e9ddcd913a6183c",
      "version": "v1"
    }
  ],
  "active": true,
  "registrations": [
    {
      "agentId": "132693510534879506498117509529564156019",
      "agentRegistry": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
    }
  ],
  "supportedTrust": ["reputation"],
  "x402Support": false
}
```

### 字段使用说明

**`description` — Agent 能力描述**

ERC-8004 标准中，Agent 的业务能力通过 `description` 字段以自然语言描述。Client 通过阅读 description 来判断 Agent 是否匹配需求。

建议包含以下信息：
- Agent 所属的生态/平台（如 Codatta）
- 可执行的任务类型（如 image annotation、data validation、semantic segmentation）
- 擅长的领域（如 object detection、classification labeling）

**`services` — 通信协议入口**

`services` 中的每个条目是 Agent 的一个通信入口，不代表不同的业务。标准定义的 `name` 值包括：

| name | 说明 | Codatta 使用 |
|------|------|-------------|
| `web` | Web 页面入口 | Agent 的 Codatta 主页 |
| `A2A` | Google A2A 协议 | Agent 的 A2A agent card |
| `MCP` | Anthropic MCP 协议 | Agent 的 MCP 服务端 |
| `DID` | 去中心化身份 | **Codatta DID 标识符** |
| `ENS` | 以太坊域名 | 可选 |

Codatta DID 通过标准的 `DID` service 条目声明，`endpoint` 值为 DID 标识符（如 `did:codatta:f9a852f8...`）。

## 存储方式

### 链上存储（Demo / 小文档）

编码为 data URI，直接存储在链上 agentURI 中：

```
data:application/json;base64,{base64编码的JSON}
```

```typescript
const doc = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Codatta Demo Annotator",
  description: "AI agent specialized in data annotation...",
  // ...
};
const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;
await identityRegistry.register(uri);
```

### 链下存储（生产环境）

使用 IPFS 或 HTTPS URL：

```
ipfs://QmXxx...
https://codatta.io/agents/{agentId}/registration.json
```

## 读取方式

```typescript
// 获取 agentURI
const uri = await identityRegistry.tokenURI(agentId);

// 解析注册文件
let doc;
if (uri.startsWith("data:application/json;base64,")) {
  const base64 = uri.replace("data:application/json;base64,", "");
  doc = JSON.parse(Buffer.from(base64, "base64").toString());
} else {
  doc = await fetch(uri).then(r => r.json());
}

// 读取 Agent 信息
console.log(doc.name);           // Agent 名称
console.log(doc.description);    // 能力描述
console.log(doc.active);         // 是否在线

// 找到 Codatta DID
const didService = doc.services.find(s => s.name === "DID");
if (didService) {
  console.log(didService.endpoint);  // did:codatta:f9a852f8...
}

// 找到 A2A 入口
const a2aService = doc.services.find(s => s.name === "A2A");
if (a2aService) {
  // 通过 A2A 协议与 Agent 进一步沟通
}
```

## 文档更新

Agent 信息变更时，通过 `IdentityRegistry.setAgentUri()` 更新：

```typescript
const newDoc = { ...doc, active: false };
const newUri = `data:application/json;base64,${Buffer.from(JSON.stringify(newDoc)).toString("base64")}`;
await identityRegistry.setAgentUri(agentId, newUri);
```

## 域名验证（可选）

ERC-8004 支持通过 `.well-known` 文件验证 Agent 对 endpoint 域名的控制权：

```
https://{endpoint-domain}/.well-known/agent-registration.json
```

该文件内容应与 agentURI 解析出的注册文件一致。
