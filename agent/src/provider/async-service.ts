/**
 * Async Service base — generic framework layer.
 *
 * Sibling of the sync MCP service (see `annotate` in provider/index.ts).
 * Any async business (annotation-review, data-validation, CDA reporting, ...)
 * plugs in as a `serviceName` + optional handler. Task state lives in the
 * invite-service (the central task bus) so a provider restart does not lose
 * work-in-progress, and the web dashboard can show it.
 *
 * This file does not know anything about annotation. It only knows:
 *   - how to enqueue a task into the invite-service
 *   - how to query task state
 *   - how to run a worker loop that polls pending tasks and hands them to
 *     registered handlers (opt-in; off by default)
 */
import { INVITE_SERVICE_URL } from "../shared/config.js";
import * as log from "../shared/logger.js";

export type AsyncTaskStatus = "pending" | "accepted" | "working" | "completed" | "failed" | "cancelled";

export interface AsyncTask {
  id: string;
  agentId: string;
  providerAddress: string;
  providerDid: string | null;
  serviceName: string;
  clientAddress: string;
  clientDid: string | null;
  payload: unknown;
  status: AsyncTaskStatus;
  result: unknown | null;
  error: string | null;
  note: string | null;
  createdAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Standard service descriptor fields — shared across sync and async services.
 * Put in a profile's `syncServices` or `asyncServices` so any client can
 * decide how to invoke a business service without hardcoding provider quirks.
 */
export interface StandardServiceFields {
  /** Stable business identifier (e.g. "annotation", "annotation-review"). */
  name: string;
  description: string;
  /** Which agent protocol delivers this service. Future-proofs for A2A. */
  protocol: "mcp" | "a2a";
  /** Human-readable turnaround hint for UI (e.g. "~2s", "1-5 min", "human-confirmed"). */
  avgTurnaround?: string;
  /** Machine-readable expected total turnaround. Used to pace client polling, like HTTP 202 `Retry-After`. */
  estimatedSeconds?: number;
  /** Optional JSON schemas so generic clients can pack args / parse results. */
  inputSchema?: unknown;
  outputSchema?: unknown;
}

/** Sync service: one MCP tool call blocks and returns the result. */
export interface SyncServiceDescriptor extends StandardServiceFields {
  /** MCP tool to call. Arguments shaped by `inputSchema`; response is the result itself. */
  mcpTool: string;
}

/** Async service: submit a task, poll for completion. Tool names are standardized. */
export interface AsyncServiceDescriptor extends StandardServiceFields {
  /** Tool used to submit a task. Standardized to "submit_task" but overridable. */
  submitTool: string;
  /** Tool used to fetch task state. Standardized to "get_task". */
  getTool: string;
  /** Tool used to list tasks. Standardized to "list_tasks". */
  listTool: string;
}

/**
 * Compute a recommended polling interval for a client, based on the declared
 * `estimatedSeconds`. Mirrors the spirit of HTTP's `Retry-After` header.
 *   - default 10s if no estimate
 *   - otherwise ~1/3 of the estimate, clamped to [5s, 60s]
 */
export function recommendRetryAfterSeconds(estimatedSeconds?: number): number {
  if (!estimatedSeconds || estimatedSeconds <= 0) return 10;
  return Math.max(5, Math.min(60, Math.round(estimatedSeconds / 3)));
}

export type AsyncTaskHandler = (task: AsyncTask) => Promise<{ result: unknown } | { error: string }>;

export interface SubmitTaskArgs {
  serviceName: string;
  payload: unknown;
  providerAddress: string;
  agentId?: string;
  providerDid?: string;
  clientAddress?: string;
  clientDid?: string;
  note?: string;
}

// ── HTTP client against invite-service ──────────────────────────

export async function submitTask(args: SubmitTaskArgs): Promise<AsyncTask> {
  const res = await fetch(`${INVITE_SERVICE_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: args.agentId || "",
      providerAddress: args.providerAddress,
      providerDid: args.providerDid || null,
      serviceName: args.serviceName,
      clientAddress: args.clientAddress || "",
      clientDid: args.clientDid || null,
      payload: args.payload ?? null,
      note: args.note || null,
    }),
  });
  if (!res.ok) throw new Error(`submitTask failed: HTTP ${res.status} — ${await res.text()}`);
  return await res.json() as AsyncTask;
}

export async function getTask(taskId: string): Promise<AsyncTask | null> {
  const res = await fetch(`${INVITE_SERVICE_URL}/tasks/${encodeURIComponent(taskId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getTask failed: HTTP ${res.status}`);
  return await res.json() as AsyncTask;
}

export async function listTasks(query: Record<string, string | undefined> = {}): Promise<{ total: number; counts: Record<AsyncTaskStatus, number>; tasks: AsyncTask[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const res = await fetch(`${INVITE_SERVICE_URL}/tasks?${params.toString()}`);
  if (!res.ok) throw new Error(`listTasks failed: HTTP ${res.status}`);
  return await res.json() as { total: number; counts: Record<AsyncTaskStatus, number>; tasks: AsyncTask[] };
}

async function transitionTask(taskId: string, action: "accept" | "work" | "complete" | "fail" | "cancel", body: Record<string, unknown> = {}): Promise<AsyncTask> {
  const res = await fetch(`${INVITE_SERVICE_URL}/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${action} failed: HTTP ${res.status} — ${await res.text()}`);
  return await res.json() as AsyncTask;
}

// ── Service + handler registry ──────────────────────────────────

/** Standard tool names for the async invocation pattern. Overridable per service. */
export const ASYNC_DEFAULTS = Object.freeze({
  protocol: "mcp" as const,
  submitTool: "submit_task",
  getTool: "get_task",
  listTool: "list_tasks",
});

export class AsyncServiceRegistry {
  private services = new Map<string, AsyncServiceDescriptor>();
  private handlers = new Map<string, AsyncTaskHandler>();

  /**
   * Declare an async service. Only `name` and `description` are required;
   * `protocol` / tool names default to the standard async invocation pattern
   * (MCP `submit_task` / `get_task` / `list_tasks`).
   */
  declare(service: Partial<AsyncServiceDescriptor> & Pick<AsyncServiceDescriptor, "name" | "description">): void {
    const full: AsyncServiceDescriptor = {
      protocol: service.protocol ?? ASYNC_DEFAULTS.protocol,
      submitTool: service.submitTool ?? ASYNC_DEFAULTS.submitTool,
      getTool: service.getTool ?? ASYNC_DEFAULTS.getTool,
      listTool: service.listTool ?? ASYNC_DEFAULTS.listTool,
      ...service,
    };
    this.services.set(full.name, full);
  }

  /** Register an optional auto-handler. Without one, tasks wait for a human
   *  (web inbox) or an external system to complete them. */
  handle(serviceName: string, handler: AsyncTaskHandler): void {
    this.handlers.set(serviceName, handler);
  }

  descriptors(): AsyncServiceDescriptor[] {
    return Array.from(this.services.values());
  }

  hasHandler(serviceName: string): boolean {
    return this.handlers.has(serviceName);
  }

  getHandler(serviceName: string): AsyncTaskHandler | undefined {
    return this.handlers.get(serviceName);
  }
}

// ── Worker loop (opt-in via ASYNC_AUTO_PROCESS=true) ────────────

export interface WorkerOptions {
  providerAddress: string;
  registry: AsyncServiceRegistry;
  intervalMs?: number;
}

export function startAsyncWorker(opts: WorkerOptions): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 3000;
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const { tasks } = await listTasks({
        providerAddress: opts.providerAddress,
        status: "pending",
        limit: "20",
      });
      for (const task of tasks) {
        const handler = opts.registry.getHandler(task.serviceName);
        if (!handler) continue; // no handler — leave for human processing
        try {
          await transitionTask(task.id, "accept");
          await transitionTask(task.id, "work");
          log.info(`[async-worker] Running ${task.serviceName} task ${task.id}`);
          const outcome = await handler(task);
          if ("error" in outcome) {
            await transitionTask(task.id, "fail", { error: outcome.error });
            log.info(`[async-worker] Task ${task.id} failed: ${outcome.error}`);
          } else {
            await transitionTask(task.id, "complete", { result: outcome.result });
            log.info(`[async-worker] Task ${task.id} completed`);
          }
        } catch (err: any) {
          try { await transitionTask(task.id, "fail", { error: err.message || String(err) }); } catch {}
          log.info(`[async-worker] Task ${task.id} error: ${err.message}`);
        }
      }
    } catch (err: any) {
      // Invite service might be briefly unreachable; swallow and retry next tick
      log.info(`[async-worker] Poll error: ${err.message}`);
    } finally {
      running = false;
    }
  }

  const handle = setInterval(tick, intervalMs);
  // First tick without waiting
  setTimeout(tick, 500);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
