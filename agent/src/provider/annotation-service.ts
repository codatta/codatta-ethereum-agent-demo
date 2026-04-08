/**
 * Mock Annotation Service API
 *
 * Simulates an external annotation backend (e.g. Codatta Data Production System).
 * In production, replace the base URL to point to the real service.
 *
 * API:
 *   POST /tasks          — Submit annotation task, returns taskId
 *   GET  /tasks/:taskId  — Query task status and results
 */
import express from "express";
import * as log from "../shared/logger.js";

const ANNOTATION_SERVICE_PORT = 4050;

// ── In-memory task store ────────────────────────────────────────

interface AnnotationResult {
  image: string;
  labels: Array<{ class: string; bbox: number[]; confidence: number }>;
}

interface ServiceTask {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  images: string[];
  taskType: string;
  labels?: string[];
  results?: AnnotationResult[];
  createdAt: number;
  completedAt?: number;
}

const tasks = new Map<string, ServiceTask>();

// ── Simulated annotation logic ──────────────────────────────────

function simulateAnnotation(images: string[], taskType: string, labels?: string[]): AnnotationResult[] {
  const defaultLabels = labels || ["car", "pedestrian", "traffic-light"];

  return images.map((img, i) => ({
    image: img,
    labels: defaultLabels.slice(0, 2).map((cls, j) => ({
      class: cls,
      bbox: [
        80 + i * 15 + j * 200,
        120 + i * 10,
        280 + i * 15 + j * 200,
        380 + i * 10,
      ],
      confidence: parseFloat((0.85 + Math.random() * 0.12).toFixed(2)),
    })),
  }));
}

// ── Express server ──────────────────────────────────────────────

export function startAnnotationService(): Promise<string> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());

    // Submit task
    app.post("/tasks", (req, res) => {
      const { images, taskType, labels } = req.body;

      if (!images || !Array.isArray(images) || images.length === 0) {
        res.status(400).json({ error: "images array is required" });
        return;
      }

      const taskId = `svc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const task: ServiceTask = {
        id: taskId,
        status: "queued",
        images,
        taskType: taskType || "object-detection",
        labels,
        createdAt: Date.now(),
      };
      tasks.set(taskId, task);

      log.info(`[annotation-svc] Task created: ${taskId} (${images.length} images, type=${task.taskType})`);

      // Simulate async processing
      setTimeout(() => {
        task.status = "processing";
        log.info(`[annotation-svc] Task processing: ${taskId}`);
      }, 500);

      setTimeout(() => {
        task.results = simulateAnnotation(images, task.taskType, labels);
        task.status = "completed";
        task.completedAt = Date.now();
        log.info(`[annotation-svc] Task completed: ${taskId} (${task.results.length} results)`);
      }, 3000);

      res.status(201).json({ taskId, status: "queued" });
    });

    // Query task
    app.get("/tasks/:taskId", (req, res) => {
      const task = tasks.get(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (task.status === "completed") {
        res.json({
          taskId: task.id,
          status: task.status,
          results: task.results,
          duration: `${((task.completedAt! - task.createdAt) / 1000).toFixed(1)}s`,
        });
      } else {
        res.json({ taskId: task.id, status: task.status });
      }
    });

    // Health
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "codatta-annotation-backend", tasksInMemory: tasks.size });
    });

    app.listen(ANNOTATION_SERVICE_PORT, () => {
      const url = `http://localhost:${ANNOTATION_SERVICE_PORT}`;
      log.info(`[annotation-svc] Mock backend running on ${url}`);
      resolve(url);
    });
  });
}
