import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import db from "../database.js";
import { generateToken, authMiddleware, type AuthRequest } from "../middleware/auth.js";

const router = Router();

// Register
router.post("/register", (req, res) => {
  const { username, email, password, displayName } = req.body;

  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email, and password required" });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(username, email);
  if (existing) {
    res.status(409).json({ error: "Username or email already exists" });
    return;
  }

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare("INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?, ?, ?, ?, ?)").run(
    id, username, email, passwordHash, displayName || username
  );

  const token = generateToken(id);
  res.status(201).json({ token, user: { id, username, email, displayName: displayName || username } });
});

// Login
router.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(username, username) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = generateToken(user.id);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name } });
});

// Get current user
router.get("/me", authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare("SELECT id, username, email, display_name, avatar_url, created_at FROM users WHERE id = ?").get(req.userId) as any;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

export default router;
