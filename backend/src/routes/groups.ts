import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// List groups for a team
router.get("/team/:teamId", (req: AuthRequest, res) => {
  const groups = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g
    WHERE g.team_id = ?
    ORDER BY g.created_at
  `).all(req.params.teamId);
  res.json(groups);
});

// Create group
router.post("/team/:teamId", (req: AuthRequest, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  const groupId = uuid();
  db.prepare("INSERT INTO groups (id, team_id, name, description) VALUES (?, ?, ?, ?)").run(groupId, req.params.teamId, name, description);

  db.prepare("INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, ?)").run(
    uuid(), req.params.teamId, req.userId, "group.created", "group", groupId
  );

  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(groupId);
  res.status(201).json(group);
});

// Get group with members
router.get("/:groupId", (req: AuthRequest, res) => {
  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(req.params.groupId) as any;
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.avatar_url
    FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(req.params.groupId);

  res.json({ ...group, members });
});

// Update group
router.put("/:groupId", (req: AuthRequest, res) => {
  const { name, description } = req.body;
  db.prepare("UPDATE groups SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?").run(name, description, req.params.groupId);
  res.json({ success: true });
});

// Delete group
router.delete("/:groupId", (req: AuthRequest, res) => {
  db.prepare("DELETE FROM groups WHERE id = ?").run(req.params.groupId);
  res.json({ success: true });
});

// Add member to group
router.post("/:groupId/members", (req: AuthRequest, res) => {
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)").run(req.params.groupId, userId);
  res.json({ success: true });
});

// Remove member from group
router.delete("/:groupId/members/:userId", (req: AuthRequest, res) => {
  db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(req.params.groupId, req.params.userId);
  res.json({ success: true });
});

export default router;
