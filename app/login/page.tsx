"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#f5f7fb",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "#ffffff",
          borderRadius: "20px",
          padding: "32px",
          boxShadow: "0 15px 40px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            marginBottom: "28px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 800,
              color: "#102a43",
            }}
          >
            سنابل الكوثر
          </h1>

          <p
            style={{
              marginTop: "8px",
              color: "#667085",
            }}
          >
            تسجيل الدخول إلى المنصة
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          style={{
            display: "grid",
            gap: "16px",
          }}
        >
          <label
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            <span>البريد الإلكتروني</span>

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="example@email.com"
              required
              autoComplete="email"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                border: "1px solid #d0d5dd",
                borderRadius: "10px",
                fontSize: "15px",
                outline: "none",
              }}
            />
          </label>

          <label
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            <span>كلمة المرور</span>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                border: "1px solid #d0d5dd",
                borderRadius: "10px",
                fontSize: "15px",
                outline: "none",
              }}
            />
          </label>

          {error && (
            <div
              role="alert"
              style={{
                padding: "12px",
                borderRadius: "10px",
                background: "#fef3f2",
                color: "#b42318",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              border: 0,
              borderRadius: "10px",
              padding: "13px",
              background: "#102a43",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
          </button>
        </form>
      </div>
    </main>
  );
}