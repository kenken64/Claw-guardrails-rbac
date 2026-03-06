import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List instances for a team
router.get("/team/:teamId", (req: AuthRequest, res) => {
  const instances = db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM instance_access WHERE instance_id = i.id) as access_rules
    FROM instances i
    WHERE i.team_id = ?
    ORDER BY i.created_at DESC
  `).all(req.params.teamId);

  // Parse channels JSON
  const parsed = (instances as any[]).map(i => ({
    ...i,
    channels: JSON.parse(i.channels || "[]"),
  }));

  res.json(parsed);
});

// Create instance
router.post("/team/:teamId", (req: AuthRequest, res) => {
  const { name, hostname, ipAddress, port, provider, authToken, region, instanceType, agentModel, channels } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  const instanceId = uuid();
  db.prepare(`
    INSERT INTO instances (id, team_id, name, hostname, ip_address, port, provider, auth_token, region, instance_type, agent_model, channels)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(instanceId, req.params.teamId, name, hostname, ipAddress, port || 18789, provider || "manual", authToken, region, instanceType, agentModel, JSON.stringify(channels || []));

  db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(
    uuid(), req.params.teamId, req.userId, "instance.created", "instance", instanceId
  );

  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(instanceId);
  res.status(201).json(instance);
});

// Get instance
router.get("/:instanceId", (req: AuthRequest, res) => {
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(req.params.instanceId) as any;
  if (!instance) { res.status(404).json({ error: "Instance not found" }); return; }

  const accessRules = db.prepare(`
    SELECT ia.*, r.name as role_name, g.name as group_name
    FROM instance_access ia
    LEFT JOIN roles r ON r.id = ia.role_id
    LEFT JOIN groups g ON g.id = ia.group_id
    WHERE ia.instance_id = ?
  `).all(req.params.instanceId);

  res.json({ ...instance, channels: JSON.parse(instance.channels || "[]"), accessRules });
});

// Update instance
router.put("/:instanceId", (req: AuthRequest, res) => {
  const { name, hostname, ipAddress, port, provider, status, version, authToken, region, instanceType, agentModel, channels } = req.body;

  const updates: string[] = [];
  const values: any[] = [];

  if (name !== undefined) { updates.push("name = ?"); values.push(name); }
  if (hostname !== undefined) { updates.push("hostname = ?"); values.push(hostname); }
  if (ipAddress !== undefined) { updates.push("ip_address = ?"); values.push(ipAddress); }
  if (port !== undefined) { updates.push("port = ?"); values.push(port); }
  if (provider !== undefined) { updates.push("provider = ?"); values.push(provider); }
  if (status !== undefined) { updates.push("status = ?"); values.push(status); }
  if (version !== undefined) { updates.push("version = ?"); values.push(version); }
  if (authToken !== undefined) { updates.push("auth_token = ?"); values.push(authToken); }
  if (region !== undefined) { updates.push("region = ?"); values.push(region); }
  if (instanceType !== undefined) { updates.push("instance_type = ?"); values.push(instanceType); }
  if (agentModel !== undefined) { updates.push("agent_model = ?"); values.push(agentModel); }
  if (channels !== undefined) { updates.push("channels = ?"); values.push(JSON.stringify(channels)); }

  updates.push("updated_at = datetime('now')");
  values.push(req.params.instanceId);

  db.prepare(`UPDATE instances SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json({ success: true });
});

// Delete instance
router.delete("/:instanceId", (req: AuthRequest, res) => {
  db.prepare("DELETE FROM instances WHERE id = ?").run(req.params.instanceId);
  res.json({ success: true });
});

// Update instance heartbeat / status
router.post("/:instanceId/heartbeat", (req: AuthRequest, res) => {
  const { status, version } = req.body;
  db.prepare("UPDATE instances SET status = ?, version = ?, last_heartbeat = datetime('now') WHERE id = ?").run(
    status || "online", version, req.params.instanceId
  );
  res.json({ success: true });
});

// Set instance access rules
router.post("/:instanceId/access", (req: AuthRequest, res) => {
  const { roleId, groupId, accessLevel } = req.body;
  if (!roleId && !groupId) { res.status(400).json({ error: "roleId or groupId required" }); return; }

  db.prepare("INSERT INTO instance_access (instance_id, role_id, group_id, access_level) VALUES (?, ?, ?, ?)").run(
    req.params.instanceId, roleId || null, groupId || null, accessLevel || "view"
  );
  res.json({ success: true });
});

// Audit log for a team
router.get("/team/:teamId/audit", (req: AuthRequest, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.username, u.display_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.team_id = ?
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all(req.params.teamId);
  res.json(logs);
});

export default router;
