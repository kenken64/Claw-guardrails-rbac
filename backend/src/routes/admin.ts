import { Router } from "express";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import db from "../database.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

// Create API token (owner-only or team owner)
router.post("/tokens", (req: AuthRequest, res) => {
  const { name, teamId, scopes } = req.body;
  const userId = req.userId;

  if (!name) { res.status(400).json({ error: "name required" }); return; }

  // If teamId provided, only team.owner can create tokens for that team
  if (teamId) {
    const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as any;
    if (!team) { res.status(404).json({ error: "team not found" }); return; }
    if (team.owner_id !== userId) { res.status(403).json({ error: "only team owner can create tokens for this team" }); return; }
  }

  const plain = uuid() + "-" + Math.random().toString(36).slice(2, 12);
  const hash = bcrypt.hashSync(plain, 10);
  const id = uuid();

  db.prepare("INSERT INTO api_tokens (id, token_hash, name, owner_id, team_id, scopes) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, hash, name, userId, teamId || null, JSON.stringify(scopes || [])
  );

  res.status(201).json({ token: plain, id, name, teamId, scopes: scopes || [] });
});

// List tokens owned by user
router.get("/tokens", (req: AuthRequest, res) => {
  const tokens = db.prepare("SELECT id, name, team_id, scopes, created_at FROM api_tokens WHERE owner_id = ?").all(req.userId);
  res.json(tokens.map((t: any) => ({ ...t, scopes: JSON.parse(t.scopes || "[]") })));
});

// Revoke token
router.delete("/tokens/:id", (req: AuthRequest, res) => {
  const token = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(req.params.id) as any;
  if (!token) { res.status(404).json({ error: "token not found" }); return; }
  if (token.owner_id !== req.userId) { res.status(403).json({ error: "not owner" }); return; }
  db.prepare("DELETE FROM api_tokens WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

export default router;
