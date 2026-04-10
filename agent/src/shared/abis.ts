export const DIDRegistrarABI = [
  "function register() external",
];

export const InviteRegistrarABI = [
  "function registerWithInvite(address inviter, uint256 nonce, bytes signature) external",
  "event InviteRegistered(uint128 indexed identifier, address indexed owner, address indexed inviter, uint256 nonce)",
];

export const DIDRegistryABI = [
  "function addItemToAttribute(uint128 identifier, uint128 operator, string name, bytes value) external",
  "function getDidDocument(uint128 identifier) external view returns (uint128 id, address owner, uint128[] controller, tuple(string name, bytes value)[] kvAttributes, tuple(string name, tuple(bytes value, bool revoked)[] values)[] arrayAttributes)",
  "event DIDRegistered(uint128 identifier, address owner)",
];

export const IdentityRegistryABI = [
  "function register(string tokenUri) external returns (uint256 agentId)",
  "function setMetadata(uint256 agentId, string key, bytes value) external",
  "function getMetadata(uint256 agentId, string key) external view returns (bytes)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function setAgentUri(uint256 agentId, string newUri) external",
  "event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)",
];

export const ReputationRegistryABI = [
  "function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash, bytes feedbackAuth) external",
  "function getScore(uint256 agentId) external view returns (uint256)",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 indexed tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash)",
];

export const ValidationRegistryABI = [
  "function validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash) external",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag) external",
  "function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, bytes32 tag, uint256 lastUpdate)",
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 indexed requestHash)",
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)",
];
