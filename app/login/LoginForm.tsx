"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const errorParam = searchParams.get("error");
  const [error, setError] = useState(
    errorParam === "CredentialsSignin" ? "Invalid username or password." :
    errorParam ? decodeURIComponent(errorParam) : ""
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (result?.error) { setError("Invalid username or password."); return; }
    router.push(callbackUrl);
    router.refresh();
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.25)",
    border: "0.5px solid rgba(255,255,255,0.15)",
    boxShadow: "inset 0 2px 6px rgba(0,0,0,0.20)",
    borderRadius: "10px",
    color: "#f0ece4",
    fontSize: "16px",
    padding: "10px 13px",
    width: "100%",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
    outline: "none",
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: "#1a2d3d",
        backgroundImage: `
          radial-gradient(ellipse at 30% 20%, rgba(86,100,72,0.35) 0%, transparent 50%),
          radial-gradient(ellipse at 75% 80%, rgba(20,50,90,0.40) 0%, transparent 55%)
        `,
      }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{
            background: "rgba(86,100,72,0.28)",
            border: "0.5px solid rgba(86,100,72,0.65)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), 0 4px 20px rgba(86,100,72,0.20)",
          }}>
            <Package className="w-6 h-6" style={{ color: "#a0cc7a" }} />
          </div>
          <h1 className="text-xl font-bold tracking-wide text-[#f0ece4]">JK Cabinets</h1>
          <p className="text-sm text-[rgba(240,236,228,0.55)] mt-1">Sign in to your team account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6" style={{
          background: "rgba(255,255,255,0.07)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border: "0.5px solid rgba(255,255,255,0.14)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 60px rgba(0,0,0,0.40)",
        }}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{
                background: "rgba(224,85,85,0.12)",
                border: "0.5px solid rgba(224,85,85,0.40)",
              }}>
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[rgba(240,236,228,0.55)] mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                required
                autoComplete="username"
                autoFocus
                style={inputStyle}
                className="placeholder:text-[rgba(240,236,228,0.25)] focus:border-[rgba(86,100,72,0.75)]"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[rgba(240,236,228,0.55)] mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: "42px" }}
                  className="placeholder:text-[rgba(240,236,228,0.25)] focus:border-[rgba(86,100,72,0.75)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:text-[#f0ece4]"
                  style={{ color: "rgba(240,236,228,0.45)" }}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all duration-150 mt-1 hover:brightness-115 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "rgba(86,100,72,0.50)",
                border: "0.5px solid rgba(120,160,90,0.80)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 4px 16px rgba(86,100,72,0.30)",
                color: "#c8f0a0",
              }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-[rgba(240,236,228,0.25)] mt-6 tracking-wide">
          JK Cabinets · Internal tool
        </p>
      </div>
    </div>
  );
}
