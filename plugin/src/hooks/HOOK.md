# Team RBAC Hooks

## Overview
Enforces team-based role permissions on every OpenClaw interaction in group chats.

## Hooks

### `team-rbac:tool-guard`
**Trigger:** Before any tool call in a group chat context
**Checks:** Does the sender's role include `tool.<toolname>` permission?
**Actions:** `allow` or `deny` (with message)

### `team-rbac:inbound-filter`
**Trigger:** On every inbound message in a mapped group chat
**Checks:** `chat.send`, `chat.command`, `chat.config` permissions
**Actions:** `allow` or `block`

### `team-rbac:outbound-filter`
**Trigger:** Before sending a reply in a group chat
**Checks:** `chat.sensitive` — redacts IPs, API keys, tokens if user lacks permission
**Actions:** `allow` or `redact`

## Configuration
```json
{
  "apiUrl": "http://localhost:3001/api",
  "apiToken": "your-admin-api-token",
  "enforceMode": "enforce"
}
```

Modes: `enforce` (block denied), `audit` (log but allow), `off` (disabled)
