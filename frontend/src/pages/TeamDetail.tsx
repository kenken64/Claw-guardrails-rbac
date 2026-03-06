import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

interface Member { id: string; username: string; display_name: string; email: string; role_name: string; role_color: string; role_id: string; joined_at: string; }
interface Role { id: string; name: string; description: string; color: string; member_count: number; permissions: { id: string; name: string; category: string }[]; }
interface Group { id: string; name: string; description: string; member_count: number; }
interface Instance { id: string; name: string; hostname: string; ip_address: string; port: number; provider: string; status: string; version: string; region: string; agent_model: string; channels: string[]; last_heartbeat: string; }
interface Permission { id: string; name: string; description: string; category: string; }

const TABS = ["members", "roles", "groups", "instances", "audit"];

export default function TeamDetail() {
  const { teamId, tab } = useParams();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(tab || "members");
  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  // Modals
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showInstanceModal, setShowInstanceModal] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "", color: "#3498db", permissions: [] as string[] });
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [newInstance, setNewInstance] = useState({ name: "", hostname: "", ipAddress: "", provider: "digitalocean", region: "", agentModel: "anthropic/claude-sonnet-4-20250514", anthropicKey: "", openaiKey: "", telegramToken: "" });
  const [deployMode, setDeployMode] = useState<"manual" | "provision">("provision");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!teamId) return;
    api.getTeam(teamId).then(data => { setTeam(data); setMembers(data.members || []); });
    api.getRoles(teamId).then(setRoles);
    api.getGroups(teamId).then(setGroups);
    api.getInstances(teamId).then(setInstances);
    api.getPermissions().then(setPermissions);
    api.getAuditLog(teamId).then(setAudit).catch(() => {});
  }, [teamId]);

  const switchTab = (t: string) => { setActiveTab(t); nav(`/teams/${teamId}/${t}`, { replace: true }); };

  const createRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) return;
    await api.createRole(teamId, newRole);
    setRoles(await api.getRoles(teamId));
    setShowRoleModal(false);
    setNewRole({ name: "", description: "", color: "#3498db", permissions: [] });
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) return;
    await api.createGroup(teamId, newGroup.name, newGroup.description);
    setGroups(await api.getGroups(teamId));
    setShowGroupModal(false);
    setNewGroup({ name: "", description: "" });
  };

  const createInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) return;

    if (deployMode === "provision") {
      // Deploy via clawmacdo
      const res = await api.provisionInstance({
        teamId, name: newInstance.name, provider: newInstance.provider,
        region: newInstance.region, anthropicKey: newInstance.anthropicKey,
        openaiKey: newInstance.openaiKey, telegramToken: newInstance.telegramToken,
        model: newInstance.agentModel,
      });
      setActiveJobId(res.jobId);
      setDeployLogs(["🚀 Deployment started..."]);
      // Start polling
      pollDeploy(res.jobId);
    } else {
      // Manual add
      await api.createInstance(teamId, newInstance);
    }

    setInstances(await api.getInstances(teamId));
    if (deployMode === "manual") {
      setShowInstanceModal(false);
      setNewInstance({ name: "", hostname: "", ipAddress: "", provider: "digitalocean", region: "", agentModel: "anthropic/claude-sonnet-4-20250514", anthropicKey: "", openaiKey: "", telegramToken: "" });
    }
  };

  const pollDeploy = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await api.getDeployStatus(jobId);
        setDeployLogs(res.logs);
        if (res.status === "running") {
          setTimeout(poll, 3000);
        } else {
          setActiveJobId(null);
          if (teamId) setInstances(await api.getInstances(teamId));
          if (res.status === "completed") {
            setDeployLogs(prev => [...prev, "✅ Deployment completed!"]);
            setTimeout(() => { setShowInstanceModal(false); setDeployLogs([]); }, 2000);
          } else {
            setDeployLogs(prev => [...prev, "❌ Deployment failed. Check logs above."]);
          }
        }
      } catch { setTimeout(poll, 5000); }
    };
    poll();
  };

  const handleDestroy = async (instanceId: string) => {
    if (!confirm("Are you sure you want to destroy this instance? This cannot be undone.")) return;
    await api.destroyInstance(instanceId);
    if (teamId) setInstances(await api.getInstances(teamId));
  };

  const handleRestart = async (instanceId: string) => {
    await api.restartInstance(instanceId);
    if (teamId) setInstances(await api.getInstances(teamId));
  };

  const handleHealthCheck = async (instanceId: string) => {
    await api.checkHealth(instanceId);
    if (teamId) setInstances(await api.getInstances(teamId));
  };

  const togglePerm = (permId: string) => {
    setNewRole(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permId) ? prev.permissions.filter(p => p !== permId) : [...prev.permissions, permId],
    }));
  };

  const providerBadge = (p: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      digitalocean: { cls: "provider-do", label: "DigitalOcean" },
      tencent: { cls: "provider-tencent", label: "Tencent" },
      aws: { cls: "provider-aws", label: "AWS" },
      manual: { cls: "badge-purple", label: "Manual" },
    };
    const info = map[p] || { cls: "badge-blue", label: p };
    return <span className={`badge ${info.cls}`}>{info.label}</span>;
  };

  const permsByCategory = permissions.reduce((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  if (!team) return <div className="loading">Loading team...</div>;

  return (
    <div className="page">
      <nav className="navbar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link to="/" className="navbar-brand"><span>🦀</span><span>Teams</span></Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <span style={{ fontWeight: 600 }}>{team.name}</span>
        </div>
        <div className="navbar-user">
          <span>{user?.display_name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="content">
        <div className="tabs">
          {TABS.map(t => (
            <div key={t} className={`tab ${activeTab === t ? "tab-active" : ""}`} onClick={() => switchTab(t)}>
              {t === "members" && "👥 "}
              {t === "roles" && "🛡️ "}
              {t === "groups" && "📁 "}
              {t === "instances" && "🖥️ "}
              {t === "audit" && "📋 "}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>

        {/* Members Tab */}
        {activeTab === "members" && (
          <div>
            <div className="card-header"><h3>Team Members ({members.length})</h3></div>
            <table className="table">
              <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td><strong>{m.display_name || m.username}</strong><br /><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>@{m.username}</span></td>
                    <td>{m.email}</td>
                    <td><span className="badge" style={{ background: `${m.role_color}22`, color: m.role_color }}>{m.role_name}</span></td>
                    <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{m.joined_at?.split("T")[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Roles Tab */}
        {activeTab === "roles" && (
          <div>
            <div className="card-header"><h3>Roles</h3><button className="btn btn-primary btn-sm" onClick={() => setShowRoleModal(true)}>+ Create Role</button></div>
            <div className="grid-3">
              {roles.map(r => (
                <div key={r.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, color: r.color }}>● {r.name}</span>
                    <span className="badge badge-blue">{r.member_count} members</span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>{r.description}</p>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {r.permissions.length} permissions: {r.permissions.slice(0, 3).map(p => p.name).join(", ")}
                    {r.permissions.length > 3 && ` +${r.permissions.length - 3} more`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Groups Tab */}
        {activeTab === "groups" && (
          <div>
            <div className="card-header"><h3>Groups</h3><button className="btn btn-primary btn-sm" onClick={() => setShowGroupModal(true)}>+ Create Group</button></div>
            {groups.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 40 }}>
                <p style={{ color: "var(--text-secondary)" }}>No groups yet. Create one to organize team members.</p>
              </div>
            ) : (
              <div className="grid-3">
                {groups.map(g => (
                  <div key={g.id} className="card">
                    <h4>{g.name}</h4>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "8px 0" }}>{g.description}</p>
                    <span className="badge badge-blue">{g.member_count} members</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Instances Tab */}
        {activeTab === "instances" && (
          <div>
            <div className="card-header"><h3>OpenClaw Instances</h3><button className="btn btn-primary btn-sm" onClick={() => setShowInstanceModal(true)}>+ Add Instance</button></div>
            {instances.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 40 }}>
                <p style={{ color: "var(--text-secondary)" }}>No instances registered. Add one or deploy via clawmacdo.</p>
              </div>
            ) : (
              <div className="grid-2">
                {instances.map(inst => (
                  <div key={inst.id} className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <h4>{inst.name}</h4>
                      <span className={inst.status === "online" ? "status-online" : inst.status === "offline" ? "status-offline" : "status-pending"}>● {inst.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span>📍 {inst.ip_address || inst.hostname || "—"}:{inst.port}</span>
                      <span>🌐 {inst.region || "—"}</span>
                      <span>🤖 {inst.agent_model || "—"}</span>
                      <span>📡 {inst.channels?.join(", ") || "No channels"}</span>
                      {inst.version && <span>📦 v{inst.version}</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                      {providerBadge(inst.provider)}
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleHealthCheck(inst.id); }} title="Health check">🔍</button>
                        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleRestart(inst.id); }} title="Restart">🔄</button>
                        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDestroy(inst.id); }} title="Destroy">🗑️</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Audit Tab */}
        {activeTab === "audit" && (
          <div>
            <div className="card-header"><h3>Audit Log</h3></div>
            <table className="table">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Resource</th></tr></thead>
              <tbody>
                {audit.map((log: any) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{log.created_at}</td>
                    <td>{log.display_name || log.username || "System"}</td>
                    <td><span className="badge badge-blue">{log.action}</span></td>
                    <td style={{ fontSize: 13 }}>{log.resource_type} / {log.resource_id?.substring(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Role Modal */}
      {showRoleModal && (
        <div className="modal-overlay" onClick={() => setShowRoleModal(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Create Role</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowRoleModal(false)}>✕</button></div>
            <form onSubmit={createRole}>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Role Name</label>
                  <input className="form-input" value={newRole.name} onChange={e => setNewRole(prev => ({ ...prev, name: e.target.value }))} required />
                </div>
                <div className="form-group" style={{ width: 80 }}>
                  <label>Color</label>
                  <input type="color" value={newRole.color} onChange={e => setNewRole(prev => ({ ...prev, color: e.target.value }))} style={{ width: "100%", height: 38, border: "none", cursor: "pointer" }} />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input className="form-input" value={newRole.description} onChange={e => setNewRole(prev => ({ ...prev, description: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Permissions</label>
                <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 12 }}>
                  {Object.entries(permsByCategory).map(([cat, perms]) => (
                    <div key={cat} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-yellow)", textTransform: "uppercase", marginBottom: 6 }}>{cat}</div>
                      {perms.map(p => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", padding: "3px 0" }}>
                          <input type="checkbox" checked={newRole.permissions.includes(p.id)} onChange={() => togglePerm(p.id)} />
                          <span>{p.name}</span>
                          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>— {p.description}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowRoleModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Role</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Create Group</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowGroupModal(false)}>✕</button></div>
            <form onSubmit={createGroup}>
              <div className="form-group"><label>Group Name</label><input className="form-input" value={newGroup.name} onChange={e => setNewGroup(prev => ({ ...prev, name: e.target.value }))} required /></div>
              <div className="form-group"><label>Description</label><input className="form-input" value={newGroup.description} onChange={e => setNewGroup(prev => ({ ...prev, description: e.target.value }))} /></div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowGroupModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Group</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Instance Modal */}
      {showInstanceModal && (
        <div className="modal-overlay" onClick={() => setShowInstanceModal(false)}>
          <div className="modal" style={{ maxWidth: 550 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Add OpenClaw Instance</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowInstanceModal(false)}>✕</button></div>
            <form onSubmit={createInstance}>
              <div className="form-group"><label>Instance Name</label><input className="form-input" value={newInstance.name} onChange={e => setNewInstance(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g., Production Bot" required /></div>
              <div className="form-group">
                <label>Cloud Provider</label>
                <select className="form-input" value={newInstance.provider} onChange={e => setNewInstance(prev => ({ ...prev, provider: e.target.value }))}>
                  <option value="digitalocean">🌊 DigitalOcean</option>
                  <option value="tencent">☁️ Tencent Cloud</option>
                  <option value="aws">🟠 AWS</option>
                  <option value="manual">🔧 Manual (existing server)</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}><label>Hostname / IP</label><input className="form-input" value={newInstance.hostname} onChange={e => setNewInstance(prev => ({ ...prev, hostname: e.target.value }))} placeholder="e.g., 43.134.136.252" /></div>
                <div className="form-group" style={{ flex: 1 }}><label>Region</label><input className="form-input" value={newInstance.region} onChange={e => setNewInstance(prev => ({ ...prev, region: e.target.value }))} placeholder="e.g., sgp1, ap-southeast-1" /></div>
              </div>
              <div className="form-group"><label>Agent Model</label><input className="form-input" value={newInstance.agentModel} onChange={e => setNewInstance(prev => ({ ...prev, agentModel: e.target.value }))} /></div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowInstanceModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-success">🚀 Deploy Instance</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
