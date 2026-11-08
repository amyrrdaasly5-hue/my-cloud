
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const DEFAULT_LIMIT = 15 * 1024 * 1024 * 1024;

type FileRow = {
  name: string;
  id: string;
  metadata?: { size?: number } | null;
};

type AdminUser = {
  id: string;
  email: string;
  role: string;
  quota_bytes: number;
  is_blocked: boolean;
  created_at: string;
};

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<any>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [used, setUsed] = useState(0);
  const [quota, setQuota] = useState(DEFAULT_LIMIT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [userSearch, setUserSearch] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  async function refreshFiles() {
    if (!user) return;

    const { data, error } = await supabase.storage
      .from("user-files")
      .list(user.id, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    const rows = (data ?? []) as FileRow[];
    setFiles(rows);
    setUsed(
      rows.reduce((sum, f) => sum + (f.metadata?.size ?? 0), 0)
    );
  }

  async function loadAccount() {
    if (!user) return;

    const { data, error } = await supabase.rpc("is_admin");

    if (error) {
      setIsAdmin(false);
      setMessage("خطا در بررسی دسترسی مدیر: " + error.message);
      return;
    }

    const admin = data === true;
    setIsAdmin(admin);

    if (!admin) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("quota_bytes")
        .eq("id", user.id)
        .maybeSingle();

      setQuota(
        profile?.quota_bytes
          ? Number(profile.quota_bytes)
          : DEFAULT_LIMIT
      );
      return;
    }

    const { data: users, error: usersError } =
      await supabase.rpc("admin_list_users");

    if (usersError) {
      setMessage("خطا در دریافت کاربران: " + usersError.message);
      return;
    }

    const list = (users ?? []) as AdminUser[];
    setAdminUsers(list);

    setQuotaDrafts(
      Object.fromEntries(
        list.map((u) => [
          u.id,
          (Number(u.quota_bytes) / 1024 / 1024 / 1024).toString(),
        ])
      )
    );
  }

  useEffect(() => {
    if (user) {
      refreshFiles();
      loadAccount();
    } else {
      setIsAdmin(false);
      setAdminUsers([]);
      setFiles([]);
      setUsed(0);
      setQuota(DEFAULT_LIMIT);
      setUserSearch("");
    }
  }, [user]);

  async function signUp() {
    setBusy(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    setMessage(
      error
        ? error.message
        : "ثبت‌نام انجام شد. اگر تأیید ایمیل فعال باشد، ایمیلت را بررسی کن."
    );

    setBusy(false);
  }

  async function signIn() {
    setBusy(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setMessage(error ? error.message : "با موفقیت وارد شدی.");
    setBusy(false);
  }

  async function upload(file?: File) {
    if (!file || !user) return;

    setBusy(true);
    setMessage("");

    if (!isAdmin && used + file.size > quota) {
      setMessage("با این فایل از سقف فضای حسابت عبور می‌کنی.");
      setBusy(false);
      return;
    }

    const safeName = file.name.replace(/[^\w.\-آ-ی]/g, "_");
    const path = `${user.id}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from("user-files")
      .upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });

    setMessage(
      error ? error.message : "فایل با موفقیت بارگذاری شد."
    );

    await refreshFiles();
    setBusy(false);
  }

  async function download(name: string) {
    const { data, error } = await supabase.storage
      .from("user-files")
      .download(`${user.id}/${name}`);

    if (error || !data) {
      setMessage(error?.message ?? "دانلود ناموفق بود.");
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(name: string) {
    const { error } = await supabase.storage
      .from("user-files")
      .remove([`${user.id}/${name}`]);

    setMessage(error ? error.message : "فایل حذف شد.");
    await refreshFiles();
  }

  async function updateQuota(target: AdminUser) {
    if (target.id === user.id) {
      setMessage("نمی‌توانی سهمیه حساب مدیر را از این بخش تغییر بدهی.");
      return;
    }

    const gb = Number(quotaDrafts[target.id]);

    if (!Number.isFinite(gb) || gb < 0) {
      setMessage("مقدار فضای واردشده معتبر نیست.");
      return;
    }

    setBusy(true);
    setMessage("");

    const bytes = Math.round(gb * 1024 * 1024 * 1024);

    const { error } = await supabase.rpc("admin_update_user", {
      target_id: target.id,
      new_quota_bytes: bytes,
      new_is_blocked: target.is_blocked,
    });

    if (error) {
      setMessage("خطا در تغییر فضا: " + error.message);
    } else {
      setMessage("سهمیه فضای کاربر تغییر کرد.");
      await loadAccount();
    }

    setBusy(false);
  }

  async function toggleBlock(target: AdminUser) {
    if (target.id === user.id) {
      setMessage("امکان مسدودکردن حساب مدیر وجود ندارد.");
      return;
    }

    const action = target.is_blocked ? "فعال‌کردن" : "مسدودکردن";

    if (!window.confirm(`آیا از ${action} این کاربر مطمئنی؟`)) {
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase.rpc("admin_update_user", {
      target_id: target.id,
      new_quota_bytes: Number(target.quota_bytes),
      new_is_blocked: !target.is_blocked,
    });

    if (error) {
      setMessage("خطا در تغییر وضعیت: " + error.message);
    } else {
      setMessage(
        target.is_blocked
          ? "وضعیت کاربر به فعال تغییر کرد."
          : "وضعیت کاربر به مسدود تغییر کرد."
      );
      await loadAccount();
    }

    setBusy(false);
  }

  const formatGB = (bytes: number) =>
    (bytes / 1024 / 1024 / 1024).toFixed(2);

  const filteredUsers = adminUsers.filter((u) => {
    const search = userSearch.trim().toLowerCase();

    return (
      u.id.toLowerCase().includes(search) ||
      (u.email || "").toLowerCase().includes(search)
    );
  });

  return (
    <main className="shell">
      <header>
        <div className="brand">
          <span className="cloud">☁</span>
          <div>
            <b>My Cloud</b>
            <small>فضای ابری شخصی شما</small>
          </div>
        </div>

        {user && (
          <button
            className="ghost"
            onClick={() => supabase.auth.signOut()}
          >
            خروج
          </button>
        )}
      </header>

      {!user ? (
        <section className="panel auth">
          <div className="heroIcon">☁</div>
          <h1>فایل‌هایت همیشه همراهت هستند</h1>
          <p>یک حساب بساز و فایل‌هایت را امن نگه دار.</p>

          <label>ایمیل</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />

          <label>رمز عبور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="حداقل ۸ کاراکتر"
          />

          <div className="actions">
            <button
              disabled={busy || !email || password.length < 8}
              onClick={signUp}
            >
              ثبت‌نام
            </button>

            <button
              className="secondary"
              disabled={busy || !email || password.length < 8}
              onClick={signIn}
            >
              ورود
            </button>
          </div>

          <p className="hint">
            هر کاربر فقط به فایل‌های حساب خودش دسترسی دارد.
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="welcome">
              <div>
                <h1>فضای من</h1>
                <p>{user.email}</p>
              </div>
              <span className="avatar">●</span>
            </div>

            {isAdmin && (
              <div className="accountId">
                <b>★ مدیر اصلی My Cloud</b>
                <small>حساب مدیر در رابط سایت بدون محدودیت سهمیه است.</small>
              </div>
            )}

            <div className="accountId">
              <div>
                <b>شناسه اختصاصی حساب</b>
                <small>
                  برای درخواست افزایش فضا، این شناسه را برای پشتیبانی بفرست.
                </small>
              </div>

              <code>{user.id}</code>

              <button
                className="copyId"
                onClick={() => {
                  navigator.clipboard?.writeText(user.id);
                  setMessage("شناسه حساب کپی شد.");
                }}
              >
                کپی شناسه
              </button>
            </div>

            <div className="usage">
              <div className="usageTop">
                <b>فضای ذخیره‌سازی</b>
                <span>
                  {formatGB(used)} گیگابایت مصرف‌شده
                  {isAdmin ? " · نامحدود" : ` از ${formatGB(quota)} گیگابایت`}
                </span>
              </div>

              <div className="bar">
                <i
                  style={{
                    width: `${
                      isAdmin
                        ? 0
                        : quota > 0
                          ? Math.min(100, (used / quota) * 100)
                          : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <label className="upload">
              <span>＋</span>
              <b>انتخاب و بارگذاری فایل</b>
              <small>عکس، ویدئو، PDF و فایل‌های دیگر</small>
              <input
                type="file"
                disabled={busy}
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>

            <div className="filesHead">
              <h2>فایل‌های من</h2>
              <button className="ghost" onClick={refreshFiles}>
                به‌روزرسانی
              </button>
            </div>

            {files.length === 0 ? (
              <div className="empty">
                هنوز فایلی بارگذاری نکرده‌ای.
              </div>
            ) : (
              <div className="fileList">
                {files.map((f) => (
                  <div className="file" key={f.name}>
                    <span className="fileIcon">▤</span>

                    <div className="fileInfo">
                      <b>{f.name.replace(/^\d+-/, "")}</b>
                      <small>
                        {(
                          (f.metadata?.size ?? 0) /
                          1024 /
                          1024
                        ).toFixed(1)}{" "}
                        مگابایت
                      </small>
                    </div>

                    <button
                      className="small"
                      onClick={() => download(f.name)}
                    >
                      دانلود
                    </button>

                    <button
                      className="delete"
                      onClick={() => remove(f.name)}
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin && (
            <section className="panel adminPanel">
              <h1>★ پنل مدیریت My Cloud</h1>
              <p>مدیریت کاربران و سهمیه فضای ذخیره‌سازی</p>

              <div className="filesHead">
                <h2>کاربران سایت</h2>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={loadAccount}
                >
                  به‌روزرسانی
                </button>
              </div>

              <p>تعداد کل کاربران: {adminUsers.length}</p>

              <label>جست‌وجو با ایمیل یا شناسه کاربر</label>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="ایمیل یا UID را وارد کن..."
              />

              <p>نتایج پیدا شده: {filteredUsers.length}</p>

              {filteredUsers.length === 0 ? (
                <div className="empty">
                  کاربری با این مشخصات پیدا نشد.
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <div className="accountId" key={u.id}>
                    <div>
                      <b>{u.email || "بدون ایمیل"}</b>
                      <small>{u.id}</small>
                      <small>
                        نقش: {u.role === "admin" ? "مدیر" : "کاربر"}
                        {" · "}
                        وضعیت: {u.is_blocked ? "مسدود" : "فعال"}
                      </small>
                      <small>
                        سهمیه فعلی: {formatGB(Number(u.quota_bytes))} گیگابایت
                      </small>
                    </div>

                    <label>فضا (گیگابایت)</label>

                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={quotaDrafts[u.id] ?? ""}
                      disabled={u.id === user.id || busy}
                      onChange={(e) =>
                        setQuotaDrafts((old) => ({
                          ...old,
                          [u.id]: e.target.value,
                        }))
                      }
                    />

                    <button
                      className="small"
                      disabled={u.id === user.id || busy}
                      onClick={() => updateQuota(u)}
                    >
                      ذخیره فضا
                    </button>

                    <button
                      className={u.is_blocked ? "small" : "delete"}
                      disabled={u.id === user.id || busy}
                      onClick={() => toggleBlock(u)}
                    >
                      {u.is_blocked ? "فعال‌کردن کاربر" : "مسدودکردن کاربر"}
                    </button>

                    {u.id === user.id && (
                      <small>این حساب، حساب مدیر اصلی است.</small>
                    )}
                  </div>
                ))
              )}
            </section>
          )}
        </>
      )}

      <section className="supportCard">
        <div className="supportIcon">✈</div>
        <div className="supportText">
          <b>نیاز به فضای ذخیره‌سازی بیشتر داری؟</b>
          <p>
            برای ارتقای فضای حساب یا دریافت فضای هدیه، با پشتیبانی تلگرام
            تماس بگیر و شناسه حسابت را ارسال کن.
          </p>
        </div>

        <a
          className="telegramButton"
          href="https://t.me/MyCloudSuppor"
          target="_blank"
          rel="noreferrer"
        >
          ارتباط با پشتیبانی
        </a>
      </section>

      {message && <div className="notice">{message}</div>}

      <footer>
        My Cloud · فضای شخصی، همیشه در دسترس · پشتیبانی: @MyCloudSuppor
      </footer>
    </main>
  );
}
