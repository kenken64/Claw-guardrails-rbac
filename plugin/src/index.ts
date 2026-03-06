/**
 * @kenken64/openclaw-team-rbac
 *
 * OpenClaw plugin that enforces team-based RBAC.
 * On every inbound message or tool call in a group chat,
 * the plugin calls the Team Portal backend API to check
 * whether the sender has permission to:
 *   - Use the requested tool
 *   - Send messages / commands
 *   - Access sensitive information
 */

interface PluginAPI {
  registerHook(hookId: string, handler: (...args: any[]) => any): void;
  getConfig(key: string): any;
  log(level: string, message: string): void;
}

export default function register(api: PluginAPI) {
  const config = {
    apiUrl: api.getConfig("apiUrl") || "http://localhost:3001/api",
    apiToken: api.getConfig("apiToken") || "",
    enabled: api.getConfig("enabled") !== false,
    enforceMode: api.getConfig("enforceMode") || "enforce", // "enforce" | "audit" | "off"
  };

  if (!config.enabled) {
    api.log("info", "[team-rbac] Plugin disabled");
    return;
  }

  // Hook: Validate tool calls against RBAC
  api.registerHook("team-rbac:tool-guard", async (ctx: any) => {
    return validateToolAccess(ctx, config, api);
  });

  // Hook: Validate inbound messages in group chats
  api.registerHook("team-rbac:inbound-filter", async (ctx: any) => {
    return validateChatAccess(ctx, config, api);
  });

  // Hook: Filter sensitive data based on permissions
  api.registerHook("team-rbac:outbound-filter", async (ctx: any) => {
    return validateOutboundAccess(ctx, config, api);
  });

  api.log("info", `[team-rbac] 🛡️ RBAC hooks registered (mode: ${config.enforceMode})`);
}

// ─── Permission Check via Backend API ────────────────────────────────────────

interface RBACConfig {
  apiUrl: string;
  apiToken: string;
  enforceMode: string;
}

async function checkPermission(
  senderId: string,
  groupId: string,
  permission: string,
  config: RBACConfig,
  api: PluginAPI
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const res = await fetch(`${config.apiUrl}/rbac/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({ senderId, groupId, permission }),
    });

    if (!res.ok) {
      api.log("warn", `[team-rbac] API returned ${res.status} for permission check`);
      // Fail open in audit mode, fail closed in enforce mode
      return config.enforceMode === "enforce"
        ? { allowed: false, reason: "RBAC service unavailable" }
        : { allowed: true };
    }

    return await res.json();
  } catch (err) {
    api.log("error", `[team-rbac] Permission check failed: ${err}`);
    return config.enforceMode === "enforce"
      ? { allowed: false, reason: "RBAC service error" }
      : { allowed: true };
  }
}

// ─── Tool Access Validation ──────────────────────────────────────────────────

const TOOL_PERMISSION_MAP: Record<string, string> = {
  exec: "tool.exec",
  read: "tool.read",
  write: "tool.write",
  edit: "tool.write",
  browser: "tool.browser",
  web_search: "tool.web_search",
  web_fetch: "tool.web_fetch",
  message: "tool.message",
  tts: "tool.tts",
  image: "tool.image",
  pdf: "tool.pdf",
  nodes: "tool.nodes",
  voice_call: "tool.voice_call",
  sessions_spawn: "tool.subagent",
  subagents: "tool.subagent",
  memory_search: "tool.memory",
  memory_get: "tool.memory",
  canvas: "tool.canvas",
};

async function validateToolAccess(ctx: any, config: RBACConfig, api: PluginAPI) {
  // Only check in group chat contexts
  if (!ctx.groupId) return { action: "allow" };

  const tool = ctx.tool || "";
  const permission = TOOL_PERMISSION_MAP[tool];

  if (!permission) return { action: "allow" }; // Unknown tool — allow by default

  const result = await checkPermission(ctx.senderId, ctx.groupId, permission, config, api);

  if (!result.allowed) {
    api.log("warn", `[team-rbac] DENIED: ${ctx.senderId} tried tool '${tool}' in group ${ctx.groupId} — ${result.reason}`);

    if (config.enforceMode === "audit") {
      return { action: "allow", audit: { denied: true, tool, permission, reason: result.reason } };
    }

    return {
      action: "deny",
      reason: `⛔ Permission denied: You don't have the '${permission}' permission to use this tool.`,
    };
  }

  return { action: "allow" };
}

// ─── Chat Access Validation ──────────────────────────────────────────────────

async function validateChatAccess(ctx: any, config: RBACConfig, api: PluginAPI) {
  if (!ctx.groupId) return { action: "allow" };

  const message = ctx.message || "";

  // Check if it's a slash command
  if (message.startsWith("/")) {
    const result = await checkPermission(ctx.senderId, ctx.groupId, "chat.command", config, api);
    if (!result.allowed) {
      api.log("warn", `[team-rbac] DENIED: ${ctx.senderId} tried command in group ${ctx.groupId}`);
      return config.enforceMode === "enforce"
        ? { action: "block", reason: "⛔ You don't have permission to use commands." }
        : { action: "allow" };
    }
  }

  // Check if it's a config change request
  const configPatterns = [/change.*config/i, /update.*openclaw/i, /modify.*allowlist/i, /add.*cron/i];
  const isConfigRequest = configPatterns.some(p => p.test(message));

  if (isConfigRequest) {
    const result = await checkPermission(ctx.senderId, ctx.groupId, "chat.config", config, api);
    if (!result.allowed) {
      api.log("warn", `[team-rbac] DENIED: ${ctx.senderId} tried config change in group ${ctx.groupId}`);
      return config.enforceMode === "enforce"
        ? { action: "block", reason: "⛔ You don't have permission to change configuration." }
        : { action: "allow" };
    }
  }

  // Basic chat send permission
  const sendResult = await checkPermission(ctx.senderId, ctx.groupId, "chat.send", config, api);
  if (!sendResult.allowed) {
    return config.enforceMode === "enforce"
      ? { action: "block", reason: "⛔ You don't have permission to interact in this group." }
      : { action: "allow" };
  }

  return { action: "allow" };
}

// ─── Outbound Filter (hide sensitive data based on permissions) ──────────────

async function validateOutboundAccess(ctx: any, config: RBACConfig, api: PluginAPI) {
  if (!ctx.groupId || !ctx.message) return { action: "allow" };

  // Check if response contains sensitive data patterns
  const sensitivePatterns = [
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses
    /\bsk-[a-zA-Z0-9]{20,}\b/g, // API keys
    /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // Tokens
  ];

  const hasSensitive = sensitivePatterns.some(p => p.test(ctx.message));

  if (hasSensitive) {
    const result = await checkPermission(ctx.requesterId, ctx.groupId, "chat.sensitive", config, api);
    if (!result.allowed) {
      api.log("info", `[team-rbac] Redacting sensitive data for ${ctx.requesterId} in group ${ctx.groupId}`);
      let cleaned = ctx.message;
      for (const p of sensitivePatterns) {
        cleaned = cleaned.replace(p, "[REDACTED]");
      }
      return { action: "redact", message: cleaned };
    }
  }

  return { action: "allow" };
}
