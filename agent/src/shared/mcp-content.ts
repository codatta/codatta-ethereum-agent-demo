/**
 * MCP `tools/call` returns `{ content: ContentItem[] }` where each item has
 * `{ type: "text" | ..., ... }`. The SDK types `content` as `unknown` post
 * v1.x, so callers need a small narrowing helper. This is the one helper —
 * inline narrowing kept getting copy-pasted.
 */

interface TextItem {
  type: "text";
  text: string;
}

function isTextItem(c: unknown): c is TextItem {
  return typeof c === "object" && c !== null
    && (c as { type?: unknown }).type === "text"
    && typeof (c as { text?: unknown }).text === "string";
}

/**
 * Pull the first `text` content item, JSON-parse it. Returns the parsed
 * value, or the raw string if it isn't valid JSON, or null if no text item.
 *
 * Returns `any` rather than `unknown`: demo callers index into the parsed
 * shape directly (`.status`, `.error`, ...), and these are throwaway demo
 * scripts — runtime shape comes from the provider, not a static contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTextContent(content: unknown): any {
  if (!Array.isArray(content)) return null;
  const text = content.find(isTextItem);
  if (!text) return null;
  try { return JSON.parse(text.text); } catch { return text.text; }
}
