"use client";

import { useState, useRef } from "react";
import { TeamMember } from "@/lib/data";
import { Camera, Save, X as XIcon, Loader2, Power } from "lucide-react";

/**
 * Editable profile form for a team member. Used by:
 *   - /admin page (inline expansion) when an admin clicks "Profile" on a row
 *   - /profile page when a user edits their own profile
 *   - /profile/[username] page when an admin edits someone else
 *
 * The form does NOT know who is viewing — that's the parent's job. Pass
 * `canEdit={true}` to allow saves; otherwise the form renders read-only.
 *
 * Save flow:
 *   1. If a new photo was picked, upload it first via onUploadPhoto.
 *   2. Then call onSave with the non-photo fields. The parent decides
 *      whether to optimistically update local state or refetch.
 */

export type ProfileFormFields = {
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
  roleTitle: string | null;
  bio: string | null;
  workingHours: string | null;
  timezone: string | null;
  slackHandle: string | null;
  oooStatus: boolean;
  oooMessage: string | null;
  oooUntil: string | null;
};

export function ProfileForm({
  member,
  canEdit,
  onSave,
  onUploadPhoto,
  onCancel,
}: {
  member: TeamMember;
  canEdit: boolean;
  onSave: (fields: ProfileFormFields) => Promise<void> | void;
  onUploadPhoto: (file: File) => Promise<string>; // returns new photoUrl
  onCancel?: () => void;
}) {
  const [photoUrl, setPhotoUrl]         = useState<string | null>(member.photoUrl ?? null);
  const [phone, setPhone]               = useState(member.phone ?? "");
  const [email, setEmail]               = useState(member.email ?? "");
  const [roleTitle, setRoleTitle]       = useState(member.roleTitle ?? "");
  const [bio, setBio]                   = useState(member.bio ?? "");
  const [workingHours, setWorkingHours] = useState(member.workingHours ?? "");
  const [timezone, setTimezone]         = useState(member.timezone ?? "");
  const [slackHandle, setSlackHandle]   = useState(member.slackHandle ?? "");
  const [oooStatus, setOooStatus]       = useState(member.oooStatus ?? false);
  const [oooMessage, setOooMessage]     = useState(member.oooMessage ?? "");
  const [oooUntil, setOooUntil]         = useState(member.oooUntil ?? "");

  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so picking the same file twice still triggers the change event
    e.target.value = "";

    setError(null);
    setPhotoUploading(true);
    try {
      const newUrl = await onUploadPhoto(file);
      setPhotoUrl(newUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleSave() {
    if (!canEdit) return;
    setError(null);
    setSaving(true);
    try {
      const trimOrNull = (s: string) => {
        const t = s.trim();
        return t.length ? t : null;
      };
      await onSave({
        photoUrl, // already a URL (or null) — uploads happen separately
        phone:        trimOrNull(phone),
        email:        trimOrNull(email),
        roleTitle:    trimOrNull(roleTitle),
        bio:          trimOrNull(bio),
        workingHours: trimOrNull(workingHours),
        timezone:     trimOrNull(timezone),
        slackHandle:  trimOrNull(slackHandle),
        oooStatus,
        oooMessage:   trimOrNull(oooMessage),
        oooUntil:     trimOrNull(oooUntil),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const inputDisabled = !canEdit || saving;

  return (
    <div className="bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-xl p-5">
      <p className="text-xs font-medium text-[rgba(232,227,218,0.50)] mb-4">
        {canEdit ? "Edit profile" : "Profile"} — {member.name}
      </p>

      {/* Photo upload */}
      <div className="flex items-center gap-4 mb-5 pb-5 border-b border-[rgba(255,255,255,0.06)]">
        <div className="relative">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={member.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-[rgba(86,100,72,0.55)]"
            />
          ) : (
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-sm font-medium border-2 border-[rgba(86,100,72,0.55)] bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.50)]">
              {member.initials}
            </div>
          )}
          {photoUploading && (
            <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-cream animate-spin" />
            </div>
          )}
        </div>
        {canEdit && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handlePhotoPick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all disabled:opacity-40"
            >
              <Camera className="w-3.5 h-3.5" />
              {photoUrl ? "Replace photo" : "Upload photo"}
            </button>
            {photoUrl && (
              <button
                type="button"
                onClick={() => setPhotoUrl(null)}
                disabled={photoUploading}
                className="ml-2 text-[10px] text-[rgba(232,227,218,0.30)] hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            )}
            <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-1.5">
              JPG, PNG, WebP, or GIF. Up to 2 MB.
            </p>
          </div>
        )}
      </div>

      {/* Two-column grid of fields */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Role / title">
          <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} disabled={inputDisabled} placeholder="Lead Designer" className="field-input" />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={inputDisabled} placeholder="(555) 123-4567" className="field-input" />
        </Field>
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={inputDisabled} placeholder="name@jkcabinets.com" type="email" className="field-input" />
        </Field>
        <Field label="Slack / Teams handle">
          <input value={slackHandle} onChange={(e) => setSlackHandle(e.target.value)} disabled={inputDisabled} placeholder="@yourhandle" className="field-input" />
        </Field>
        <Field label="Working hours">
          <input value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} disabled={inputDisabled} placeholder="9-5 PT, Mon-Fri" className="field-input" />
        </Field>
        <Field label="Timezone">
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={inputDisabled} placeholder="America/Phoenix" className="field-input font-mono" />
        </Field>
      </div>

      <Field label="Bio">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} disabled={inputDisabled} rows={3} placeholder="A short note about you..." className="field-input resize-none" />
      </Field>

      {/* Out-of-office section */}
      <div className="mt-5 pt-5 border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.50)]">
            <Power className="w-3 h-3" />
            Out of office
          </label>
          <button
            type="button"
            onClick={() => setOooStatus((s) => !s)}
            disabled={inputDisabled}
            role="switch"
            aria-checked={oooStatus}
            className={[
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              oooStatus ? "bg-amber-700/60" : "bg-[rgba(255,255,255,0.10)]",
              inputDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-3.5 w-3.5 transform rounded-full bg-[#e8e3da] transition-transform",
                oooStatus ? "translate-x-5" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>
        {oooStatus && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Back on">
              <input type="date" value={oooUntil} onChange={(e) => setOooUntil(e.target.value)} disabled={inputDisabled} className="field-input font-mono" />
            </Field>
            <Field label="Message (optional)">
              <input value={oooMessage} onChange={(e) => setOooMessage(e.target.value)} disabled={inputDisabled} placeholder="Contact Aaron for urgent issues" className="field-input" />
            </Field>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Buttons */}
      {canEdit && (
        <div className="flex gap-2 mt-5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all disabled:opacity-40"
            >
              <XIcon className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-xs text-[#e8e3da] font-medium hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                Save changes
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
