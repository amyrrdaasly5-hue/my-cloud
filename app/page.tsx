
"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/lib/supabase";

const DEFAULT_LIMIT = 15 * 1024 * 1024 * 1024;
const CHUNK_SIZE = 6 * 1024 * 1024;

type FileRow = {
  id: string | null;
  name: string;
  path: string;
  metadata?: { size?: number | string } | null;
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
  const [isBlocked, setIsBlocked] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [userSearch, setUserSearch] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingName, setUploadingName] = useState("");
  const [uploadSpeed, setUploadSpeed] = useState(0);

  const speedRef = useRef({ time: 0, bytes: 0 });

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

    try {
      const { data: usage, error: usageError } =
        await supabase.rpc("get_my_storage_usage");

      if (usageError) throw usageError;

      setUsed(Number(usage ?? 0));

      const allFiles: FileRow[] = [];

      async function readFolder(folderPath: string) {
        let offset = 0;

        while (true) {
          const { data, error } = await supabase.storage
            .from("user-files")
            .list(folderPath, {
              limit: 1000,
              offset,
              sortBy: { column: "name", order: "asc" },
            });

          if (error) throw error;

          const rows = data ?? [];

          for (const item of rows) {
            const fullPath = `${folderPath}/${item.name}`;

            if (!item.id) {
              await readFolder(fullPath);
            } else {
              const relativePath = fullPath.slice(user.id.length + 1);

              allFiles.push({
                id: item.id,
                name: item.name,
                path: relativePath,
                metadata: item.metadata as FileRow["metadata"],
              });
            }
          }

          if (rows.length < 1000) break;
          offset += 1000;
        }
      }

      await readFolder(user.id);
      setFiles(allFiles);
    } catch (error: any) {
      setMessage("خطا در دریافت فایل‌ها: " + error.message);
    }
  }

  async function loadAccount() {
    if (!user) return;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("quota_bytes, is_blocked")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      setMessage("خطا در دریافت اطلاعات حساب: " + profileError.message);
      return;
    }

    setQuota(
      profile?.quota_bytes != null
        ? Number(profile.quota_bytes)
        : DEFAULT_LIMIT
    );

    setIsBlocked(profile?.is_blocked === true);

    const { data, error } = await supabase.rpc("is_admin");

    if (error) {
      setIsAdmin(false);
      setMessage("خطا در بررسی دسترسی مدیر: " + error.message);
      return;
    }

    const admin = data === true;
    setIsAdmin(admin);

    if (!admin) {
      setAdminUsers([]);
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
      loadAccount();
      refreshFiles();
    } else {
      setIsAdmin(false);
      setIsBlocked(false);
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

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.session) {
        setMessage("ثبت‌نام موفق بود و وارد سایت شدی.");
      } else {
        setMessage(
          "ثبت‌نام انجام شد. اگر وارد نشدی، تنظیم Confirm email را در Supabase بررسی کن."
        );
      }
    } catch (error: any) {
      setMessage("خطا در ثبت‌نام: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes("email not confirmed")) {
          throw new Error(
            "این حساب قبلاً تأیید نشده است. حساب‌های قدیمی ممکن است به تأیید جداگانه نیاز داشته باشند."
          );
        }

        throw error;
      }

      setMessage("با موفقیت وارد شدی.");
    } catch (error: any) {
      setMessage("خطا در ورود: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file?: File) {
    if (!file || !user) return;

    if (isBlocked) {
      setMessage("حساب شما مسدود شده است و امکان آپلود ندارید.");
      return;
    }

    if (!isAdmin && used + file.size > quota) {
      setMessage("با این فایل از سقف فضای حسابت عبور می‌کنی.");
      return;
    }

    setBusy(true);
    setMessage("");
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadingName(file.name);

    speedRef.current = {
      time: Date.now(),
      bytes: 0,
    };

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData.session;

      if (!session) {
        throw new Error("نشست شما منقضی شده است. دوباره وارد شو.");
      }

      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (!projectUrl) {
        throw new Error("آدرس Supabase تنظیم نشده است.");
      }

      const projectId = new URL(projectUrl).hostname.split(".")[0];

      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!anonKey) {
        throw new Error("کلید عمومی Supabase تنظیم نشده است.");
      }

      const safeName = file.name.replace(/[^\w.\-آ-ی]/g, "_");
      const path = `${user.id}/${Date.now()}-${safeName}`;

      await new Promise<void>((resolve, reject) => {
        const uploader = new tus.Upload(file, {
          endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,

          headers: {
            authorization: `Bearer ${session.access_token}`,
            apikey: anonKey,
            "x-upsert": "false",
          },

          metadata: {
            bucketName: "user-files",
            objectName: path,
            contentType: file.type || "application/octet-stream",
            cacheControl: "3600",
          },

          chunkSize: CHUNK_SIZE,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,

          onProgress(bytesUploaded, bytesTotal) {
            const percent = Math.round(
              (bytesUploaded / bytesTotal) * 100
            );

            setUploadProgress(percent);

            const now = Date.now();
            const elapsed = (now - speedRef.current.time) / 1000;

            if (elapsed > 0) {
              const speed =
                (bytesUploaded - speedRef.current.bytes) / elapsed;

              setUploadSpeed(Math.max(0, speed));

              speedRef.current = {
                time: now,
                bytes: bytesUploaded,
              };
            }
          },

          onError(error) {
            reject(error);
          },

          onSuccess() {
            setUploadProgress(100);
            resolve();
          },
        });

        uploader.start();
      });

      setMessage("فایل با موفقیت بارگذاری شد.");
      await refreshFiles();
    } catch (error: any) {
      setMessage("خطا در آپلود: " + error.message);
    } finally {
      setBusy(false);
      setUploadingName("");
      setUploadSpeed(0);
    }
  }

  async function download(path: string) {
    if (!user) return;

    const { data, error } = await supabase.storage
      .from("user-files")
      .download(`${user.id}/${path}`);

    if (error || !data) {
      setMessage(error?.message ?? "دانلود ناموفق بود.");
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");

    a.href = url;
    a.download = path.split("/").pop() || "download";
    a.click();

    URL.revokeObjectURL(url);
  }

  async function remove(path: string) {
    if (!user || busy) return;

    if (!window.confirm("آیا از حذف این فایل مطمئنی؟")) return;

    setBusy(true);

    const { error } = await supabase.storage
      .from("user-files")
      .remove([`${user.id}/${path}`]);

    setMessage(error ? error.message : "فایل حذف شد.");

    await refreshFiles();
    setBusy(false);
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
          ? "کاربر فعال شد."
          : "کاربر مسدود شد."
      );

      await loadAccount();
    }

    setBusy(false);
  }

  const formatGB = (bytes: number) =>
    (bytes / 1024 / 1024 / 1024).toFixed(2);

  const formatUsage = (bytes: number) => {
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(2)} مگابایت`;
    }

    return `${formatGB(bytes)} گیگابایت`;
  };

  const formatSpeed = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(2)} MB/s`;
    }

    return `${(bytes / 1024).toFixed(0)} KB/s`;
  };

  const adminBarPercent =
    used > 0
      ? used % DEFAULT_LIMIT === 0
        ? 100
        : Math.max(
            2,
            ((used % DEFAULT_LIMIT) / DEFAULT_LIMIT) * 100
          )
      : 0;

  const userBarPercent =
    quota > 0
      ? Math.min(100, (used / quota) * 100)
      : 0;

  const filteredUsers = adminUsers.filter((u) => {
    const search = userSearch.trim().toLowerCase();

    return (
      u.id.toLowerCase().includes(search) ||
      (u.email || "").toLowerCase().includes(search)
    );
  });

  return (
    <main className="shell" id="home">
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
            <div className="welcome" id="account">
              <div>
                <h1>فضای من</h1>
                <p>{user.email}</p>
              </div>
              <span className="avatar">●</span>
            </div>

            {isAdmin && (
              <div className="accountId">
                <b>★ مدیر اصلی My Cloud</b>
                <small>حساب مدیر بدون محدودیت سهمیه است.</small>
              </div>
            )}

            {isBlocked && (
              <div className="notice">
                حساب شما مسدود شده است. برای پیگیری با پشتیبانی تماس بگیر.
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
                  {formatUsage(used)} مصرف‌شده
                  {isAdmin
                    ? " · نامحدود"
                    : ` از ${formatGB(quota)} گیگابایت`}
                </span>
              </div>

              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={isAdmin ? adminBarPercent : userBarPercent}
              >
                <i
                  style={{
                    width: `${
                      isAdmin ? adminBarPercent : userBarPercent
                    }%`,
                  }}
                />
              </div>

              {isAdmin ? (
                <small>
                  فضای نامحدود مدیر · هر ۱۵ گیگابایت یک نوار کامل
                </small>
              ) : (
                <>
                  <small>
                    {userBarPercent.toFixed(2)}٪ از فضای شما پر شده است
                  </small>

                  <small>
                    فضای باقی‌مانده:{" "}
                    {formatGB(Math.max(0, quota - used))} گیگابایت
                  </small>
                </>
              )}
            </div>

            <label className="upload" id="upload">
              <span>＋</span>
              <b>انتخاب و بارگذاری فایل</b>
              <small>عکس، ویدئو، PDF و فایل‌های دیگر</small>

              <input
                type="file"
                disabled={busy || isBlocked}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = "";
                  if (selected) void upload(selected);
                }}
              />
            </label>

            {busy && uploadingName && (
              <div className="accountId">
                <b>در حال بارگذاری: {uploadingName}</b>

                <h2>{uploadProgress}٪</h2>

                <div className="bar">
                  <i style={{ width: `${uploadProgress}%` }} />
                </div>

                <small>
                  سرعت فعلی: {formatSpeed(uploadSpeed)}
                </small>

                <small>
                  {uploadProgress === 100
                    ? "آپلود انجام شده؛ در حال تکمیل عملیات..."
                    : "لطفاً تا پایان آپلود صبر کن."}
                </small>
              </div>
            )}

            <div className="filesHead" id="files">
              <h2>فایل‌های من</h2>
              <button
                className="ghost"
                disabled={busy}
                onClick={refreshFiles}
              >
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
                  <div className="file" key={f.path}>
                    <span className="fileIcon">▤</span>

                    <div className="fileInfo">
                      <b>{f.path}</b>
                      <small>
                        {(
                          Number(f.metadata?.size ?? 0) /
                          1024 /
                          1024
                        ).toFixed(1)}{" "}
                        مگابایت
                      </small>
                    </div>

                    <button
                      className="small"
                      disabled={busy}
                      onClick={() => download(f.path)}
                    >
                      دانلود
                    </button>

                    <button
                      className="delete"
                      disabled={busy}
                      onClick={() => remove(f.path)}
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin && (
            <section className="panel adminPanel" id="admin">
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

      {user && (
        <nav className="bottomNav" aria-label="منوی اصلی">
          <a href="#home">
            <span>⌂</span>
            <small>خانه</small>
          </a>

          <a href="#files">
            <span>▤</span>
            <small>فایل‌های من</small>
          </a>

          <a href="#upload">
            <span>＋</span>
            <small>آپلود</small>
          </a>

          <a href="#account">
            <span>♙</span>
            <small>حساب من</small>
          </a>

          {isAdmin && (
            <a href="#admin">
              <span>♜</span>
              <small>مدیریت</small>
            </a>
          )}
        </nav>
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
