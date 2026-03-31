# DID Service Endpoint 规范

## 概述

定义 Codatta DID Document 中如何声明与 ERC-8004 Agent 身份的关联。任何人拿到 Codatta DID 后，可通过此 service endpoint 直接定位到链上 ERC-8004 身份。

## 设计原则

- DID 只负责身份标识，不承载业务信息
- **DID 存储**：id、owner、controller、verificationMethod、service endpoints
- **DID 不存储**：Actor 类型、Role —— 由平台层动态管理
- **与 ERC-8004 的关联**：通过 DID Document 的 `service` 数组添加一条类型为 `ERC8004Agent` 的 service endpoint

## Service Endpoint 格式

DID Document 中的 service endpoint 通过 `DIDRegistry.addItemToAttribute()` 写入，value 为以下 JSON 的 UTF-8 bytes：

```json
{
  "id": "did:codatta:{uuid}#erc8004",
  "type": "ERC8004Agent",
  "serviceEndpoint": "eip155:{chainId}:{identityRegistryAddress}#{agentId}"
}
```

### 字段说明

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `id` | 是 | DID 的 fragment 标识，固定后缀 `#erc8004` | `did:codatta:f9a852f817ff4200...#erc8004` |
| `type` | 是 | 固定为 `ERC8004Agent` | `ERC8004Agent` |
| `serviceEndpoint` | 是 | [CAIP-10](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md) 格式，指向 ERC-8004 IdentityRegistry 中的 agentId | `eip155:1:0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9#42` |

### serviceEndpoint 格式

```
eip155:{chainId}:{identityRegistryAddress}#{agentId}
```

- `eip155` — EVM 链命名空间（CAIP-2）
- `chainId` — 链 ID（如 `1` 为以太坊主网，`8453` 为 Base）
- `identityRegistryAddress` — ERC-8004 IdentityRegistry 合约地址
- `agentId` — Agent 在 IdentityRegistry 中的 token ID

## 写入方式

通过 Codatta DIDRegistry 的 `addItemToAttribute` 方法写入：

```solidity
didRegistry.addItemToAttribute(
    didIdentifier,   // DID 的 uint128 identifier
    didIdentifier,   // operator（自己操作自己）
    "service",       // SystemAttribute.ARRAY_ATTRIBUTE_SERVICE
    serviceEndpointBytes  // JSON 的 UTF-8 bytes
)
```

### TypeScript 示例

```typescript
const serviceEndpoint = JSON.stringify({
  id: `did:codatta:${didIdentifier.toString(16)}#erc8004`,
  type: "ERC8004Agent",
  serviceEndpoint: `eip155:${chainId}:${identityRegistryAddress}#${agentId}`,
});

await didRegistry.addItemToAttribute(
  didIdentifier,
  didIdentifier,
  "service",
  ethers.toUtf8Bytes(serviceEndpoint)
);
```

## 读取方式

通过 `DIDRegistry.getDidDocument()` 获取完整 DID Document，在 `arrayAttributes` 中查找 `name === "service"` 的条目，解析其中 `type === "ERC8004Agent"` 的 service endpoint。

```typescript
const [id, owner, controller, kvAttrs, arrayAttrs] = await didRegistry.getDidDocument(didIdentifier);

const serviceAttr = arrayAttrs.find(a => a.name === "service");
for (const item of serviceAttr.values) {
  if (item.revoked) continue;
  const ep = JSON.parse(ethers.toUtf8String(item.value));
  if (ep.type === "ERC8004Agent") {
    // 解析 serviceEndpoint 获取 chainId、registry 地址、agentId
    const [, chainId, rest] = ep.serviceEndpoint.match(/eip155:(\d+):(.+)/);
    const [registryAddress, agentId] = rest.split("#");
  }
}
```

## 验证流程

Client 拿到一个 Codatta DID 后，验证其 ERC-8004 身份的步骤：

1. 调用 `DIDRegistry.getDidDocument(didIdentifier)` 获取 DID Document
2. 在 service 数组中找到 `type === "ERC8004Agent"` 的条目
3. 解析 `serviceEndpoint` 得到 `chainId`、`identityRegistryAddress`、`agentId`
4. 在对应链上调用 `IdentityRegistry.ownerOf(agentId)` 验证 owner 一致性
5. 读取 Agent URI 文档（`tokenURI`），在 `services` 中找到 `name === "DID"` 的条目，验证其 `endpoint` 与步骤 1 的 DID 一致（参见 [ERC-8004 Registration Metadata 规范](./spec-8004-registration-metadata.md)）
