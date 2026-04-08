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
    ├── provider/     # Provider Agent（注册身份 → MCP/HTTP 标注服务）
    ├── client/       # Client Agent（发现 Agent → MCP 调用 → 提交评价）
    ├── recruiter/    # Recruiter Agent（A2A 招募外部 Agent）
    └── query/        # 查询工具（DID、Agent info、Reputation、Validation）

web/                  # Web Dashboard（React + Vite + wagmi）
└── src/
    ├── config/       # 合约地址 + ABI + wagmi 链配置
    ├── pages/        # Agent 列表/详情、DID 文档、注册页面
    ├── components/   # Layout、ConnectButton
    ├── hooks/        # useAgentList、useAgentDetail、useDIDDocument
    └── lib/          # 工具函数（解析注册文件等）

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

## Stage 2：A2A 招募（生态聚合）

Codatta Recruiter Agent 通过 A2A 协议主动招募外部数据服务 Agent，完成能力评估、质量验证、DID 注册、入池的完整流程。

### 启动 Recruiter（终端 1）

```bash
npm run start:recruiter
```

### 启动 External Agent（终端 2）

```bash
npm run start:external
```

External Agent 自动完成招募对话：

```
[EXTERNAL] Recruiter: Welcome! ... What annotation types do you support?
[EXTERNAL] Recruiter: Let's verify your quality with a quick test task.
[EXTERNAL] Test task received: yes
[EXTERNAL] Submitting 2 annotated images...
[EXTERNAL] ✓ Test passed! Accuracy: 92%
[EXTERNAL] Registering Codatta DID
[EXTERNAL] ✓ Onboarded into Codatta!
[EXTERNAL] Status: active, Task Pool: annotation
```

### 查询链上数据

```bash
# 自动读取 agent-info.json
npm run query

# 或指定 agentId
npm run query -- <agentId>
```

## Web Dashboard

可视化展示 Agent 身份、DID 文档、信誉评分、验证记录，支持注册 DID 和 Agent。

### 启动前端

```bash
cd web
npm install
npm run dev
```

浏览器打开 http://localhost:5173

### 页面

| 路径 | 功能 |
|------|------|
| `/` | Agent 列表（从链上事件枚举） |
| `/agent/:id` | Agent 详情（注册文件、services、信誉、验证、DID 关联） |
| `/did/:hex` | DID 文档查看 |
| `/register-did` | 一键注册 Codatta DID（需连接钱包） |
| `/register-agent` | 三步注册 Agent：DID → ERC-8004 → 双向关联（需连接钱包） |

> 需要先运行 Provider + Client 填充链上数据，Dashboard 才有内容展示。连接钱包使用 MetaMask，需添加 Anvil 网络（chainId: 31337, RPC: http://127.0.0.1:8545）。

## 技术栈

- **Solidity** ^0.8.20 + **Foundry** (forge/anvil)
- **TypeScript** + **ethers.js** v6 + **Express**（Agent 端）
- **React** + **Vite** + **wagmi** + **viem**（Web Dashboard）
- **MCP** — @modelcontextprotocol/sdk（服务接口发现与调用）
- **A2A** — @a2a-js/sdk（Agent 间多轮协作）
- **OpenZeppelin** Contracts v5 (含 Upgradeable)
