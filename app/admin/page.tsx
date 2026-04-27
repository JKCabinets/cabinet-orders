"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  TeamMember, AvatarColor, Role,
  AVATAR_COLOR_STYLES, AVATAR_COLOR_SWATCH_STYLES, AVATAR_COLOR_OPTIONS,
} from "@/lib/data";
import { Users, Plus, Pencil, UserX, Trash2, ChevronLeft, Shield, User, Check, X, KeyRound, Eye, EyeOff } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { AuditLog } from "@/components/AuditLog";

export default function AdminPage() {
  const { data: session } = useSession();
  const { team, addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember, loading } = useStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changingPasswordId, setChangingPasswordId] = useState<string | null>(null);
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  if (session && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[rgba(232,227,218,0.50)] text-sm">Access denied. Admins only.</p>
      </div>
    );
  }

  const activeMembers = team.filter((m) => m.active);
  const inactiveMembers = team.filter((m) => !m.active);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[rgba(232,227,218,0.30)]">Loading team...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-xl px-4 py-3 text-sm text-[#e8e3da] shadow-lg animate-slide-in" style={{background:"rgba(255,255,255,0.07)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",border:"0.5px solid rgba(255,255,255,0.14)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.12), 0 16px 40px rgba(0,0,0,0.4)"}}>
          {toast}
        </div>
      )}

      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5" style={{background:"rgba(30,42,53,0.85)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",borderBottom:"0.5px solid rgba(255,255,255,0.10)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors mr-2">
            <ChevronLeft className="w-3.5 h-3.5" />Back
          </Link>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.12)]" />
          <Users className="w-4 h-4 text-[rgba(232,227,218,0.50)] ml-2" />
          <h1 className="text-sm font-medium text-[#e8e3da]">Team admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-md bg-amber-900/60 text-amber-300 border border-amber-700">Admin</span>
          <span className="text-xs text-[rgba(232,227,218,0.50)]">{user?.name}</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
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
                onSave={(data) => { addTeamMember({ ...data, active: true }); setShowAddForm(false); showToast("Member added successfully"); }}
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
                    onSave={(data) => { updateTeamMember(member.id, data); setEditingId(null); showToast("Member updated"); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : changingPasswordId === member.id ? (
                  <PasswordForm
                    member={member}
                    onSave={(newPassword) => {
                      updateTeamMember(member.id, { password: newPassword });
                      setChangingPasswordId(null);
                      showToast("Password updated — saved to database");
                    }}
                    onCancel={() => setChangingPasswordId(null)}
                  />
                ) : (
                  <MemberRow
                    member={member}
                    onEdit={() => { setEditingId(member.id); setShowAddForm(false); setChangingPasswordId(null); }}
                    onChangePassword={() => { setChangingPasswordId(member.id); setEditingId(null); setShowAddForm(false); }}
                    onRequestAction={() => setConfirmActionId(member.id)}
                    isConfirmingAction={confirmActionId === member.id}
                    onDeactivate={() => { deactivateTeamMember(member.id); setConfirmActionId(null); showToast(`${member.name} deactivated`); }}
                    onDelete={() => { deleteTeamMember(member.id); setConfirmActionId(null); showToast(`${member.name} permanently deleted`); }}
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
                    <button onClick={() => { updateTeamMember(member.id, { active: true }); showToast(`${member.name} reactivated`); }} className="text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">Reactivate</button>
                    <button onClick={() => { deleteTeamMember(member.id); showToast(`${member.name} permanently deleted`); }} className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors ml-2">Delete</button>
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

        <AuditLog />
      </div>
    </div>
  );
}

function MemberRow({ member, onEdit, onChangePassword, onRequestAction, isConfirmingAction, onDeactivate, onDelete, onCancelAction }: {
  member: TeamMember; onEdit: () => void; onChangePassword: () => void;
  onRequestAction: () => void; isConfirmingAction: boolean;
  onDeactivate: () => void; onDelete: () => void; onCancelAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl group hover:border-[rgba(86,100,72,0.55)] transition-colors">
      <div className="flex items-center gap-3">
        <div style={{ ...AVATAR_COLOR_STYLES[member.avatarColor], borderWidth: 2, borderStyle: "solid" }} className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium">
          {member.initials}
        </div>
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
