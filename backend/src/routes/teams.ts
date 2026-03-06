import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List user's teams
router.get("/", (req: AuthRequest, res) => {
  const teams = db.prepare(`
    SELECT t.*, tm.role_id, r.name as role_name,
      (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
      (SELECT COUNT(*) FROM instances WHERE team_id = t.id) as instance_count
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
    LEFT JOIN roles r ON r.id = tm.role_id
    ORDER BY t.created_at DESC
  `).all(req.userId);
  res.json(teams);
});

// Create team
router.post("/", (req: AuthRequest, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  const teamId = uuid();

  // Create default roles
  const adminRoleId = uuid();
  const memberRoleId = uuid();
  const viewerRoleId = uuid();

  const tx = db.transaction(() => {
    // Create team
    db.prepare("INSERT INTO teams (id, name, description, owner_id) VALUES (?, ?, ?, ?)").run(teamId, name, description, req.userId);

    // Create default roles
    db.prepare("INSERT INTO roles (id, team_id, name, description, color) VALUES (?, ?, ?, ?, ?)").run(adminRoleId, teamId, "Admin", "Full team access", "#e74c3c");
    db.prepare("INSERT INTO roles (id, team_id, name, description, color, is_default) VALUES (?, ?, ?, ?, ?, 1)").run(memberRoleId, teamId, "Member", "Standard member access", "#3498db");
    db.prepare("INSERT INTO roles (id, team_id, name, description, color) VALUES (?, ?, ?, ?, ?)").run(viewerRoleId, teamId, "Viewer", "Read-only access", "#636e72");

    // Assign all permissions to Admin
    const perms = db.prepare("SELECT id FROM permissions").all() as any[];
    const insertRP = db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
    for (const p of perms) insertRP.run(adminRoleId, p.id);

    // Assign view permissions to Member
    const viewPerms = db.prepare("SELECT id FROM permissions WHERE name LIKE '%.view' OR name IN ('instances.control', 'groups.assign')").all() as any[];
    for (const p of viewPerms) insertRP.run(memberRoleId, p.id);

    // Assign only view permissions to Viewer
    const viewOnlyPerms = db.prepare("SELECT id FROM permissions WHERE name LIKE '%.view'").all() as any[];
    for (const p of viewOnlyPerms) insertRP.run(viewerRoleId, p.id);

    // Add creator as admin
    db.prepare("INSERT INTO team_members (team_id, user_id, role_id) VALUES (?, ?, ?)").run(teamId, req.userId, adminRoleId);

    // Audit
    db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(uuid(), teamId, req.userId, "team.created", "team", teamId);
  });

  tx();
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId);
  res.status(201).json(team);
});

// Get team details
router.get("/:teamId", (req: AuthRequest, res) => {
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.params.teamId) as any;
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.avatar_url, tm.role_id, r.name as role_name, r.color as role_color, tm.joined_at
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN roles r ON r.id = tm.role_id
    WHERE tm.team_id = ?
  `).all(req.params.teamId);

  res.json({ ...team, members });
});

// Delete team
router.delete("/:teamId", (req: AuthRequest, res) => {
  const team = db.prepare("SELECT * FROM teams WHERE id = ? AND owner_id = ?").get(req.params.teamId, req.userId);
  if (!team) { res.status(403).json({ error: "Only the owner can delete a team" }); return; }

  db.prepare("DELETE FROM teams WHERE id = ?").run(req.params.teamId);
  res.json({ success: true });
});

// Add member to team
router.post("/:teamId/members", (req: AuthRequest, res) => {
  const { userId, roleId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  const defaultRole = db.prepare("SELECT id FROM roles WHERE team_id = ? AND is_default = 1").get(req.params.teamId) as any;

  db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role_id) VALUES (?, ?, ?)").run(
    req.params.teamId, userId, roleId || defaultRole?.id
  );

  db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    uuid(), req.params.teamId, req.userId, "member.added", "user", userId, JSON.stringify({ roleId })
  );

  res.json({ success: true });
});

// Remove member
router.delete("/:teamId/members/:userId", (req: AuthRequest, res) => {
  db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(req.params.teamId, req.params.userId);
  res.json({ success: true });
});

// Update member role
router.put("/:teamId/members/:userId/role", (req: AuthRequest, res) => {
  const { roleId } = req.body;
  db.prepare("UPDATE team_members SET role_id = ? WHERE team_id = ? AND user_id = ?").run(roleId, req.params.teamId, req.params.userId);
  res.json({ success: true });
});

export default router;
