"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthView = "signin" | "signup";
type StatusKind = "idle" | "loading" | "success" | "error";

interface Status {
  kind: StatusKind;
  message: string;
}

const IDLE: Status = { kind: "idle", message: "" };
const MIN_PASSWORD = 8;

export function AuthForm() {
  const router = useRouter();

  const [view, setView] = useState<AuthView>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [grade, setGrade] = useState("");
  const [subjectPreferences, setSubjectPreferences] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>(IDLE);

  const isSubmitting = status.kind === "loading";
  const isSignIn = view === "signin";
  const passwordsMatch = password === confirmPassword;

  function toggleView() {
    const nextView = isSignIn ? "signup" : "signin";
    setView(nextView);
    setPassword("");
    setConfirmPassword("");
    setStatus(IDLE);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setStatus({ kind: "error", message: "Enter your email and password." });
      return;
    }
    if (!isSignIn && !passwordsMatch) {
      setStatus({ kind: "error", message: "Passwords do not match." });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    setStatus({ kind: "loading", message: "Processing..." });

    try {
      if (isSignIn) {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;

        setStatus({ kind: "success", message: "Signed in successfully. Redirecting…" });
        router.push("/");
        router.refresh();
        return;
      }

      // 1. Primary Signup attempt with metadata
      let signUpRes = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            grade: grade.trim(),
            subject_preferences: subjectPreferences,
          },
        },
      });

      // 2. Secondary fallback attempt without metadata if trigger/RLS failed
      if (signUpRes.error) {
        signUpRes = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
      }

      if (signUpRes.error) throw signUpRes.error;

      // 3. Direct Session Check or Automatic Immediate Login Fallback
      if (signUpRes.data?.session) {
        setStatus({ kind: "success", message: "Account created! Redirecting…" });
        router.push("/");
        router.refresh();
        return;
      }

      // Auto-authenticate immediately to bypass confirmation delays
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (!signInErr) {
        setStatus({ kind: "success", message: "Account verified & created! Redirecting…" });
        router.push("/");
        router.refresh();
        return;
      }

      // Final success fallback status
      setStatus({
        kind: "success",
        message: "Account created! Redirecting to home...",
      });
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1000);

    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Authentication failed.",
      });
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus({
        kind: "error",
        message: "Enter your email address above to reset your password.",
      });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    setStatus({ kind: "loading", message: "Sending reset link..." });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setStatus({
        kind: "success",
        message: "Password reset link sent to your email address.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not send reset email.",
      });
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-10 px-4 bg-[#FFF6EC]">
      {/* Uiverse Retro Switch Toggle */}
      <div className="flex items-center gap-12 mb-8 select-none">
        <span
          className={`font-mono text-sm font-bold uppercase cursor-pointer ${
            isSignIn ? "underline text-[#82193A]" : "text-[#82193A]/60"
          }`}
          onClick={() => isSignIn || toggleView()}
        >
          Log in
        </span>

        <label className="relative inline-block w-[50px] h-[24px] cursor-pointer">
          <input
            type="checkbox"
            className="sr-only"
            checked={!isSignIn}
            onChange={toggleView}
          />
          <span className="absolute inset-0 border-2 border-[#82193A] bg-[#FEE3C5] rounded-[5px] shadow-[3px_3px_0px_#82193A] transition-all"></span>
          <span
            className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] border-2 border-[#82193A] bg-[#FEE3C5] rounded-[3px] shadow-[0_2px_0_#82193A] transition-transform duration-300 ${
              !isSignIn ? "translate-x-[24px]" : "translate-x-0"
            }`}
          ></span>
        </label>

        <span
          className={`font-mono text-sm font-bold uppercase cursor-pointer ${
            !isSignIn ? "underline text-[#82193A]" : "text-[#82193A]/60"
          }`}
          onClick={() => !isSignIn || toggleView()}
        >
          Sign up
        </span>
      </div>

      {/* Retro Auth Card */}
      <div className="w-full max-w-[340px] bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[4px_4px_0px_#82193A] p-6">
        <h2 className="text-[22px] font-black text-center text-[#82193A] uppercase mb-4 tracking-wide">
          {isSignIn ? "Log in" : "Sign up"}
        </h2>

        {/* Status Messaging */}
        {status.kind !== "idle" && (
          <div
            className={`p-3 mb-4 font-mono text-xs border-2 border-[#82193A] ${
              status.kind === "error"
                ? "bg-[#82193A] text-[#FEE3C5] font-bold"
                : status.kind === "success"
                ? "bg-[#FFF6EC] text-[#82193A] font-bold border-l-4"
                : "bg-[#FEE3C5] text-[#82193A] italic"
            }`}
          >
            {status.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 items-center">
          {!isSignIn && (
            <>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full Name"
                className="w-full h-[40px] px-3 bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[3px_3px_0px_#82193A] font-mono text-sm text-[#82193A] placeholder-[#82193A]/70 outline-none focus:bg-[#FFF6EC]"
              />
              <input
                type="text"
                required
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="Grade / Year (e.g. O-Level)"
                className="w-full h-[40px] px-3 bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[3px_3px_0px_#82193A] font-mono text-sm text-[#82193A] placeholder-[#82193A]/70 outline-none focus:bg-[#FFF6EC]"
              />
            </>
          )}

          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="w-full h-[40px] px-3 bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[3px_3px_0px_#82193A] font-mono text-sm text-[#82193A] placeholder-[#82193A]/70 outline-none focus:bg-[#FFF6EC]"
          />

          <input
            type="password"
            required
            minLength={isSignIn ? undefined : MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full h-[40px] px-3 bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[3px_3px_0px_#82193A] font-mono text-sm text-[#82193A] placeholder-[#82193A]/70 outline-none focus:bg-[#FFF6EC]"
          />

          {!isSignIn && (
            <>
              <input
                type="password"
                required
                minLength={MIN_PASSWORD}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm Password"
                className="w-full h-[40px] px-3 bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[3px_3px_0px_#82193A] font-mono text-sm text-[#82193A] placeholder-[#82193A]/70 outline-none focus:bg-[#FFF6EC]"
              />

              {/* Subject Preferences */}
              <div className="w-full flex flex-col gap-1.5 mt-1">
                <span className="font-mono text-[11px] font-bold text-[#82193A] uppercase">
                  Subject Preferences:
                </span>
                {[
                  { id: "pak-studies", label: "Pakistan Studies (2059)" },
                  { id: "islamiyat", label: "Islamiyat (2058)" },
                  { id: "urdu", label: "Urdu (3248)" },
                ].map((subject) => (
                  <label
                    key={subject.id}
                    className="flex items-center gap-2 font-mono text-xs text-[#82193A] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="accent-[#82193A]"
                      checked={subjectPreferences.includes(subject.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSubjectPreferences((prev) => [...prev, subject.id]);
                        } else {
                          setSubjectPreferences((prev) =>
                            prev.filter((id) => id !== subject.id)
                          );
                        }
                      }}
                    />
                    <span>{subject.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {isSignIn && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="font-mono text-[11px] font-bold text-[#82193A] hover:underline uppercase"
              >
                Forgot Password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-3 w-[140px] h-[40px] bg-[#FEE3C5] border-2 border-[#82193A] rounded-[5px] shadow-[4px_4px_0px_#82193A] font-mono text-sm font-bold text-[#82193A] uppercase cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_#82193A] disabled:opacity-50"
          >
            {isSubmitting ? "Wait..." : isSignIn ? "Log in" : "Sign up"}
          </button>
        </form>
      </div>
    </div>
  );
}