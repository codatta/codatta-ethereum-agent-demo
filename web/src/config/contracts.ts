import deployment from '../../../script/deployment.json'

export const addresses = {
  didRegistry: deployment.didRegistry as `0x${string}`,
  didRegistrar: deployment.didRegistrar as `0x${string}`,
  identityRegistry: deployment.identityRegistry as `0x${string}`,
  reputationRegistry: deployment.reputationRegistry as `0x${string}`,
  validationRegistry: deployment.validationRegistry as `0x${string}`,
}

export const didRegistrarAbi = [
  'function register() external',
  'event DIDRegistered(uint128 identifier, address owner)',
] as const

export const didRegistryAbi = [
  'function addItemToAttribute(uint128 identifier, uint128 operator, string name, bytes value) external',
  'function getDidDocument(uint128 identifier) external view returns (uint128 id, address owner, uint128[] controller, (string name, bytes value)[] kvAttributes, (string name, (bytes value, bool revoked)[] values)[] arrayAttributes)',
  'function ownerOf(uint128 identifier) external view returns (address)',
  'function getOwnedDids(address account) external view returns (uint128[])',
  'event DIDRegistered(uint128 identifier, address owner)',
] as const

export const identityRegistryAbi = [
  'function register(string tokenUri) external returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value) external',
  'function getMetadata(uint256 agentId, string key) external view returns (bytes)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function setAgentUri(uint256 agentId, string newUri) external',
  'event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)',
] as const

export const reputationRegistryAbi = [
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash, bytes feedbackAuth) external',
  'function getScore(uint256 agentId) external view returns (uint256)',
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 indexed tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash)',
] as const

export const validationRegistryAbi = [
  'function validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag) external',
  'function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, bytes32 tag, uint256 lastUpdate)',
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 indexed requestHash)',
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)',
] as const
