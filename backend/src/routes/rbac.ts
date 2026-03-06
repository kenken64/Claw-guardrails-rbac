import { Router } from "express";
import db from "../database.js";

const router = Router();

/**
 * POST /api/rbac/check
 *
 * Called by the OpenClaw Team RBAC plugin on every interaction.
 * Checks if a sender (identified by phone/telegram ID) has a specific
 * permission in the context of a group chat.
 *
 * Body: { senderId, groupId, permission }
 * Returns: { allowed: boolean, reason?: string }
 */
router.post("/check", (req, res) => {
  const { senderId, groupId, permission } = req.body;

  if (!senderId || !permission) {
    res.status(400).json({ allowed: false, reason: "senderId and permission required" });
    return;
  }

  // Find user by their external ID (phone number, telegram ID, etc.)
  // Users can have multiple external IDs mapped
  const userMapping = db.prepare(`
    SELECT user_id FROM user_external_ids WHERE external_id = ?
  `).get(senderId) as any;

  if (!userMapping) {
    // Unknown user — deny by default in group contexts
    res.json({ allowed: false, reason: "User not registered in any team" });
    return;
  }

  const userId = userMapping.user_id;

  // Find which team this group chat belongs to
  let teamId: string | null = null;

  if (groupId) {
    const groupMapping = db.prepare(`
      SELECT team_id FROM group_chat_mappings WHERE chat_id = ?
    `).get(groupId) as any;

    if (groupMapping) {
      teamId = groupMapping.team_id;
    }
  }

  if (!teamId) {
    // Group not mapped to any team — allow (unmanaged group)
    res.json({ allowed: true, reason: "Group not managed by any team" });
    return;
  }

  // Get user's role in this team
  const membership = db.prepare(`
    SELECT tm.role_id, r.name as role_name
    FROM team_members tm
    LEFT JOIN roles r ON r.id = tm.role_id
    WHERE tm.team_id = ? AND tm.user_id = ?
  `).get(teamId, userId) as any;

  if (!membership) {
    res.json({ allowed: false, reason: "User is not a member of this team" });
    return;
  }

  // Check if the user's role has the required permission
  const hasPerm = db.prepare(`
    SELECT 1 FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ? AND p.name = ?
  `).get(membership.role_id, permission);

  if (hasPerm) {
    res.json({ allowed: true });
    return;
  }

  // Check group-level permissions (user might have permission via a group)
  const hasGroupPerm = db.prepare(`
    SELECT 1 FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    JOIN instance_access ia ON ia.group_id = g.id
    WHERE gm.user_id = ? AND g.team_id = ?
  `).get(userId, teamId);

  if (hasGroupPerm) {
    // User is in a group with instance access — check if the group grants this permission
    const groupPerm = db.prepare(`
      SELECT 1 FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      JOIN role_permissions rp ON rp.role_id = (
        SELECT role_id FROM team_members WHERE team_id = g.team_id AND user_id = gm.user_id
      )
      JOIN permissions p ON p.id = rp.permission_id
      WHERE gm.user_id = ? AND g.team_id = ? AND p.name = ?
    `).get(userId, teamId, permission);

    if (groupPerm) {
      res.json({ allowed: true });
      return;
    }
  }

  res.json({
    allowed: false,
    reason: `Role '${membership.role_name}' does not have '${permission}' permission`,
  });
});

/**
 * GET /api/rbac/user/:senderId/permissions
 *
 * Returns all permissions for a user across all their teams.
 */
router.get("/user/:senderId/permissions", (req, res) => {
  const userMapping = db.prepare(`
    SELECT user_id FROM user_external_ids WHERE external_id = ?
  `).get(req.params.senderId) as any;

  if (!userMapping) {
    res.json({ permissions: [] });
    return;
  }

  const permissions = db.prepare(`
    SELECT DISTINCT p.name, p.description, p.category, t.name as team_name, r.name as role_name
    FROM team_members tm
    JOIN roles r ON r.id = tm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ?
    ORDER BY t.name, p.category, p.name
  `).all(userMapping.user_id);

  res.json({ permissions });
});

export default router;
