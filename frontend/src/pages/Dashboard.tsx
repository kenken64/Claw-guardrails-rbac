import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

interface Team {
  id: string; name: string; description: string; member_count: number;
  instance_count: number; role_name: string; created_at: string;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => { api.getTeams().then(setTeams).catch(console.error); }, []);

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const team = await api.createTeam(newName, newDesc);
    setTeams(prev => [{ ...team, member_count: 1, instance_count: 0, role_name: "Admin" }, ...prev]);
    setShowCreate(false);
    setNewName("");
    setNewDesc("");
  };

  return (
    <div className="page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">
          <span>🦀</span>
          <span>OpenClaw Team Portal</span>
        </Link>
        <div className="navbar-user">
          <span>{user?.display_name || user?.username}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="content">
        <div className="card-header" style={{ marginBottom: 20 }}>
          <h2>My Teams</h2>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Team</button>
        </div>

        {teams.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
            <h3>No teams yet</h3>
            <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>Create a team to start managing your OpenClaw instances</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>Create Your First Team</button>
          </div>
        ) : (
          <div className="grid-2">
            {teams.map(team => (
              <div key={team.id} className="card" style={{ cursor: "pointer" }} onClick={() => nav(`/teams/${team.id}`)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{team.name}</h3>
                    <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>{team.description || "No description"}</p>
                  </div>
                  <span className="badge badge-blue">{team.role_name}</span>
                </div>
                <div style={{ display: "flex", gap: 20, marginTop: 16, fontSize: 13, color: "var(--text-secondary)" }}>
                  <span>👥 {team.member_count} members</span>
                  <span>🖥️ {team.instance_count} instances</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Team</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={createTeam}>
              <div className="form-group">
                <label>Team Name</label>
                <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., Engineering" required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input className="form-input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What is this team for?" />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Team</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
