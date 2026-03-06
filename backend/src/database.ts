import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "..", "data", "team-portal.db");

// Ensure data directory exists
import fs from "fs";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Teams
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Roles (per team)
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#636e72',
    is_default BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(team_id, name)
  );

  -- Permissions
  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general'
  );

  -- Role-Permission mapping
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );

  -- Groups (within a team)
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(team_id, name)
  );

  -- Team members
  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES roles(id),
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  -- Group members
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  );

  -- OpenClaw instances
  CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hostname TEXT,
    ip_address TEXT,
    port INTEGER DEFAULT 18789,
    provider TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'offline',
    version TEXT,
    auth_token TEXT,
    region TEXT,
    instance_type TEXT,
    agent_model TEXT,
    channels TEXT DEFAULT '[]',
    last_heartbeat TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Instance access (which groups/roles can access which instances)
  CREATE TABLE IF NOT EXISTS instance_access (
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    access_level TEXT DEFAULT 'view',
    CHECK (role_id IS NOT NULL OR group_id IS NOT NULL)
  );

  -- User external IDs (phone numbers, telegram IDs, etc.)
  CREATE TABLE IF NOT EXISTS user_external_ids (
    external_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'whatsapp',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Group chat to team mappings
  CREATE TABLE IF NOT EXISTS group_chat_mappings (
    chat_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'whatsapp',
    chat_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Audit log
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES teams(id),
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Seed Default Permissions ────────────────────────────────────────────────

const defaultPermissions = [
  // ─── Team Management ───
  { id: "perm_team_manage", name: "team.manage", description: "Manage team settings", category: "team" },
  { id: "perm_team_view", name: "team.view", description: "View team info", category: "team" },
  { id: "perm_members_manage", name: "members.manage", description: "Add/remove team members", category: "team" },
  { id: "perm_members_view", name: "members.view", description: "View team members", category: "team" },
  { id: "perm_roles_manage", name: "roles.manage", description: "Create/edit/delete roles", category: "team" },
  { id: "perm_groups_manage", name: "groups.manage", description: "Create/edit/delete groups", category: "team" },
  { id: "perm_instances_manage", name: "instances.manage", description: "Add/remove OpenClaw instances", category: "team" },
  { id: "perm_audit_view", name: "audit.view", description: "View audit logs", category: "team" },

  // ─── OpenClaw Tool Permissions ───
  { id: "perm_tool_exec", name: "tool.exec", description: "Run shell commands via exec tool", category: "tools" },
  { id: "perm_tool_read", name: "tool.read", description: "Read files from the workspace", category: "tools" },
  { id: "perm_tool_write", name: "tool.write", description: "Write/edit files in the workspace", category: "tools" },
  { id: "perm_tool_browser", name: "tool.browser", description: "Control the browser", category: "tools" },
  { id: "perm_tool_web_search", name: "tool.web_search", description: "Search the web", category: "tools" },
  { id: "perm_tool_web_fetch", name: "tool.web_fetch", description: "Fetch URLs / scrape pages", category: "tools" },
  { id: "perm_tool_message", name: "tool.message", description: "Send messages to channels", category: "tools" },
  { id: "perm_tool_tts", name: "tool.tts", description: "Use text-to-speech", category: "tools" },
  { id: "perm_tool_image", name: "tool.image", description: "Analyze or generate images", category: "tools" },
  { id: "perm_tool_pdf", name: "tool.pdf", description: "Analyze PDF documents", category: "tools" },
  { id: "perm_tool_nodes", name: "tool.nodes", description: "Control paired devices/nodes", category: "tools" },
  { id: "perm_tool_voice_call", name: "tool.voice_call", description: "Make phone calls", category: "tools" },
  { id: "perm_tool_subagent", name: "tool.subagent", description: "Spawn sub-agents / coding agents", category: "tools" },
  { id: "perm_tool_memory", name: "tool.memory", description: "Read/write agent memory files", category: "tools" },
  { id: "perm_tool_canvas", name: "tool.canvas", description: "Control canvas/presentation", category: "tools" },

  // ─── Chat / Message Permissions ───
  { id: "perm_chat_send", name: "chat.send", description: "Send messages in group chats", category: "chat" },
  { id: "perm_chat_command", name: "chat.command", description: "Use slash commands (/tts, /status, etc.)", category: "chat" },
  { id: "perm_chat_config", name: "chat.config", description: "Change OpenClaw config via chat", category: "chat" },
  { id: "perm_chat_cron", name: "chat.cron", description: "Create/manage cron jobs", category: "chat" },
  { id: "perm_chat_allowlist", name: "chat.allowlist", description: "Modify allowlists (WhatsApp, Telegram)", category: "chat" },
  { id: "perm_chat_deploy", name: "chat.deploy", description: "Trigger deploy/destroy via chat", category: "chat" },
  { id: "perm_chat_sensitive", name: "chat.sensitive", description: "Access sensitive info (IPs, tokens, keys)", category: "chat" },

  // ─── Instance Control ───
  { id: "perm_instance_restart", name: "instance.restart", description: "Restart OpenClaw gateway", category: "instance" },
  { id: "perm_instance_config", name: "instance.config", description: "Edit openclaw.json config", category: "instance" },
  { id: "perm_instance_view", name: "instance.view", description: "View instance status and logs", category: "instance" },
  { id: "perm_instance_ssh", name: "instance.ssh", description: "SSH tunnel access to instance", category: "instance" },
];

const insertPerm = db.prepare("INSERT OR IGNORE INTO permissions (id, name, description, category) VALUES (?, ?, ?, ?)");
for (const p of defaultPermissions) {
  insertPerm.run(p.id, p.name, p.description, p.category);
}

export default db;
