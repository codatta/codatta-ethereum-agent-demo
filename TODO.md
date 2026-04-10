# TODO

## Stage 1：服务输出

### 已完成

- [x] DID 注册 + ERC-8004 注册
- [x] DID ↔ ERC-8004 双向关联
- [x] ERC-8004 标准注册文件（registration-v1）
- [x] MCP 标注服务（annotate、get_task_status、claim_invite）
- [x] A2A 售前咨询 + 邀请码发放
- [x] Client 注册 DID + 免费额度
- [x] Mock 标注后端（独立 HTTP API）
- [x] DID 关联验证（Client 端）
- [x] feedbackAuth + Reputation 评价
- [x] Validation 更新
- [x] 查询工具（npm run query）

### 待实现

- [ ] **x402 真实支付** — 部署到 Base Sepolia，接入公共 facilitator，Client 需测试 USDC
- [ ] **对接 Codatta 真实标注后端** — 替换 annotation-service.ts 的 mock，指向 Codatta Data Production System API
- [ ] **前端页面** — React + ethers.js，展示 Agent 身份、信誉、Validation 记录

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

## 代码整理

- [ ] **DID 合约回迁 codatta-did repo** — 当前 src/did/ 是从 codatta-did 复制的，InviteRegistrar 也写在这里。需要将改动合并回 codatta-did 项目，这边改为 submodule 引用
