import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List roles for a team
router.get("/team/:teamId", (req: AuthRequest, res) => {
  const roles = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM team_members WHERE role_id = r.id) as member_count,
      json_group_array(json_object('id', p.id, 'name', p.name, 'category', p.category)) as permissions
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE r.team_id = ?
    GROUP BY r.id
    ORDER BY r.created_at
  `).all(req.params.teamId);

  // Parse permissions JSON
  const parsed = (roles as any[]).map(r => ({
    ...r,
    permissions: JSON.parse(r.permissions).filter((p: any) => p.id !== null),
  }));

  res.json(parsed);
});

// Create role
router.post("/team/:teamId", (req: AuthRequest, res) => {
  const { name, description, color, permissions } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  const roleId = uuid();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO roles (id, team_id, name, description, color) VALUES (?, ?, ?, ?, ?)").run(
      roleId, req.params.teamId, name, description, color || "#636e72"
    );

    if (permissions && Array.isArray(permissions)) {
      const insertRP = db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
      for (const permId of permissions) insertRP.run(roleId, permId);
    }

    db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(
      uuid(), req.params.teamId, req.userId, "role.created", "role", roleId
    );
  });

  tx();
  const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
  res.status(201).json(role);
});

// Update role
router.put("/:roleId", (req: AuthRequest, res) => {
  const { name, description, color, permissions } = req.body;

  const tx = db.transaction(() => {
    if (name || description || color) {
      const updates: string[] = [];
      const values: any[] = [];
      if (name) { updates.push("name = ?"); values.push(name); }
      if (description !== undefined) { updates.push("description = ?"); values.push(description); }
      if (color) { updates.push("color = ?"); values.push(color); }
      values.push(req.params.roleId);
      db.prepare(`UPDATE roles SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    if (permissions && Array.isArray(permissions)) {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(req.params.roleId);
      const insertRP = db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
      for (const permId of permissions) insertRP.run(req.params.roleId, permId);
    }
  });

  tx();
  res.json({ success: true });
});

// Delete role
router.delete("/:roleId", (req: AuthRequest, res) => {
  const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(req.params.roleId) as any;
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }
  if (role.is_default) { res.status(400).json({ error: "Cannot delete default role" }); return; }

  // Move members with this role to default role
  const defaultRole = db.prepare("SELECT id FROM roles WHERE team_id = ? AND is_default = 1").get(role.team_id) as any;
  if (defaultRole) {
    db.prepare("UPDATE team_members SET role_id = ? WHERE role_id = ?").run(defaultRole.id, req.params.roleId);
  }

  db.prepare("DELETE FROM roles WHERE id = ?").run(req.params.roleId);
  res.json({ success: true });
});

// List all permissions
router.get("/permissions", (_req: AuthRequest, res) => {
  const permissions = db.prepare("SELECT * FROM permissions ORDER BY category, name").all();
  res.json(permissions);
});

export default router;
