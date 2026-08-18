import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Check, ExternalLink, HardDrive, KeyRound, Loader2, LogOut, MessageSquare,
  Pencil, Radio, RefreshCw, Shield, Trash2, Users, X, Zap,
} from "lucide-react";
import {
  adminBurnRoom, adminListRooms, adminLogin, adminToken, adminUpdateRoom,
  clearAdminToken, storeAdminToken, type AdminRoom,
} from "../live/adminApi";

const POLL_MS = 5000;

function fmtWhen(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Remaining lifetime for an ephemeral room, e.g. "2h 13m". */
function fmtTtl(room: AdminRoom): string {
  if (room.mode === "permanent" || !room.expiresAt) return "—";
  const left = new Date(room.expiresAt).getTime() - Date.now();
  if (left <= 0) return "expired";
  const mins = Math.floor(left / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* ================= login ================= */

function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const { token } = await adminLogin(password);
      storeAdminToken(token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
      setBusy(false);
    }
  }

  return (
    <div className="admin-shell">
      <div className="setup">
        <motion.button className="setup-back" onClick={() => navigate("/")} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <ArrowLeft size={15} /> Back to site
        </motion.button>
        <motion.div
          className="setup-card glass"
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="setup-orbit admin-orbit">
            <Shield size={26} />
          </div>
          <h2 className="setup-title">
            <span className="grad-text">Conduit admin</span>
          </h2>
          <p className="setup-sub">Operator console — manage every room on this server.</p>

          <div className="setup-name">
            <KeyRound size={15} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="Admin password"
              aria-label="Admin password"
              autoFocus
            />
          </div>

          {error && <div className="admin-error">{error}</div>}

          <button className="btn btn-primary admin-login-btn" onClick={() => void submit()} disabled={busy || !password}>
            {busy ? <Loader2 size={17} className="spin" /> : <Shield size={17} />}
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="setup-meta">
            <span><KeyRound size={12} /> Admins see room metadata only — chat stays E2E encrypted</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ================= dashboard ================= */

type RowState = {
  editing: string | null;
  editValue: string;
  confirmBurn: string | null;
};

export function Admin() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => adminToken());
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [row, setRow] = useState<RowState>({ editing: null, editValue: "", confirmBurn: null });

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () =>
      adminListRooms()
        .then(({ rooms: list }) => {
          if (!alive) return;
          setRooms(list);
          setError("");
        })
        .catch((err) => {
          if (!alive) return;
          const message = err instanceof Error ? err.message : String(err);
          // Expired/revoked session — drop back to the login screen.
          if (/401|session/i.test(message)) {
            clearAdminToken();
            setToken(null);
          } else {
            setError(message);
          }
        })
        .finally(() => alive && setLoading(false));
    void load();
    const iv = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [token, refreshKey]);

  function logout() {
    clearAdminToken();
    setToken(null);
    setRooms([]);
  }

  function startRename(room: AdminRoom) {
    setRow({ editing: room.code, editValue: room.name || room.code, confirmBurn: null });
  }

  async function commitRename(code: string) {
    const name = row.editValue.trim().slice(0, 60);
    setRow((r) => ({ ...r, editing: null }));
    if (!name) return;
    try {
      await adminUpdateRoom(code, { name });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rename failed");
    }
  }

  async function toggleMode(room: AdminRoom) {
    const mode = room.mode === "ephemeral" ? "permanent" : "ephemeral";
    try {
      await adminUpdateRoom(room.code, { mode });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "mode change failed");
    }
  }

  function armBurn(code: string) {
    // Show an explicit inline confirmation; the user must click "Burn" to act.
    setRow((r) => ({ ...r, confirmBurn: code, editing: null }));
  }

  function cancelBurn() {
    setRow((r) => ({ ...r, confirmBurn: null }));
  }

  async function doBurn(code: string) {
    setRow((r) => ({ ...r, confirmBurn: null }));
    try {
      await adminBurnRoom(code);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "burn failed");
    }
  }

  const totalMessages = rooms.reduce((n, r) => n + r.messageCount, 0);
  const liveMembers = rooms.reduce((n, r) => n + r.memberCount, 0);

  if (!token) return <AdminLogin onLoggedIn={() => setToken(adminToken())} />;

  return (
    <div className="admin-shell">
      <div className="admin-topbar glass">
        <div className="admin-top-left">
          <button className="icon-btn" onClick={() => navigate("/")} aria-label="Back to site"><ArrowLeft size={17} /></button>
          <div className="admin-title">
            <Shield size={16} className="admin-title-icon" />
            <strong>Conduit admin</strong>
          </div>
          <span className="conn-badge">
            <span className="pulse-dot" />
            {rooms.length} room{rooms.length === 1 ? "" : "s"} on this server
          </span>
        </div>
        <div className="admin-top-right">
          <button className="icon-btn" onClick={refresh} aria-label="Refresh rooms" title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      <div className="admin-body">
        <div className="admin-stats">
          <div className="admin-stat glass">
            <Radio size={15} />
            <strong>{rooms.length}</strong>
            <span>rooms</span>
          </div>
          <div className="admin-stat glass">
            <Users size={15} />
            <strong>{liveMembers}</strong>
            <span>members online</span>
          </div>
          <div className="admin-stat glass">
            <MessageSquare size={15} />
            <strong>{totalMessages}</strong>
            <span>messages stored</span>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        {loading ? (
          <div className="admin-loading"><Loader2 size={18} className="spin" /> Loading rooms…</div>
        ) : rooms.length === 0 ? (
          <div className="admin-empty glass">No rooms yet — create one from the site and it shows up here.</div>
        ) : (
          <div className="admin-table-wrap glass">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Mode</th>
                  <th>Created</th>
                  <th>Lifetime</th>
                  <th className="admin-num">Msgs</th>
                  <th className="admin-num">Live</th>
                  <th className="admin-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  const editing = row.editing === room.code;
                  const confirm = row.confirmBurn === room.code;
                  return (
                    <tr key={room.id}>
                      <td>
                        <button className="admin-code" onClick={() => navigate(`/room/${room.code}`)} title={`Open room ${room.code}`}>
                          {room.code}
                        </button>
                      </td>
                      <td>
                        {editing ? (
                          <div className="admin-rename">
                            <input
                              value={row.editValue}
                              onChange={(e) => setRow((r) => ({ ...r, editValue: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && void commitRename(room.code)}
                              maxLength={60}
                              autoFocus
                              aria-label={`Rename room ${room.code}`}
                            />
                            <button className="icon-btn icon-btn-sm" onClick={() => void commitRename(room.code)} aria-label="Save name"><Check size={13} /></button>
                            <button className="icon-btn icon-btn-sm" onClick={() => setRow((r) => ({ ...r, editing: null }))} aria-label="Cancel"><X size={13} /></button>
                          </div>
                        ) : (
                          <span className="admin-name" title={room.name || room.code}>{room.name || room.code}</span>
                        )}
                      </td>
                      <td>
                        <button
                          className={`admin-mode admin-mode-${room.mode}`}
                          onClick={() => void toggleMode(room)}
                          title={`Switch to ${room.mode === "ephemeral" ? "permanent" : "ephemeral"}`}
                        >
                          {room.mode === "ephemeral" ? <Zap size={12} /> : <HardDrive size={12} />}
                          {room.mode}
                        </button>
                      </td>
                      <td className="admin-dim">{fmtWhen(room.createdAt)}</td>
                      <td className="admin-dim" title={room.expiresAt ? new Date(room.expiresAt).toLocaleString() : "no expiry"}>
                        {fmtTtl(room)}
                      </td>
                      <td className="admin-num">{room.messageCount}</td>
                      <td className="admin-num">{room.memberCount}</td>
                      <td>
                        <div className="admin-row-actions">
                          {!editing && (
                            <button className="icon-btn icon-btn-sm" onClick={() => startRename(room)} aria-label="Rename room" title="Rename">
                              <Pencil size={13} />
                            </button>
                          )}
                          <button className="icon-btn icon-btn-sm" onClick={() => navigate(`/room/${room.code}`)} aria-label="Open room" title="Open room">
                            <ExternalLink size={13} />
                          </button>
                          {confirm ? (
                            <div className="admin-burn-confirm-box">
                              <span>Burn {room.code}?</span>
                              <button className="btn btn-danger btn-xs" onClick={() => void doBurn(room.code)}>
                                <Trash2 size={12} /> Burn
                              </button>
                              <button className="icon-btn icon-btn-sm" onClick={cancelBurn} aria-label="Cancel burn" title="Cancel">
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="icon-btn icon-btn-sm admin-burn"
                              onClick={() => armBurn(room.code)}
                              aria-label={`Burn room ${room.code}`}
                              title="Burn room"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
