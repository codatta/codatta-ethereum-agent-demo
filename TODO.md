# TODO

## Stage 1：服务输出

### 已完成

- [x] DID 注册 + ERC-8004 注册
- [x] DID ↔ ERC-8004 双向关联
- [x] ERC-8004 标准注册文件（registration-v1）
- [x] MCP 标注服务（annotate、get_task_status）
- [x] A2A 售前咨询 + 邀请码发放
- [x] Client 注册 DID + 免费额度（含接受/拒绝确认）
- [x] 返回用户识别（已注册用户跳过邀请流程）
- [x] Mock 标注后端（独立 HTTP API）
- [x] DID 关联验证（Client 端）
- [x] feedbackAuth + Reputation 评价
- [x] Validation 更新
- [x] 查询工具（npm run query）
- [x] InviteRegistrar 合约（链上邀请码签名验证）
- [x] Invite Service（独立服务，生成签名邀请码，监听事件，API）
- [x] Provider/Client 对接 InviteRegistrar（链上注册替换内存方案）
- [x] Provider 身份持久化（重启跳过注册）
- [x] sync-env.sh（自动同步合约地址到 .env）
- [x] Web Dashboard — 服务目录、Provider 列表、Agent 详情、Provider Dashboard、Invites
- [x] Web — Agent 屏蔽功能（hide/show via Invite Service API）
- [x] Web — XNY 设计系统（Inter 字体、灰色画布、白色卡片、统一 token）
- [x] Invite Service 数据持久化（invite-service-data.json）
- [x] Client 先注册 ERC-8004 agentId（身份前置，含持久化）
- [x] Client 从链上发现 Provider（排除自身，识别 MCP 服务）
- [x] DID 格式统一为 did:codatta:\<uuid\>（UUID v4）
- [x] x402 支付协议（Demo 版：EIP-712 签名 + 手工中间件，在 feat/x402-payment 分支）

### 待实现

- [ ] **x402 真实支付** — 部署到 Base Sepolia，接入公共 facilitator，替换 Demo 版手工实现
- [ ] **接入 x402 Bazaar** — 将 Agent 的 MCP/REST 付费端点发布到 x402 Bazaar，让外部消费方能在 Bazaar 发现并直接付费调用
- [ ] **对接 Codatta 真实标注后端** — 替换 annotation-service.ts 的 mock，指向 Codatta Data Production System API

## Stage 2：生态聚合

### 已完成

- [x] A2A Recruiter Agent（发现、筛选、沟通、招募）
- [x] External Agent 模拟（注册 ERC-8004、响应招募、注册 DID）
- [x] 设计文档（发现策略、沟通流程、邀请注册）

### 待实现

- [ ] **数据服务标准定义** — 结构化能力声明格式、标准 MCP Tool 规范、质量评估框架
- [ ] **Codatta 角色体系集成** — Frontier Owner / Annotator / Validator / Operator
- [ ] **任务分发逻辑** — Provider 内部拆分角色，按能力和信誉分配子任务
- [ ] **CodattaRewardPool 合约** — 资金托管、按比例自动分配
- [ ] **CodattaFrontierRegistry 合约** — Frontier 注册、费率配置
- [ ] **激励机制** — 信誉联动、等级加成
- [ ] **ERC-8021 App Code** — 多平台参与后启用引流归因

## Blockers（来自 design/demo-flow-and-blockers.md）

- [ ] **P0: 无钱包 Agent 的注册和支付** — 钱包托管或代理机制
- [ ] **P0: Codatta Agent SDK / CLI** — Agent 安装后自动具备服务能力，无需 owner 开发代码。CLI 面向人类用户，MCP 面向 Agent，底层共享逻辑
- [ ] **P1: Owner 确认机制** — 招募操作需 owner 在 Web 确认
- [ ] **P1: DID 签名验证** — Agent 证明 DID 持有权
- [ ] **P1: 服务选择和能力要求定义** — Agent 选择提供哪些服务，需要什么能力

## Web Dashboard

- [ ] **BUG: My Agents hidden filter 不生效** — filter 逻辑正确（console log 确认），但 UI 仍显示全部 agent，疑似 React 渲染/状态同步问题
- [ ] **Invite Service 统一管理 Agent 列表** — Provider/Client 从 Invite Service 获取 agent 信息，去掉 agent-info.json 依赖。Web 注册和 Provider 程序注册统一入口
- [ ] **Agent 活跃检测** — Services 页面过滤长期无活动的 Agent（后续，可能需要心跳机制或链上最后活跃时间）
- [ ] **链上数据索引** — 当前从 block 0 遍历事件，生产环境需要索引服务（The Graph 或自建 indexer）

## 代码整理

- [ ] **项目目录结构重组** — 合约移到 contracts/、agent/ 和 web/ 保持不变，Foundry 配置（foundry.toml、remappings.txt、lib/）移入 contracts/，更新所有引用路径（deployment.json、sync-env.sh、web contracts.ts 等）
- [x] **DID 合约回迁 codatta-did repo** — 当前 src/did/ 是从 codatta-did 复制的，InviteRegistrar 也写在这里。需要将改动合并回 codatta-did 项目，这边改为 submodule 引用
