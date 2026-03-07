# @kenken64/openclaw-team-rbac

OpenClaw plugin that enforces team-based RBAC in group chats.

## Install
```bash
openclaw plugins install @kenken64/openclaw-team-rbac
```

## Configure
```json
{
  "plugins": {
    "entries": {
      "openclaw-team-rbac": {
        "config": {
          "apiUrl": "http://your-backend:3001/api",
          "apiToken": "token-from-admin-panel",
          "enforceMode": "enforce"
        }
      }
    }
  }
}
```

## How it works
1. User sends message in a group chat mapped to a team
2. Plugin calls `POST /api/rbac/check` with sender ID + permission
3. Backend checks user → team membership → role → permissions
4. Plugin allows or blocks the interaction

## Permissions checked
- **Tools:** `tool.exec`, `tool.read`, `tool.write`, `tool.browser`, `tool.web_search`, etc.
- **Chat:** `chat.send`, `chat.command`, `chat.config`, `chat.sensitive`
- **Instance:** `instance.restart`, `instance.config`
