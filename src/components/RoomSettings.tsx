import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, ClipboardCopy, Crown, HardDrive, Link2, Loader2, Shield, User, X, Zap } from "lucide-react";
import QRCode from "qrcode";
import type { LiveRoom } from "../live/api";
import type { ServerMember } from "../live/socket";

export type MemberRole = "admin" | "member" | "viewer";

export const ROLE_LABEL: Record<MemberRole, string> = { admin: "Admin", member: "Member", viewer: "Viewer" };
const ROLE_ICON: Record<MemberRole, typeof User> = { admin: Crown, member: User, viewer: Shield };

type Props = {
  room: LiveRoom;
  members: ServerMember[];
  myPeerId: string;
  roomUrl: string;
  /** Creator-only: rename + mode toggle (server requires the admin token). */
  isCreator: boolean;
  /** Any admin can manage member roles. */
  myRole: MemberRole;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onSetMode: (mode: "ephemeral" | "permanent") => Promise<void>;
  onSetRole: (peerId: string, role: MemberRole) => void;
};

export function RoomSettings({ room, members, myPeerId, roomUrl, isCreator, myRole, onClose, onRename, onSetMode, onSetRole }: Props) {
  const [name, setName] = useState(room.name);
  const [saving, setSaving] = useState<"name" | "mode" | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(roomUrl, { width: 168, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => { if (alive) setQr(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [roomUrl]);

  const sorted = useMemo(
    () => [...members].sort((a, b) => (a.role === "admin" ? -1 : 0) - (b.role === "admin" ? -1 : 0) || a.name.localeCompare(b.name)),
    [members]
  );

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === room.name || !trimmed) return;
    setSaving("name");
    try {
      await onRename(trimmed);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } finally {
      setSaving(null);
    }
  }

  async function toggleMode(next: "ephemeral" | "permanent") {
    if (next === room.mode) return;
    setSaving("mode");
    try {
      await onSetMode(next);
    } finally {
      setSaving(null);
    }
  }

  function copyUrl() {
    navigator.clipboard?.writeText(roomUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <motion.div
        className="settings-panel glass"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Room settings"
      >
        <div className="settings-head">
          <div>
            <h3>Room settings</h3>
            <span className="settings-sub">
              {room.name ? `${room.name} · ` : ""}room {room.code}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </div>

        {/* ---------- share ---------- */}
        <section className="settings-section">
          <h4><Link2 size={14} /> Share</h4>
          <div className="share-row">
            <div className="share-qr" title="Scan to join">
              {qr ? <img src={qr} alt="QR code to join this room" /> : <Loader2 size={18} className="spin" />}
            </div>
            <div className="share-copy">
              <input readOnly value={roomUrl} spellCheck={false} aria-label="Room share link" />
              <button className="btn btn-ghost btn-sm" onClick={copyUrl}>
                {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <span className="share-hint">Anyone with the link can join — no signup.</span>
            </div>
          </div>
        </section>

        {/* ---------- name & mode ---------- */}
        {isCreator && (
          <section className="settings-section">
            <h4><HardDrive size={14} /> Room details</h4>
            <div className="settings-field">
              <label htmlFor="room-name">Name</label>
              <div className="field-row">
                <input
                  id="room-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveName()}
                  maxLength={60}
                  placeholder="e.g. Launch Review"
                  spellCheck={false}
                />
                <button className="btn btn-primary btn-sm" onClick={() => void saveName()} disabled={saving === "name" || !name.trim() || name.trim() === room.name}>
                  {saving === "name" ? <Loader2 size={14} className="spin" /> : savedFlash ? <Check size={14} /> : "Save"}
                </button>
              </div>
            </div>

            <div className="settings-field">
              <label>Lifetime</label>
              <div className="mode-toggle">
                <button
                  className={`mode-chip ${room.mode === "ephemeral" ? "mode-chip-active" : ""}`}
                  onClick={() => void toggleMode("ephemeral")}
                  disabled={saving === "mode"}
                >
                  <Zap size={14} /> Ephemeral
                </button>
                <button
                  className={`mode-chip ${room.mode === "permanent" ? "mode-chip-active" : ""}`}
                  onClick={() => void toggleMode("permanent")}
                  disabled={saving === "mode"}
                >
                  <HardDrive size={14} /> Permanent
                </button>
              </div>
              <span className="settings-hint">
                {room.mode === "ephemeral"
                  ? `Burns after TTL (${Math.max(1, Math.round((room.ttlSeconds ?? 0) / 3600))}h) — switching to permanent keeps it forever.`
                  : "Pinned forever — switching to ephemeral adds a TTL."}
              </span>
            </div>
          </section>
        )}

        {/* ---------- members & roles ---------- */}
        <section className="settings-section">
          <h4><Shield size={14} /> Members & roles</h4>
          <div className="settings-members">
            {sorted.map((m) => {
              const RoleIcon = ROLE_ICON[m.role];
              const isMe = m.peerId === myPeerId;
              const canControl = myRole === "admin" && !isMe;
              return (
                <div key={m.peerId} className="settings-member">
                  <span className={`settings-member-avatar role-${m.role}`}>
                    <RoleIcon size={13} />
                  </span>
                  <div className="settings-member-meta">
                    <strong>{m.name}{isMe && <span className="member-you">you</span>}</strong>
                    <span>{ROLE_LABEL[m.role]}</span>
                  </div>
                  {canControl ? (
                    <div className="role-picker">
                      {(["member", "viewer", "admin"] as MemberRole[]).map((r) => (
                        <button
                          key={r}
                          className={`role-pill ${m.role === r ? `role-pill-${r}` : ""}`}
                          onClick={() => onSetRole(m.peerId, r)}
                          title={`Set ${m.name} to ${ROLE_LABEL[r]}`}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className={`role-badge role-badge-${m.role}`}>{ROLE_LABEL[m.role]}</span>
                  )}
                </div>
              );
            })}
          </div>
          {myRole !== "admin" && <span className="settings-hint">Only admins can change roles.</span>}
        </section>
      </motion.div>
    </div>
  );
}
