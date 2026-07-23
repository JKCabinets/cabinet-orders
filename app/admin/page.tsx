"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import { AvatarWithProfile } from "@/components/AvatarWithProfile";
import {
  TeamMember, AvatarColor, Role,
  AVATAR_COLOR_STYLES, AVATAR_COLOR_SWATCH_STYLES, AVATAR_COLOR_OPTIONS,
} from "@/lib/data";
import { Users, Plus, Pencil, UserX, Trash2, Shield, User, Check, X, KeyRound, Eye, EyeOff, UserCog } from "lucide-react";
import { ProfileForm } from "@/components/ProfileForm";
import clsx from "clsx";
import { AuditLog } from "@/components/AuditLog";
import { AppShell, PageHeader } from "@/components/AppShell";
import { useToast } from "@/components/Toast";

export default function AdminPage() {
  const { data: session } = useSession();
  const {
    team, addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember,
    updateTeamMemberProfile, uploadAvatar,
    loading,
  } = useStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [changingPasswordId, setChangingPasswordId] = useState<string | null>(null);
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null);

  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  const { showToast } = useToast();

  if (session && !isAdmin) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-cream/55 text-sm">Access denied. Admins only.</p>
        </div>
      </AppShell>
    );
  }

  const activeMembers = team.filter((m) => m.active);
  const inactiveMembers = team.filter((m) => !m.active);

  if (loading) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-sm text-cream/35">Loading team...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>

      <PageHeader
        eyebrow="Settings"
        title="Team"
        accent="admin"
        right={
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cream/50" />
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-900/30 text-amber-300 border border-amber-700/40 uppercase tracking-wider">Admin</span>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: "Active members", value: activeMembers.length },
            { label: "Admins", value: team.filter((m) => m.role === "admin" && m.active).length },
            { label: "Inactive", value: inactiveMembers.length },
          ].map((s) => (
            <div key={s.label} className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl px-4 py-3.5">
              <p className="text-xs text-[rgba(232,227,218,0.50)] mb-1">{s.label}</p>
              <p className="text-2xl font-medium text-[#e8e3da]">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-[rgba(232,227,218,0.50)]">Active members</h2>
            <button onClick={() => { setShowAddForm(true); setEditingId(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
              <Plus className="w-3.5 h-3.5" />Add member
            </button>
          </div>

          {showAddForm && !editingId && (
            <div className="mb-3">
              <MemberForm
                onSave={async (data) => {
                  const result = await addTeamMember({ ...data, active: true });
                  if (result.ok) {
                    setShowAddForm(false);
                    if (result.temporaryPassword) {
                      showToast(
                        `Member added. Temporary password: ${result.temporaryPassword}`,
                        { kind: "success", durationMs: 30000 },
                      );
                    } else {
                      showToast("Member added successfully", { kind: "success" });
                    }
                  } else {
                    showToast(result.error ?? "Failed to add member", { kind: "error" });
                  }
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {activeMembers.map((member) => (
              <div key={member.id}>
                {editingId === member.id ? (
                  <MemberForm
                    initial={member}
                    onSave={async (data) => {
                      const result = await updateTeamMember(member.id, data);
                      if (result.ok) {
                        setEditingId(null);
                        showToast("Member updated", { kind: "success" });
                      } else {
                        showToast(result.error ?? "Failed to update member", { kind: "error" });
                      }
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : editingProfileId === member.id ? (
                  <ProfileForm
                    member={member}
                    canEdit
                    onUploadPhoto={(file) => uploadAvatar(member.id, file)}
                    onSave={async (fields) => {
                      await updateTeamMemberProfile(member.id, fields);
                      setEditingProfileId(null);
                      showToast(member.name + "'s profile saved", { kind: "success" });
                    }}
                    onCancel={() => setEditingProfileId(null)}
                  />
                ) : changingPasswordId === member.id ? (
                  <PasswordForm
                    member={member}
                    onSave={async (newPassword) => {
                      const result = await updateTeamMember(member.id, { password: newPassword });
                      if (result.ok) {
                        setChangingPasswordId(null);
                        showToast("Password updated — saved to database", { kind: "success" });
                      } else {
                        // Keep the form open so the admin can pick a valid password.
                        showToast(result.error ?? "Failed to update password", { kind: "error" });
                      }
                    }}
                    onCancel={() => setChangingPasswordId(null)}
                  />
                ) : (
                  <MemberRow
                    member={member}
                    onEdit={() => { setEditingId(member.id); setShowAddForm(false); setChangingPasswordId(null); setEditingProfileId(null); }}
                    onChangePassword={() => { setChangingPasswordId(member.id); setEditingId(null); setShowAddForm(false); setEditingProfileId(null); }}
                    onProfile={() => { setEditingProfileId(member.id); setEditingId(null); setShowAddForm(false); setChangingPasswordId(null); }}
                    onRequestAction={() => setConfirmActionId(member.id)}
                    isConfirmingAction={confirmActionId === member.id}
                    onDeactivate={() => { deactivateTeamMember(member.id); setConfirmActionId(null); showToast(`${member.name} deactivated`, { kind: "warn" }); }}
                    onDelete={() => { deleteTeamMember(member.id); setConfirmActionId(null); showToast(`${member.name} permanently deleted`, { kind: "warn" }); }}
                    onCancelAction={() => setConfirmActionId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {inactiveMembers.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-[rgba(232,227,218,0.30)] mb-4">Inactive members</h2>
            <div className="flex flex-col gap-2">
              {inactiveMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between px-4 py-3 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl opacity-50">
                  <div className="flex items-center gap-3">
                    <div style={{ ...AVATAR_COLOR_STYLES[member.avatarColor], borderWidth: 1, borderStyle: "solid" }} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium">{member.initials}</div>
                    <div>
                      <p className="text-sm text-[rgba(232,227,218,0.50)]">{member.name}</p>
                      <p className="text-[10px] text-[rgba(232,227,218,0.30)]">@{member.username} · {member.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { updateTeamMember(member.id, { active: true }); showToast(`${member.name} reactivated`, { kind: "success" }); }} className="text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">Reactivate</button>
                    <button onClick={() => { deleteTeamMember(member.id); showToast(`${member.name} permanently deleted`, { kind: "warn" }); }} className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors ml-2">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl">
          <p className="text-xs font-medium text-[rgba(232,227,218,0.50)] mb-1.5">All changes saved to database</p>
          <p className="text-xs text-[rgba(232,227,218,0.30)] leading-relaxed">Team members, roles, and passwords are stored in Supabase and persist permanently across all deploys and server restarts. Password changes take effect on the next login.</p>
        </div>

        {/* Other admin tools */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="/admin/shopify"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">Shopify sync</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Sync products from Shopify, import orders, backfill payment statuses.</p>
          </a>
          <a href="/admin/vendors"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">Vendors</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Manage vendor RMA contact emails for damage report drafts.</p>
          </a>
          <a href="/admin/mappings"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">SKU mappings</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Assign SKU codes to Avis door styles, colors, and modifications — no deploy needed.</p>
          </a>
        </div>

        <AuditLog />
      </div>
    </AppShell>
  );
}

function MemberRow({ member, onEdit, onChangePassword, onProfile, onRequestAction, isConfirmingAction, onDeactivate, onDelete, onCancelAction }: {
  member: TeamMember; onEdit: () => void; onChangePassword: () => void; onProfile: () => void;
  onRequestAction: () => void; isConfirmingAction: boolean;
  onDeactivate: () => void; onDelete: () => void; onCancelAction: () => void;
}) {
  const { onlineUsers } = useStore();
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl group hover:border-[rgba(86,100,72,0.55)] transition-colors">
      <div className="flex items-center gap-3">
        <AvatarWithProfile member={member} size="md" />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-[#e8e3da]">{member.name}</p>
            <RoleBadge role={member.role} />
          </div>
          <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-0.5">@{member.username} · initials: {member.initials}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isConfirmingAction ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[rgba(232,227,218,0.50)]">Choose:</span>
            <button onClick={onDeactivate} className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-900/30 text-amber-400 hover:bg-amber-900/50 transition-colors">
              <UserX className="w-3 h-3" /> Deactivate
            </button>
            <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
            <button onClick={onCancelAction} className="text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <button onClick={onProfile} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
              <UserCog className="w-3 h-3" />Profile
            </button>
            <button onClick={onChangePassword} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
              <KeyRound className="w-3 h-3" />Password
            </button>
            <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
              <Pencil className="w-3 h-3" />Edit
            </button>
            <button onClick={onRequestAction} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-red-400 hover:border-red-900 transition-all">
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PasswordForm({ member, onSave, onCancel }: { member: TeamMember; onSave: (password: string) => void; onCancel: () => void; }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  const checks = [
    { label: "10+ characters",   ok: newPassword.length >= 10 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(newPassword) },
    { label: "Lowercase letter", ok: /[a-z]/.test(newPassword) },
    { label: "Number",           ok: /[0-9]/.test(newPassword) },
    { label: "Special character",ok: /[^A-Za-z0-9]/.test(newPassword) },
  ];
  const allChecksPassed = checks.every(c => c.ok);

  function handleSave() {
    if (!allChecksPassed) { setError("Password does not meet all requirements."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    onSave(newPassword);
  }

  return (
    <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <div style={{ ...AVATAR_COLOR_STYLES[member.avatarColor], borderWidth: 1, borderStyle: "solid" }} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium">{member.initials}</div>
        <p className="text-xs font-medium text-[rgba(232,227,218,0.50)]">Change password for <span className="text-[#f0ece4]">{member.name}</span></p>
      </div>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <div className="flex flex-col gap-3 mb-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">New password</label>
          <div className="relative">
            <input type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setError(""); }} placeholder="Min. 10 chars, upper, number, symbol" autoFocus className="field-input pr-9" />
            <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(232,227,218,0.30)] hover:text-[rgba(232,227,218,0.50)]">
              {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {newPassword.length > 0 && (
          <div className="grid grid-cols-2 gap-1 px-0.5">
            {checks.map(ch => (
              <div key={ch.label} className="flex items-center gap-1.5">
                <span className={"w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 " + (ch.ok ? "bg-[rgba(86,160,72,0.25)] text-green-400" : "bg-[rgba(255,255,255,0.05)] text-[rgba(232,227,218,0.25)]")}>
                  {ch.ok ? "✓" : "·"}
                </span>
                <span className={"text-[10px] " + (ch.ok ? "text-green-400" : "text-[rgba(232,227,218,0.35)]")}>{ch.label}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Confirm password</label>
          <div className="relative">
            <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }} placeholder="Repeat password" className="field-input pr-9" />
            <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(232,227,218,0.30)] hover:text-[rgba(232,227,218,0.50)]">
              {showConfirm ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#f0ece4] hover:border-[rgba(86,100,72,0.55)] transition-all">Cancel</button>
        <button onClick={handleSave} disabled={!newPassword || !confirmPassword || !allChecksPassed} className="flex-1 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-xs text-[#f0ece4] font-medium hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40 disabled:cursor-not-allowed transition-all">Update password</button>
      </div>
    </div>
  );
}

function MemberForm({ initial, onSave, onCancel }: { initial?: TeamMember; onSave: (data: Omit<TeamMember, "id">) => void; onCancel: () => void; }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [initials, setInitials] = useState(initial?.initials ?? "");
  const [role, setRole] = useState<Role>(initial?.role ?? "member");
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(initial?.avatarColor ?? "blue");

  function handleSave() {
    if (!name.trim() || !username.trim() || !initials.trim()) return;
    onSave({ name: name.trim(), username: username.trim().toLowerCase(), initials: initials.trim().toUpperCase().slice(0, 2), role, avatarColor, active: true });
  }

  return (
    <div className="bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-xl p-4">
      <p className="text-xs font-medium text-[rgba(232,227,218,0.50)] mb-4">{initial ? "Edit member" : "Add new member"}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Johnson" className="field-input" autoFocus /></Field>
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="aj" className="field-input font-mono" /></Field>
        <Field label="Initials (2 chars)"><input value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 2))} placeholder="AJ" maxLength={2} className="field-input font-mono tracking-widest" /></Field>
        <Field label="Role">
          <div className="flex gap-2 mt-1">
            {(["member", "admin"] as Role[]).map((r) => (
              <button key={r} onClick={() => setRole(r)} className={clsx("flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs transition-all", role === r ? "bg-[rgba(255,255,255,0.06)] border-[rgba(86,100,72,0.55)] text-[#e8e3da]" : "border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:border-[rgba(86,100,72,0.55)]")}>
                {r === "admin" ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}{r}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Avatar color">
        <div className="flex gap-2 mt-1">
          {AVATAR_COLOR_OPTIONS.map((color) => (
            <button key={color} onClick={() => setAvatarColor(color)} title={color}
              style={{ ...AVATAR_COLOR_SWATCH_STYLES[color], borderWidth: 2, borderStyle: "solid", borderColor: avatarColor === color ? "white" : "transparent", transform: avatarColor === color ? "scale(1.1)" : undefined, opacity: avatarColor === color ? 1 : 0.7 }} className="w-7 h-7 rounded-full flex items-center justify-center transition-all">
              {avatarColor === color && <Check className="w-3 h-3 text-white" />}
            </button>
          ))}
        </div>
      </Field>
      {initials && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[rgba(232,227,218,0.30)]">
          <span>Preview:</span>
          <div style={{ ...AVATAR_COLOR_STYLES[avatarColor], borderWidth: 2, borderStyle: "solid" }} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium">{initials}</div>
          <span className="text-[rgba(232,227,218,0.50)]">{name || "Name"}</span>
          <RoleBadge role={role} />
        </div>
      )}
      <div className="flex gap-2 mt-4">
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">Cancel</button>
        <button onClick={handleSave} disabled={!name || !username || !initials} className="flex-1 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-xs text-[#e8e3da] font-medium hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40 disabled:cursor-not-allowed transition-all">{initial ? "Save changes" : "Add member"}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={clsx("text-[10px] px-2 py-0.5 rounded-md border font-medium", role === "admin" ? "bg-amber-900/60 text-amber-300 border-amber-700" : "bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.50)] border-[rgba(255,255,255,0.10)]")}>{role}</span>
  );
}
