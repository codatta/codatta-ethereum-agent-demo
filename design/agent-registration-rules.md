# Agent 注册规范

## 一个 Agent = 一种服务

每个 ERC-8004 agentId 对应一种服务。不要在一个 Agent 里提供多种不相关的服务。

- ✅ 标注 Agent、验证 Agent、数据查询 Agent 各自独立注册
- ❌ 一个 Agent 同时提供标注 + 验证 + 查询

## Description 规范

一句话说清楚：**什么服务 + 谁提供 + 支持的子类型**。

```
"Image annotation service by Codatta. Supports object detection, 
semantic segmentation, and classification for autonomous driving datasets."
```

- 第一句：服务类型 + 品牌
- 第二句：支持的子类型 / 适用场景
- 不要写技术实现细节（MCP/A2A/合约地址）

## A2A 作为自发现机制

外部 LLM Agent 通过 A2A 首轮对话获取完整接入信息。Provider 的 A2A 初始回复必须包含：

1. **服务描述** — 做什么、支持什么任务类型
2. **定价** — 费用、支付方式
3. **MCP 接入** — endpoint URL、可用的 tools 列表、调用方式
4. **注册流程** — 邀请码获取方式、DID 注册方式（含代理注册）
5. **其他服务** — Codatta 生态的其他 Agent（引导发现）

首轮回复同时包含：
- `type: "text"` — 自然语言说明（LLM 可理解）
- `type: "data"` — 结构化数据（程序可解析）

```json
{
  "action": "service-info",
  "mcpEndpoint": "http://...",
  "mcpTools": ["annotate", "get_task_status"],
  "pricing": { "perImage": "$0.05" },
  "inviteRegistrar": "0x...",
  "supportedTasks": ["object-detection", "segmentation", "classification"]
}
```

## 代理注册

Client Agent 可能没有钱包或 ETH。Provider 可以代替 Client 注册 DID：

1. Client 在 A2A 对话中提供 owner 地址（Agent 的 owner 钱包）
2. Provider 调用 Invite Service 获取签名邀请码（指定 owner 地址）
3. Provider 调用 InviteRegistrar.registerFor(owner, inviter, nonce, signature)
4. Provider 支付 gas，DID owner 设为 Client 提供的地址

Client 全程不需要发链上交易。

## Agent Card Skills

Agent Card 的 skills 需要足够描述性，让 LLM Agent 理解每个 skill 的功能：

```json
{
  "skills": [
    {
      "id": "consult",
      "name": "Service Consultation",
      "description": "Ask about annotation capabilities, pricing, supported task types, and how to integrate via MCP"
    },
    {
      "id": "invite",
      "name": "DID Registration",
      "description": "Get an invite code to register a Codatta DID with free annotation credits. Provider can register on behalf of clients without ETH"
    }
  ]
}
```
