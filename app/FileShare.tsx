"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Share = {
  id: string;
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type Props = {
  userId: string;
  filePath: string;
  fileName: string;
};

export default function FileShare({
  userId,
  filePath,
  fileName,
}: Props) {
  const [shares, setShares] = useState<Share[]>([]);
  const [expiry, setExpiry] = useState("never");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");

  async function loadShares() {
    const { data, error } = await supabase
      .from("file_shares")
      .select("id, token, expires_at, revoked_at, created_at")
      .eq("user_id", userId)
      .eq("file_path", filePath)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("خطا در دریافت لینک‌ها");
      return;
    }

    setShares(data || []);
  }

  useEffect(() => {
    loadShares();
  }, [userId, filePath]);

  async function createShare() {
    if (!baseUrl) {
      setMessage("آدرس Supabase تنظیم نشده است.");
      return;
    }

    setLoading(true);
    setMessage("");

    const expiresAt =
      expiry === "never"
        ? null
        : new Date(
            Date.now() + Number(expiry) * 24 * 60 * 60 * 1000
          ).toISOString();

    const { data, error } = await supabase
      .from("file_shares")
      .insert({
        user_id: userId,
        file_path: filePath,
        file_name: fileName,
        expires_at: expiresAt,
      })
      .select("id, token, expires_at, revoked_at, created_at")
      .single();

    setLoading(false);

    if (error || !data) {
      setMessage("ساخت لینک ناموفق بود.");
      return;
    }

    setShares((previous) => [data, ...previous]);
    setMessage("لینک ساخته شد.");
  }

  async function copyLink(token: string) {
    const url = `${baseUrl}/functions/v1/download-shared-file?token=${token}`;

    try {
      await navigator.clipboard.writeText(url);
      setMessage("لینک کپی شد.");
    } catch {
      setMessage("کپی خودکار نشد؛ لینک را از کادر زیر کپی کن.");
    }
  }

  async function revokeShare(id: string) {
    const { error } = await supabase
      .from("file_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      setMessage("غیرفعال‌سازی لینک ناموفق بود.");
      return;
    }

    setShares((previous) =>
      previous.map((share) =>
        share.id === id
          ? { ...share, revoked_at: new Date().toISOString() }
          : share
      )
    );

    setMessage("لینک غیرفعال شد.");
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        marginTop: 8,
        padding: 10,
        borderRadius: 12,
        background: "rgba(255,255,255,0.06)",
      }}
    >
      <strong style={{ fontSize: 13 }}>اشتراک‌گذاری فایل</strong>

      <select
        value={expiry}
        onChange={(e) => setExpiry(e.target.value)}
        style={{
          padding: 9,
          borderRadius: 8,
          border: "1px solid #64748b",
          background: "#172033",
          color: "white",
        }}
      >
        <option value="never">بدون تاریخ انقضا</option>
        <option value="1">اعتبار ۱ روز</option>
        <option value="7">اعتبار ۷ روز</option>
        <option value="30">اعتبار ۳۰ روز</option>
      </select>

      <button
        type="button"
        onClick={createShare}
        disabled={loading}
        style={{
          padding: 10,
          border: 0,
          borderRadius: 8,
          background: "#2563eb",
          color: "white",
          cursor: "pointer",
        }}
      >
        {loading ? "در حال ساخت..." : "ساخت لینک اشتراک"}
      </button>

      {shares.map((share) => {
        const active =
          !share.revoked_at &&
          (!share.expires_at ||
            new Date(share.expires_at).getTime() > Date.now());

        const url = `${baseUrl}/functions/v1/download-shared-file?token=${share.token}`;

        return (
          <div
            key={share.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 8,
              borderRadius: 8,
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <span style={{ fontSize: 12 }}>
              وضعیت: {active ? "فعال" : "غیرفعال یا منقضی"}
            </span>

            <input
              readOnly
              value={url}
              dir="ltr"
              onClick={(e) => e.currentTarget.select()}
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 7,
                border: "1px solid #64748b",
                background: "#101827",
                color: "white",
                fontSize: 11,
              }}
            />

            <button
              type="button"
              onClick={() => copyLink(share.token)}
              style={{
                padding: 8,
                border: 0,
                borderRadius: 7,
                background: "#0d9488",
                color: "white",
              }}
            >
              کپی لینک
            </button>

            {active && (
              <button
                type="button"
                onClick={() => revokeShare(share.id)}
                style={{
                  padding: 8,
                  border: 0,
                  borderRadius: 7,
                  background: "#b91c1c",
                  color: "white",
                }}
              >
                غیرفعال کردن لینک
              </button>
            )}
          </div>
        );
      })}

      {message && (
        <span style={{ fontSize: 12 }}>{message}</span>
      )}
    </div>
  );
        }
