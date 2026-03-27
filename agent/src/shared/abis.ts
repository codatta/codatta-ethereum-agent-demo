export const IdentityRegistryABI = [
  "function register(string tokenUri) external returns (uint256 agentId)",
  "function setMetadata(uint256 agentId, string key, bytes value) external",
  "function getMetadata(uint256 agentId, string key) external view returns (bytes)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)",
];

export const ReputationRegistryABI = [
  "function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash, bytes feedbackAuth) external",
  "function getScore(uint256 agentId) external view returns (uint256)",
  "function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 indexed tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash)",
];

export const ValidationRegistryABI = [
  "function validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash) external",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag) external",
  "function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, bytes32 tag, uint256 lastUpdate)",
  "function getSummary(uint256 agentId, address[] validatorAddresses, bytes32 tag) external view returns (uint64 count, uint8 avgResponse)",
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 indexed requestHash)",
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag)",
];

export const ACPContractABI = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) external returns (uint256 jobId)",
  "function setProvider(uint256 jobId, address provider, bytes optParams) external",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams) external",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams) external",
  "function submit(uint256 jobId, string deliverable, bytes optParams) external",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function getJob(uint256 jobId) external view returns (address client, address provider, address evaluator, uint256 expiredAt, uint256 budget, uint8 status, string description, string deliverable)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address provider, address indexed evaluator, uint256 expiredAt, string description, address hook)",
  "event BudgetSet(uint256 indexed jobId, uint256 newBudget)",
  "event JobFunded(uint256 indexed jobId, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, string deliverable)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
  "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
];

export const MockERC20ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
];
