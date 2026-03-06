const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  // Auth
  login: (username: string, password: string) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, email: string, password: string) => request("/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) }),
  getMe: () => request("/auth/me"),

  // Teams
  getTeams: () => request("/teams"),
  createTeam: (name: string, description: string) => request("/teams", { method: "POST", body: JSON.stringify({ name, description }) }),
  getTeam: (id: string) => request(`/teams/${id}`),
  deleteTeam: (id: string) => request(`/teams/${id}`, { method: "DELETE" }),
  addMember: (teamId: string, userId: string, roleId?: string) => request(`/teams/${teamId}/members`, { method: "POST", body: JSON.stringify({ userId, roleId }) }),
  removeMember: (teamId: string, userId: string) => request(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
  updateMemberRole: (teamId: string, userId: string, roleId: string) => request(`/teams/${teamId}/members/${userId}/role`, { method: "PUT", body: JSON.stringify({ roleId }) }),

  // Roles
  getRoles: (teamId: string) => request(`/roles/team/${teamId}`),
  createRole: (teamId: string, data: any) => request(`/roles/team/${teamId}`, { method: "POST", body: JSON.stringify(data) }),
  updateRole: (roleId: string, data: any) => request(`/roles/${roleId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRole: (roleId: string) => request(`/roles/${roleId}`, { method: "DELETE" }),
  getPermissions: () => request("/roles/permissions"),

  // Groups
  getGroups: (teamId: string) => request(`/groups/team/${teamId}`),
  createGroup: (teamId: string, name: string, description: string) => request(`/groups/team/${teamId}`, { method: "POST", body: JSON.stringify({ name, description }) }),
  getGroup: (id: string) => request(`/groups/${id}`),
  updateGroup: (id: string, data: any) => request(`/groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGroup: (id: string) => request(`/groups/${id}`, { method: "DELETE" }),
  addGroupMember: (groupId: string, userId: string) => request(`/groups/${groupId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeGroupMember: (groupId: string, userId: string) => request(`/groups/${groupId}/members/${userId}`, { method: "DELETE" }),

  // Instances
  getInstances: (teamId: string) => request(`/instances/team/${teamId}`),
  createInstance: (teamId: string, data: any) => request(`/instances/team/${teamId}`, { method: "POST", body: JSON.stringify(data) }),
  getInstance: (id: string) => request(`/instances/${id}`),
  updateInstance: (id: string, data: any) => request(`/instances/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteInstance: (id: string) => request(`/instances/${id}`, { method: "DELETE" }),
  getAuditLog: (teamId: string) => request(`/instances/team/${teamId}/audit`),
};
