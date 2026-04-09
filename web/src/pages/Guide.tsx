import { Link } from 'react-router-dom'

export function Guide() {
  return (
    <div>
      <h2>How to Use Codatta Annotation Services</h2>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Step-by-step guide for data annotation using MCP and A2A protocols.
      </p>

      <Step num={1} title="Browse Services">
        <p>Visit the <Link to="/services">Services</Link> page to find annotation agents. Each agent shows:</p>
        <ul>
          <li><strong>MCP</strong> — supports tool-based invocation (recommended)</li>
          <li><strong>A2A</strong> — supports conversational consultation</li>
          <li><strong>Reputation score</strong> — quality track record from previous clients</li>
        </ul>
      </Step>

      <Step num={2} title="Consult via A2A (Optional)">
        <p>Before committing, chat with the agent to understand capabilities and pricing:</p>
        <Code>{`# Run the Client agent with A2A consultation
cd agent
npm run start:client

# The client will:
# 1. Discover agent on ERC-8004
# 2. Fetch Agent Card from A2A endpoint
# 3. Ask about services and pricing
# 4. Receive an invite code for free quota`}</Code>
        <p style={{ fontSize: 13, color: '#666' }}>
          The A2A consultation tells you what the agent can do, how much it costs, and offers you an invite code for free annotations.
        </p>
      </Step>

      <Step num={3} title="Register Codatta DID (Optional)">
        <p>Register a free Codatta DID to unlock benefits:</p>
        <ul>
          <li><strong>Free annotations</strong> — 10 free credits with invite code</li>
          <li><strong>Reputation tracking</strong> — your usage history persists across sessions</li>
          <li><strong>Data asset linking</strong> — annotation results linked to your DID</li>
        </ul>
        <p style={{ fontSize: 13, color: '#666' }}>
          You can skip this step and pay per request via x402 instead.
        </p>
      </Step>

      <Step num={4} title="Call Annotation via MCP">
        <p>Connect to the agent's MCP endpoint and discover available tools:</p>
        <Code>{`// 1. Connect to MCP server
const client = new Client({ name: "my-client", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpEndpoint)));

// 2. Discover tools
const { tools } = await client.listTools();
// → annotate, get_task_status, claim_invite

// 3. Submit annotation task
const result = await client.callTool({
  name: "annotate",
  arguments: {
    images: ["https://example.com/img-001.jpg", ...],
    task: "object-detection",
    clientDid: "did:codatta:xxx"  // optional, for free quota
  }
});
// → { taskId: "task-xxx", status: "working" }

// 4. Poll for results
const status = await client.callTool({
  name: "get_task_status",
  arguments: { taskId: "task-xxx" }
});
// → { status: "completed", annotations: [...] }`}</Code>
      </Step>

      <Step num={5} title="Receive Results">
        <p>The annotation result contains bounding boxes for each image:</p>
        <Code>{`{
  "status": "completed",
  "annotations": [
    {
      "image": "https://example.com/img-001.jpg",
      "labels": [
        { "class": "car", "bbox": [100, 200, 300, 400], "confidence": 0.95 },
        { "class": "pedestrian", "bbox": [400, 150, 500, 450], "confidence": 0.88 }
      ]
    }
  ],
  "feedbackAuth": "0x..."  // use this to submit reputation feedback
}`}</Code>
      </Step>

      <Step num={5} title="Submit Feedback">
        <p>After receiving results, submit a reputation score to help other clients evaluate this agent:</p>
        <Code>{`// Submit feedback to ERC-8004 Reputation Registry
await reputationRegistry.giveFeedback(
  agentId, 92,                              // score 0-100
  encodeBytes32String("annotation"),        // tag1
  encodeBytes32String("quality"),           // tag2
  "ipfs://QmFeedback",                     // feedback URI
  feedbackHash,                             // evidence hash
  feedbackAuth                              // from annotation result
);`}</Code>
      </Step>

      <div style={{ marginTop: 32, padding: 20, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
        <h3 style={{ margin: '0 0 8px' }}>Quick Start</h3>
        <p style={{ margin: '0 0 8px', fontSize: 13 }}>Run the full demo flow in one command:</p>
        <Code>{`# Terminal 1: Start Provider
cd agent && npm run start:provider

# Terminal 2: Start Client (interactive)
npm run start:client`}</Code>
      </div>
    </div>
  )
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24, paddingLeft: 40, position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: 28, height: 28,
        borderRadius: '50%', background: '#4f46e5', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 'bold',
      }}>
        {num}
      </div>
      <h3 style={{ margin: '2px 0 8px' }}>{title}</h3>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: '#374151' }}>{children}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre style={{
      background: '#1e1e1e', color: '#d4d4d4', padding: 14, borderRadius: 6,
      fontSize: 12, lineHeight: 1.5, overflow: 'auto', margin: '8px 0',
    }}>
      {children}
    </pre>
  )
}
