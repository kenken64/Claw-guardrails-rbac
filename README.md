# OpenClaw Team Portal

🦀 **Team management platform for OpenClaw** — manage teams, roles, groups, permissions, and OpenClaw instances with RBAC enforcement in group chats.

## Architecture

```
openclaw-team-portal/
├── backend/        ← Express + TypeScript + SQLite API
├── frontend/       ← React + TypeScript + Vite dashboard
├── plugin/         ← OpenClaw RBAC plugin (hooks into group chats)
└── data/           ← SQLite database files
```

## How It Works

1. **Admin creates a team** via the frontend dashboard
2. **Adds members** and assigns roles (Admin, Member, Viewer, or custom)
3. **Maps group chats** (WhatsApp/Telegram groups) to teams
4. **Maps user identities** (phone numbers, Telegram IDs) to team members
5. **Plugin validates** every interaction in group chats against RBAC

### Permission Flow (Group Chat)

```
User sends message in group chat
  ↓
OpenClaw receives message
  ↓
RBAC Plugin intercepts (inbound hook)
  ↓
Plugin calls backend API: POST /api/rbac/check
  { senderId: "+6591234567", groupId: "-500123456", permission: "tool.exec" }
  ↓
Backend checks: User → Team Member → Role → Permissions
  ↓
Returns: { allowed: true/false, reason: "..." }
  ↓
Plugin allows or blocks the interaction
```

## Permissions

### Tool Permissions
| Permission | Description |
|-----------|-------------|
| `tool.exec` | Run shell commands |
| `tool.read` | Read workspace files |
| `tool.write` | Write/edit files |
| `tool.browser` | Control browser |
| `tool.web_search` | Search the web |
| `tool.web_fetch` | Fetch/scrape URLs |
| `tool.message` | Send messages to channels |
| `tool.tts` | Text-to-speech |
| `tool.image` | Analyze/generate images |
| `tool.nodes` | Control paired devices |
| `tool.voice_call` | Make phone calls |
| `tool.subagent` | Spawn sub-agents |
| `tool.memory` | Access agent memory |

### Chat Permissions
| Permission | Description |
|-----------|-------------|
| `chat.send` | Send messages in group |
| `chat.command` | Use slash commands |
| `chat.config` | Change OpenClaw config |
| `chat.cron` | Manage cron jobs |
| `chat.allowlist` | Modify allowlists |
| `chat.deploy` | Trigger deploy/destroy |
| `chat.sensitive` | See sensitive info (IPs, keys) |

### Instance Permissions
| Permission | Description |
|-----------|-------------|
| `instance.restart` | Restart gateway |
| `instance.config` | Edit instance config |
| `instance.view` | View status/logs |
| `instance.ssh` | SSH tunnel access |

## Quick Start

### Backend
```bash
cd backend
npm install
npm run dev
# API at http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:5173
```

### Plugin (Install on OpenClaw)
```bash
openclaw plugins install @kenken64/openclaw-team-rbac
```

Configure in `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "openclaw-team-rbac": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:3001/api",
          "apiToken": "your-api-token",
          "enforceMode": "enforce"
        }
      }
    }
  }
}
```

## Default Roles

When you create a team, 3 roles are auto-created:

| Role | Permissions |
|------|------------|
| **Admin** | All permissions |
| **Member** | View + instance control + group assign |
| **Viewer** | View-only access |

## License

MIT © Kenneth Phang
