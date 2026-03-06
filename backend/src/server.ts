import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import teamRoutes from "./routes/teams.js";
import roleRoutes from "./routes/roles.js";
import groupRoutes from "./routes/groups.js";
import instanceRoutes from "./routes/instances.js";
import rbacRoutes from "./routes/rbac.js";
import deployRoutes from "./routes/deploy.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/instances", instanceRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/api/deploy", deployRoutes);
app.use("/api/admin", (await import("./routes/admin.js")).default);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0", name: "OpenClaw Team Portal" });
});

app.listen(PORT, () => {
  console.log(`🦀 OpenClaw Team Portal API running on http://localhost:${PORT}`);
});
