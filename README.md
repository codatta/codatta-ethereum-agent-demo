# Codatta DID × ERC-8004 × x402 Integration Demo

Codatta DID 与 ERC-8004 (Trustless Agents)、x402 (HTTP-native Payments) 的集成 Demo。以数据标注服务为业务场景，展示 Agent 自动发现、接单、执行、结算的完整工作流。

## 架构

```
Client Agent                          Provider Agent
     │                                      │
     │  1. 从 ERC-8004 发现 Agent            │  注册 Codatta DID
     │     读取注册文件、信誉                  │  注册 ERC-8004 身份
     │                                      │  双向关联 DID ↔ ERC-8004
     │  2. POST /annotate                   │  启动 HTTP 标注服务
     │ ────────────────────────────────────→ │
     │                                      │  执行标注（模拟）
     │  3. 返回标注结果 + feedbackAuth        │  更新链上 Validation
     │ ←──────────────────────────────────── │
     │                                      │
     │  4. 提交 Reputation 评价              │
     │                                      │
```

| 标准 | 用途 |
|------|------|
| **Codatta DID** | Agent 的独立身份标识 |
| **ERC-8004** | Agent 发现（Identity Registry）+ 信誉（Reputation）+ 验证（Validation） |
| **x402** | HTTP 原生支付（当前 demo 为 mock 模式，部署测试网后接入真实 facilitator） |

## 项目结构

```
src/
├── did/              # Codatta DID 合约（DIDRegistry + DIDRegistrar, UUPS proxy）
├── erc8004/          # ERC-8004 三大 Registry（Identity, Reputation, Validation）
└── mock/             # MockERC20

script/
├── Deploy.s.sol      # 一键部署
└── deployment.json   # 部署地址（自动生成）

agent/
└── src/
    ├── shared/       # 共享代码（config, ABIs, events, logger, feedback-auth）
    ├── provider/     # Provider Agent（注册身份 → 启动 HTTP 服务 → 执行标注）
    └── client/       # Client Agent（发现 Agent → 请求标注 → 提交评价）

design/               # 设计文档和规范
```

## 快速开始

### 1. 启动本地链

```bash
anvil --block-time 1
```

### 2. 部署合约

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

部署地址自动写入 `script/deployment.json`。

### 3. 配置 Agent

```bash
cd agent
cp .env.example .env
npm install
```

将 `script/deployment.json` 中的地址填入 `.env`：

```env
DID_REGISTRY=0x...
DID_REGISTRAR=0x...
IDENTITY_REGISTRY=0x...
REPUTATION_REGISTRY=0x...
VALIDATION_REGISTRY=0x...
```

### 4. 启动 Provider（终端 1）

```bash
npm run start:provider
```

等待输出 `Annotation service running on http://localhost:4021`。

### 5. 启动 Client（终端 2）

```bash
npm run start:client
```

Client 自动完成：发现 Agent → 请求标注 → 接收结果 → 提交评价。

## Demo 输出示例

**Provider:**
```
[PROVIDER] Registering Codatta DID
[PROVIDER] Codatta DID: did:codatta:c038300d50f74a18...
[PROVIDER] Registering agent in ERC-8004
[PROVIDER] Agent ID: 328490439698981969...
[PROVIDER] Linking DID ↔ ERC-8004
[PROVIDER] ✓ Dual identity established
[PROVIDER] ✓ Annotation service running on http://localhost:4021
[PROVIDER] ⚡ Request received — 3 images, task=object-detection
[PROVIDER] ✓ Annotation complete: 3 images
[PROVIDER] Validation updated on-chain
```

**Client:**
```
[CLIENT] Discovering agent from ERC-8004
[CLIENT] Agent name: Codatta Annotation Agent
[CLIENT] x402 support: true
[CLIENT] ✓ Service endpoint: http://localhost:4021
[CLIENT] Submitting 3 images for object detection...
[CLIENT] ✓ Annotation received: 3 images
[CLIENT]   street-001.jpg: car(0.95), pedestrian(0.88)
[CLIENT] ✓ Feedback submitted: score=92
[CLIENT] Reputation Score: 92
```

## 技术栈

- **Solidity** ^0.8.20 + **Foundry** (forge/anvil)
- **TypeScript** + **ethers.js** v6 + **Express**
- **OpenZeppelin** Contracts v5 (含 Upgradeable)
