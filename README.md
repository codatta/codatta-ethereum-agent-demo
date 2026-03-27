# Codatta DID × Ethereum ERC Integration Demo

Codatta DID 与 ERC-8004 (Trustless Agents)、ERC-8183 (Agentic Commerce) 的集成 Demo，展示 Agent 在 Ethereum 生态中的完整生命周期：注册身份 → 接受任务 → 执行工作 → 验收结算 → 链上验证 → 信誉评价。

## 各标准角色

| 标准 | 定位 |
|------|------|
| **Codatta DID** | 独立身份系统，标识用户和 Agent |
| **ERC-8004** | Agent 发现与信任层（Identity + Reputation + Validation Registry） |
| **ERC-8183** | 任务市场 + 任务级结算（Client-Provider-Evaluator） |

## 项目结构

```
src/                              # Solidity 合约
├── erc8004/                      # ERC-8004 三大 Registry
├── erc8183/                      # ERC-8183 任务市场 + Codatta Hook
├── mock/                         # MockERC20 测试 Token
└── AppCode.sol                   # ERC-8021 AppCode Tracker（可选）

test/
└── DemoIntegration.t.sol         # 全流程集成测试

script/
├── Deploy.s.sol                  # 一键部署脚本
└── deployment.json               # 部署地址（自动生成）

agent/                            # TypeScript Demo Agents
├── src/
│   ├── shared/                   # 共享代码（config, ABIs, events, logger）
│   ├── provider/index.ts         # Provider Agent（注册→接单→执行→验证）
│   ├── client/index.ts           # Client Agent（发布任务→资助→评价）
│   ├── evaluator/index.ts        # Evaluator Agent（验收→验证响应）
│   └── index.ts                  # 顺序模式（单进程跑全流程）
```

## 快速开始

### 运行测试

```bash
forge test -vvv
```

### 运行 Demo（3 个独立 Agent）

**1. 启动本地链**

```bash
anvil --block-time 1
```

**2. 部署合约（新终端）**

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

部署地址自动写入 `script/deployment.json`。

**3. 安装依赖**

```bash
cd agent
cp .env.example .env
npm install
```

**4. 启动 3 个 Agent（3 个终端）**

```bash
# 终端 1: Evaluator（纯监听，最先启动）
npm run start:evaluator

# 终端 2: Provider（注册身份后监听）
npm run start:provider

# 终端 3: Client（创建任务，触发整个流程）
# 等 Provider 显示 "Listening for jobs..." 后启动
npm run start:client
```

### 顺序模式（单进程）

```bash
npm start
```

## Demo 流程（Event 驱动）

```
Provider                     Client                      Evaluator
   |                            |                            |
   | 注册 ERC-8004 身份          |                            | 监听中...
   | 监听中...                   |                            |
   |                            | 创建任务 + 资助 1000 XNY    |
   |                            |                            |
   | ⚡ JobCreated              |                            |
   | ⚡ JobFunded               |                            |
   | 模拟工作 → 提交             |                            |
   |                            |                            | ⚡ JobSubmitted
   |                            |                            | 验收 → 资金分配
   | ⚡ JobCompleted             | ⚡ JobCompleted             |   925 → Provider
   | 请求验证                    |                            |    50 → Evaluator
   | 签名 feedbackAuth           | 读取 feedbackAuth           |    25 → Treasury
   |                            | 提交评价 score=90           |
   |                            |                            | ⚡ ValidationRequest
   |                            |                            | 响应 score=85
```

## 角色与地址

| 角色 | 私钥来源 | 说明 |
|------|---------|------|
| **Provider** | `DEPLOYER_PRIVATE_KEY` | Agent NFT owner，注册身份、执行工作、请求验证、签 feedbackAuth |
| **Client** | `CLIENT_PRIVATE_KEY` | 发布任务、资助任务、提交信誉评价 |
| **Evaluator** | `EVALUATOR_PRIVATE_KEY` | 验收任务、提交验证响应 |

> ERC-8004 规定 Agent owner 不能给自己写评价，因此 feedback 由 Client 提交，但需要 Provider 签名授权（feedbackAuth）。

## 技术栈

- **Solidity** ^0.8.20 + **Foundry** (forge/anvil)
- **TypeScript** + **ethers.js** v6
- **OpenZeppelin** Contracts v5
