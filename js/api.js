const BASE = () => localStorage.getItem("wren_url") || "http://localhost:4000";

async function req(path, options = {}) {
  const base = BASE();
  const res = await fetch(`${base}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": base,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

async function upload(path, formData, method = "POST") {
  const base = BASE();
  const res = await fetch(`${base}${path}`, {
    method, credentials: "include", body: formData,
    headers: { "Accept": "application/json", "Origin": base },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

// Auth
export const getSession  = () => req("/api/auth/get-session").catch(() => null);
export const signIn      = (email, password) => req("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
export const signOut     = () => req("/api/auth/sign-out", { method: "POST" });

// Collections
export const listCollections = () => req("/collections").then(r => r.collections);
export const listDocuments   = (col, limit = 20, offset = 0) => req(`/${col}?limit=${limit}&offset=${offset}`);
export const getDocument     = (col, id, label) => req(`/${col}/${id}${label ? `?label=${encodeURIComponent(label)}` : ""}`);
export const createDocument  = (col, data) => req(`/${col}`, { method: "POST", body: JSON.stringify(data) });
export const updateDocument  = (col, id, data) => req(`/${col}/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteDocument  = (col, id) => req(`/${col}/${id}`, { method: "DELETE" });
export const listVersions    = (col, id) => req(`/${col}/${id}/versions`);
export const getVersion      = (col, id, v) => req(`/${col}/${id}/versions/${v}`);
export const rollback        = (col, id, v) => req(`/${col}/${id}/rollback/${v}`, { method: "POST" });
export const setLabel        = (col, id, label, version) => req(`/${col}/${id}/labels`, { method: "POST", body: JSON.stringify(version != null ? { label, version } : { label }) });
export const listPaths       = (col, id) => req(`/${col}/${id}/paths`);
export const diffVersions    = (col, id, v1, v2) => req(`/${col}/${id}/diff?v1=${v1}&v2=${v2}`);
export const getSchema       = (col) => req(`/${col}/_schema`).catch(e => e.status === 404 ? null : Promise.reject(e));
export const setSchema       = (col, body) => req(`/${col}/_schema`, { method: "PUT", body: JSON.stringify(body) });
export const deleteSchema    = (col) => req(`/${col}/_schema`, { method: "DELETE" });
export const createAsset     = (col, file) => { const f = new FormData(); f.append("file", file); return upload(`/${col}`, f); };
export const updateAsset     = (col, id, file) => { const f = new FormData(); f.append("file", file); return upload(`/${col}/${id}`, f, "PUT"); };
export const assetUrl        = (col, id, v) => `${BASE()}/${col}/${id}/raw${v != null ? `?version=${v}` : ""}`;

// Trees
export const listTrees    = () => req("/tree").then(r => r.trees);
export const getTreeNode  = (name, path) => req(`/tree/${name}${path}`);
export const getFullTree  = (name, label) => req(`/tree/${name}?full=true${label ? `&label=${encodeURIComponent(label)}` : ""}`).then(r => r.nodes);
export const setTreePath  = (name, path, documentId) => req(`/tree/${name}${path}`, { method: "PUT", body: JSON.stringify({ documentId }) });
export const deleteTreePath = (name, path) => req(`/tree/${name}${path}`, { method: "DELETE" });

// API Keys
export const listKeys   = () => req("/api/keys").then(r => r.keys);
export const createKey  = (name) => req("/api/keys", { method: "POST", body: JSON.stringify({ name }) });
export const revokeKey  = (id) => req(`/api/keys/${id}`, { method: "DELETE" });

// Org
export const getOrg    = () => req("/api/org");
export const switchOrg = (orgId) => req("/api/org", { method: "PUT", body: JSON.stringify({ orgId }) });

// Invites
export const listInvites     = () => req("/api/invites").then(r => r.invites);
export const createInvite    = (email, role) => req("/api/invites", { method: "POST", body: JSON.stringify({ email, role }) });
export const revokeInvite    = (id) => req(`/api/invites/${id}`, { method: "DELETE" });
export const acceptInviteToken = (token) => req("/api/invites/accept", { method: "POST", body: JSON.stringify({ token }) });
export const listReceivedInvites = () => req("/api/invites/received").then(r => r.invites);
export const acceptInviteById    = (id) => req(`/api/invites/${id}/accept`, { method: "POST" });

// Members
export const listMembers   = () => req("/api/members").then(r => r.members);
export const removeMember  = (userId) => req(`/api/members/${userId}`, { method: "DELETE" });

// Permissions
export const listPermissions  = () => req("/api/permissions").then(r => r.permissions);
export const createPermission = (body) => req("/api/permissions", { method: "POST", body: JSON.stringify(body) });
export const updatePermission = (id, body) => req(`/api/permissions/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deletePermission = (id) => req(`/api/permissions/${id}`, { method: "DELETE" });
