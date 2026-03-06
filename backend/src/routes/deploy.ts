import { Router } from "express";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// Active deployments tracking
const activeJobs = new Map<string, { status: string; logs: string[]; instanceId: string }>();

/**
 * POST /api/deploy/provision
 * Triggers clawmacdo deploy for a new OpenClaw instance
 */
router.post("/provision", (req: AuthRequest, res) => {
  const { teamId, name, provider, region, instanceType, anthropicKey, openaiKey, telegramToken, model } = req.body;

  if (!teamId || !name || !provider) {
    res.status(400).json({ error: "teamId, name, and provider required" });
    return;
  }

  const validProviders = ["digitalocean", "tencent", "aws"];
  if (!validProviders.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
    return;
  }

  // Create instance record
  const instanceId = uuid();
  const jobId = uuid();

  db.prepare(`
    INSERT INTO instances (id, team_id, name, provider, region, instance_type, status, agent_model)
    VALUES (?, ?, ?, ?, ?, ?, 'provisioning', ?)
  `).run(instanceId, teamId, name, provider, region || getDefaultRegion(provider), instanceType || getDefaultInstanceType(provider), model || "anthropic/claude-sonnet-4-20250514");

  db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    uuid(), teamId, req.userId, "instance.deploy.started", "instance", instanceId, JSON.stringify({ provider, region, jobId })
  );

  // Build clawmacdo command
  const args = ["deploy", "--provider", provider];
  if (region) args.push("--region", region);
  if (instanceType) args.push("--size", instanceType);

  // Set env vars for clawmacdo
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
  if (openaiKey) env.OPENAI_API_KEY = openaiKey;
  if (telegramToken) env.TELEGRAM_BOT_TOKEN = telegramToken;

  const job = { status: "running", logs: [] as string[], instanceId };
  activeJobs.set(jobId, job);

  // Spawn clawmacdo
  const proc = spawn("clawmacdo", args, { env, stdio: ["ignore", "pipe", "pipe"] });

  proc.stdout.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) job.logs.push(line);

    // Parse IP from output
    const ipMatch = line.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) {
      db.prepare("UPDATE instances SET ip_address = ? WHERE id = ?").run(ipMatch[1], instanceId);
    }

    // Parse hostname
    const hostMatch = line.match(/Hostname:\s*(\S+)/);
    if (hostMatch) {
      db.prepare("UPDATE instances SET hostname = ? WHERE id = ?").run(hostMatch[1], instanceId);
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) job.logs.push(`[stderr] ${line}`);
  });

  proc.on("close", (code: number | null) => {
    if (code === 0) {
      job.status = "completed";
      db.prepare("UPDATE instances SET status = 'online', updated_at = datetime('now') WHERE id = ?").run(instanceId);
      db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(
        uuid(), teamId, req.userId, "instance.deploy.completed", "instance", instanceId
      );
    } else {
      job.status = "failed";
      db.prepare("UPDATE instances SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(instanceId);
      db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        uuid(), teamId, req.userId, "instance.deploy.failed", "instance", instanceId, JSON.stringify({ exitCode: code, lastLogs: job.logs.slice(-5) })
      );
    }

    // Clean up after 1 hour
    setTimeout(() => activeJobs.delete(jobId), 3600000);
  });

  res.status(202).json({ jobId, instanceId, message: "Deployment started" });
});

/**
 * GET /api/deploy/status/:jobId
 * Poll deployment progress
 */
router.get("/status/:jobId", (_req: AuthRequest, res) => {
  const job = activeJobs.get(_req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }
  res.json({ status: job.status, logs: job.logs, instanceId: job.instanceId });
});

/**
 * POST /api/deploy/destroy/:instanceId
 * Destroy an instance via clawmacdo
 */
router.post("/destroy/:instanceId", (req: AuthRequest, res) => {
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(req.params.instanceId) as any;
  if (!instance) { res.status(404).json({ error: "Instance not found" }); return; }

  const args = ["destroy", "--provider", instance.provider];
  if (instance.hostname) args.push("--hostname", instance.hostname);

  const jobId = uuid();
  const job = { status: "running", logs: [] as string[], instanceId: instance.id };
  activeJobs.set(jobId, job);

  db.prepare("UPDATE instances SET status = 'destroying' WHERE id = ?").run(instance.id);

  const proc = spawn("clawmacdo", args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stdout.on("data", (data: Buffer) => { const l = data.toString().trim(); if (l) job.logs.push(l); });
  proc.stderr.on("data", (data: Buffer) => { const l = data.toString().trim(); if (l) job.logs.push(`[stderr] ${l}`); });

  proc.on("close", (code: number | null) => {
    if (code === 0) {
      job.status = "completed";
      db.prepare("DELETE FROM instances WHERE id = ?").run(instance.id);
      db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(
        uuid(), instance.team_id, req.userId, "instance.destroyed", "instance", instance.id
      );
    } else {
      job.status = "failed";
      db.prepare("UPDATE instances SET status = 'error' WHERE id = ?").run(instance.id);
    }
    setTimeout(() => activeJobs.delete(jobId), 3600000);
  });

  res.status(202).json({ jobId, message: "Destroy started" });
});

/**
 * POST /api/deploy/restart/:instanceId
 * Restart OpenClaw gateway on an instance via SSH
 */
router.post("/restart/:instanceId", (req: AuthRequest, res) => {
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(req.params.instanceId) as any;
  if (!instance || !instance.ip_address) { res.status(400).json({ error: "Instance not found or no IP" }); return; }

  const proc = spawn("ssh", ["-o", "StrictHostKeyChecking=no", `root@${instance.ip_address}`, "openclaw gateway restart"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
  proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
  proc.on("close", (code: number | null) => {
    if (code === 0) {
      db.prepare("UPDATE instances SET status = 'online', updated_at = datetime('now') WHERE id = ?").run(instance.id);
      res.json({ success: true, output });
    } else {
      res.status(500).json({ error: "Restart failed", output });
    }
  });
});

/**
 * POST /api/deploy/check-health/:instanceId
 * Check if an instance's gateway is responding
 */
router.post("/check-health/:instanceId", async (_req: AuthRequest, res) => {
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(_req.params.instanceId) as any;
  if (!instance || !instance.ip_address) { res.status(400).json({ error: "No IP" }); return; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(`http://${instance.ip_address}:${instance.port || 18789}/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      db.prepare("UPDATE instances SET status = 'online', version = ?, last_heartbeat = datetime('now') WHERE id = ?").run(data.version || null, instance.id);
      res.json({ status: "online", version: data.version });
    } else {
      db.prepare("UPDATE instances SET status = 'offline' WHERE id = ?").run(instance.id);
      res.json({ status: "offline" });
    }
  } catch {
    db.prepare("UPDATE instances SET status = 'offline' WHERE id = ?").run(instance.id);
    res.json({ status: "offline" });
  }
});

// Defaults per provider
function getDefaultRegion(provider: string): string {
  switch (provider) {
    case "digitalocean": return "sgp1";
    case "tencent": return "ap-singapore";
    case "aws": return "ap-southeast-1";
    default: return "";
  }
}

function getDefaultInstanceType(provider: string): string {
  switch (provider) {
    case "digitalocean": return "s-2vcpu-4gb";
    case "tencent": return "S8.MEDIUM4";
    case "aws": return "t3.medium";
    default: return "";
  }
}

export default router;
