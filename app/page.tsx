
"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/lib/supabase";
import FileShare from "./FileShare";

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
  file_count: number;
  used_bytes: number;
  free_bytes: number;
  last_seen: string | null;
  is_online: boolean;
};

type AdminStats = {
  user_id: string;
  file_count: number;
  used_bytes: number;
  quota_bytes: number;
  free_bytes: number;
  last_seen: string | null;
  is_online: boolean;
};

type Theme = "light" | "dark" | "system";
type Accent = "blue" | "purple" | "green" | "pink";
type Page =
  | "home"
  | "files"
  | "upload"
  | "support"
  | "account"
  | "settings"
  | "admin";

// تبدیل نام فارسی به کد ASCII امن برای ذخیره‌سازی
function encodeFileName(fileName: string) {
  const bytes = new TextEncoder().encode(fileName);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return (
    "mcname_" +
    btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")
  );
}

// بازگرداندن نام اصلی فایل برای نمایش
function getDisplayFileName(storageName: string) {
  const nameWithoutTimestamp = storageName.replace(/^\d+-/, "");

  if (nameWithoutTimestamp.startsWith("mcname_")) {
    try {
      const encoded = nameWithoutTimestamp
        .slice("mcname_".length)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      const padded = encoded.padEnd(
        Math.ceil(encoded.length / 4) * 4,
        "="
      );

      const binary = atob(padded);
      const bytes = Uint8Array.from(
        binary,
        (char) => char.charCodeAt(0)
      );

      return new TextDecoder().decode(bytes);
    } catch {
      return nameWithoutTimestamp;
    }
  }

  try {
    return decodeURIComponent(nameWithoutTimestamp);
  } catch {
    return nameWithoutTimestamp;
  }
}

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

  const [theme, setTheme] = useState<Theme>("dark");
  const [accent, setAccent] = useState<Accent>("blue");
  const [fileSort, setFileSort] = useState("name");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [activeTab, setActiveTab] = useState<Page>("home");
  const [adminRefreshing, setAdminRefreshing] = useState(false);

  const speedRef = useRef({ time: 0, bytes: 0 });

  function goTo(page: Page) {
    setActiveTab(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHome() {
    goTo("home");
  }

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("mycloud-theme");
      const savedAccent = localStorage.getItem("mycloud-accent");
      const savedSort = localStorage.getItem("mycloud-file-sort");

      if (["light", "dark", "system"].includes(savedTheme || "")) {
        setTheme(savedTheme as Theme);
      }

      if (["blue", "purple", "green", "pink"].includes(savedAccent || "")) {
        setAccent(savedAccent as Accent);
      }

      if (["name", "size"].includes(savedSort || "")) {
        setFileSort(savedSort || "name");
      }
    } catch {}
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const systemDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;

      const actualTheme =
        theme === "system" ? (systemDark ? "dark" : "light") : theme;

      document.documentElement.dataset.theme = actualTheme;
      document.documentElement.dataset.accent = accent;

      try {
        localStorage.setItem("mycloud-theme", theme);
        localStorage.setItem("mycloud-accent", accent);
        localStorage.setItem("mycloud-file-sort", fileSort);
      } catch {}
    };

    applyTheme();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);

    return () => media.removeEventListener("change", applyTheme);
  }, [theme, accent, fileSort]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // ثبت آخرین بازدید و به‌روزرسانی وضعیت آنلاین
  useEffect(() => {
    if (!user) return;

    let active = true;

    const updateLastSeen = async () => {
      if (!active || document.visibilityState !== "visible") return;

      const { error } = await supabase
        .from("user_activity")
        .upsert(
          {
            user_id: user.id,
            last_seen: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) {
        console.error("خطا در ثبت آخرین بازدید:", error.message);
      }
    };

    void updateLastSeen();

    const interval = window.setInterval(() => {
      void updateLastSeen();
    }, 60000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void updateLastSeen();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user]);

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
                name: getDisplayFileName(item.name),
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

  // دریافت آمار جدید کاربران از دیتابیس
  async function refreshAdminStats(showMessage = false) {
    if (!isAdmin) return;

    setAdminRefreshing(true);

    try {
      const { data, error } = await supabase.rpc("admin_get_user_stats");

      if (error) throw error;

      const stats = (data ?? []) as AdminStats[];

      const statsMap = new Map(
        stats.map((item) => [item.user_id, item])
      );

      setAdminUsers((oldUsers) =>
        oldUsers.map((u) => {
          const stat = statsMap.get(u.id);

          if (!stat) return u;

          return {
            ...u,
            file_count: Number(stat.file_count ?? 0),
            used_bytes: Number(stat.used_bytes ?? 0),
            free_bytes: Number(stat.free_bytes ?? 0),
            last_seen: stat.last_seen ?? null,
            is_online: stat.is_online === true,
          };
        })
      );

      if (showMessage) {
        setMessage("آمار کاربران به‌روزرسانی شد.");
      }
    } catch (error: any) {
      if (showMessage) {
        setMessage("خطا در دریافت آمار کاربران: " + error.message);
      }
    } finally {
      setAdminRefreshing(false);
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

    const { data: statsData, error: statsError } =
      await supabase.rpc("admin_get_user_stats");

    if (statsError) {
      setMessage("خطا در دریافت آمار کاربران: " + statsError.message);
      return;
    }

    const stats = (statsData ?? []) as AdminStats[];
    const statsMap = new Map(
      stats.map((item) => [item.user_id, item])
    );

    const list = ((users ?? []) as any[]).map((u) => {
      const stat = statsMap.get(u.id);

      return {
        ...u,
        quota_bytes: Number(u.quota_bytes ?? DEFAULT_LIMIT),
        file_count: Number(stat?.file_count ?? 0),
        used_bytes: Number(stat?.used_bytes ?? 0),
        free_bytes: Number(stat?.free_bytes ?? u.quota_bytes ?? DEFAULT_LIMIT),
        last_seen: stat?.last_seen ?? null,
        is_online: stat?.is_online === true,
      } as AdminUser;
    });

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
      setActiveTab("home");
    }
  }, [user]);

  // به‌روزرسانی خودکار آمار هنگام باز بودن پنل مدیریت
  useEffect(() => {
    if (!user || !isAdmin || activeTab !== "admin") return;

    const interval = window.setInterval(() => {
      void refreshAdminStats();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [user, isAdmin, activeTab]);

  async function signUp() {
    setBusy(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      setMessage(
        data.session
          ? "ثبت‌نام موفق بود و وارد سایت شدی."
          : "ثبت‌نام انجام شد. اگر وارد نشدی، تنظیم Confirm email را در Supabase بررسی کن."
      );
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
          throw new Error("این حساب هنوز تأیید ایمیل نشده است.");
        }
        throw error;
      }

      setMessage("با موفقیت وارد شدی.");
      setActiveTab("home");
    } catch (error: any) {
      setMessage("خطا در ورود: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      setMessage("رمز جدید باید حداقل ۸ کاراکتر باشد.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("تکرار رمز عبور با رمز جدید یکسان نیست.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setNewPassword("");
      setConfirmPassword("");
      setMessage("رمز عبور با موفقیت تغییر کرد.");
    } catch (error: any) {
      setMessage("خطا در تغییر رمز: " + error.message);
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

    speedRef.current = { time: Date.now(), bytes: 0 };

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData.session;
      if (!session) throw new Error("نشست شما منقضی شده است. دوباره وارد شو.");

      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!projectUrl) throw new Error("آدرس Supabase تنظیم نشده است.");

      const projectId = new URL(projectUrl).hostname.split(".")[0];
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!anonKey) throw new Error("کلید عمومی Supabase تنظیم نشده است.");

      const safeName = encodeFileName(file.name);
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
            const percent = Math.round((bytesUploaded / bytesTotal) * 100);
            setUploadProgress(percent);

            const now = Date.now();
            const elapsed = (now - speedRef.current.time) / 1000;

            if (elapsed > 0) {
              const speed =
                (bytesUploaded - speedRef.current.bytes) / elapsed;

              setUploadSpeed(Math.max(0, speed));
              speedRef.current = { time: now, bytes: bytesUploaded };
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

      if (isAdmin) {
        await refreshAdminStats();
      }
    } catch (error: any) {
      setMessage("خطا در آپلود: " + error.message);
    } finally {
      setBusy(false);
      setUploadingName("");
      setUploadSpeed(0);
    }
  }

  async function download(path: string, fileName: string) {
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
    a.download = fileName || path.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

    if (isAdmin) {
      await refreshAdminStats();
    }

    setBusy(false);
  }

  async function updateQuota(target: AdminUser) {
    if (target.id === user.id) {
      setMessage("نمی‌توانی سهمیه حساب مدیر را تغییر بدهی.");
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

    if (!window.confirm(`آیا از ${action} این کاربر مطمئنی؟`)) return;

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
      setMessage(target.is_blocked ? "کاربر فعال شد." : "کاربر مسدود شد.");
      await loadAccount();
    }

    setBusy(false);
  }

  const formatGB = (bytes: number) =>
    (Number(bytes || 0) / 1024 / 1024 / 1024).toFixed(2);

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

  function formatLastSeen(value: string | null) {
    if (!value) return "هنوز وارد نشده";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "نامشخص";

    return date.toLocaleString("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const adminBarPercent =
    used > 0
      ? used % DEFAULT_LIMIT === 0
        ? 100
        : Math.max(2, ((used % DEFAULT_LIMIT) / DEFAULT_LIMIT) * 100)
      : 0;

  const userBarPercent =
    quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

  const filteredUsers = adminUsers.filter((u) => {
    const search = userSearch.trim().toLowerCase();

    return (
      u.id.toLowerCase().includes(search) ||
      (u.email || "").toLowerCase().includes(search)
    );
  });

  const sortedFiles = [...files].sort((a, b) => {
    if (fileSort === "size") {
      return Number(b.metadata?.size ?? 0) - Number(a.metadata?.size ?? 0);
    }

    return a.name.localeCompare(b.name, "fa");
  });

  const usedPercent = isAdmin ? adminBarPercent : userBarPercent;

  const pageNames: Record<Page, string> = {
    home: "خانه",
    files: "فایل‌های من",
    upload: "آپلود فایل",
    support: "پشتیبانی",
    account: "حساب کاربری",
    settings: "تنظیمات",
    admin: "مدیریت",
  };

  function renderStorage() {
    return (
      <section className="panel storagePanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">STORAGE OVERVIEW</span>
            <h2>فضای ذخیره‌سازی من</h2>
          </div>
          <span className="storageIcon">◫</span>
        </div>

        <div className="storageNumbers">
          <div>
            <strong>{formatUsage(used)}</strong>
            <small>مصرف‌شده</small>
          </div>
          <div className="storageLimit">
            <strong>{isAdmin ? "نامحدود" : `${formatGB(quota)} GB`}</strong>
            <small>سقف فضای حساب</small>
          </div>
        </div>

        <div
          className="bar storageBar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPercent}
        >
          <i style={{ width: `${usedPercent}%` }} />
        </div>

        <div className="storageBottom">
          <span>{usedPercent.toFixed(1)}٪ استفاده‌شده</span>
          <span>
            {isAdmin
              ? "حساب مدیر بدون محدودیت"
              : `${formatGB(Math.max(0, quota - used))} گیگابایت باقی‌مانده`}
          </span>
        </div>
      </section>
    );
  }

  function renderUpload() {
    return (
      <section className="panel uploadPanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">UPLOAD CENTER</span>
            <h2>آپلود فایل جدید</h2>
            <p>فایل‌های خودت را به فضای ابری منتقل کن.</p>
          </div>
          <span className="storageIcon">↑</span>
        </div>

        {isBlocked && (
          <div className="notice">
            حساب شما مسدود شده است و امکان آپلود ندارید.
          </div>
        )}

        <label className="upload premiumUpload">
          <span className="uploadPlus">＋</span>
          <b>برای انتخاب فایل لمس کن</b>
          <small>عکس، ویدئو، PDF و سایر فایل‌ها</small>
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
          <div className="uploadProgress">
            <div className="progressTitle">
              <b>{uploadingName}</b>
              <strong>{uploadProgress}٪</strong>
            </div>
            <div className="bar">
              <i style={{ width: `${uploadProgress}%` }} />
            </div>
            <div className="progressDetails">
              <span>سرعت: {formatSpeed(uploadSpeed)}</span>
              <span>
                {uploadProgress === 100
                  ? "در حال تکمیل..."
                  : "در حال بارگذاری فایل"}
              </span>
            </div>
          </div>
        )}
      </section>
    );
  }

  function renderFiles() {
    return (
      <section className="panel filesPanel">
        <div className="sectionHeading filesSectionHeading">
          <div>
            <span className="eyebrow">MY FILES</span>
            <h2>فایل‌های من</h2>
            <p>{files.length} فایل در فضای شخصی تو</p>
          </div>
          <button
            className="ghost refreshButton"
            disabled={busy}
            onClick={refreshFiles}
          >
            ↻ به‌روزرسانی
          </button>
        </div>

        <div className="fileToolbar">
          <span>همه فایل‌ها</span>
          <select
            aria-label="مرتب‌سازی فایل‌ها"
            value={fileSort}
            onChange={(e) => setFileSort(e.target.value)}
          >
            <option value="name">مرتب‌سازی بر اساس نام</option>
            <option value="size">بزرگ‌ترین حجم</option>
          </select>
        </div>

        {sortedFiles.length === 0 ? (
          <div className="empty premiumEmpty">
            <span>☁</span>
            <b>هنوز فایلی نداری</b>
            <p>اولین فایل خودت را آپلود کن تا اینجا نمایش داده شود.</p>
            <button onClick={() => goTo("upload")}>رفتن به آپلود</button>
          </div>
        ) : (
          <div className="fileList premiumFileList">
            {sortedFiles.map((f) => (
              <article className="file premiumFile" key={f.path}>
                <span className="fileIcon">▤</span>
                <div className="fileInfo">
                  <b title={f.name}>{f.name}</b>
                  <small>
                    {(Number(f.metadata?.size ?? 0) / 1024 / 1024).toFixed(1)} مگابایت
                  </small>
                </div>
                <div className="fileActions">
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => download(f.path, f.name)}
                  >
                    ↓ دانلود
                  </button>

                  <button
                    className="delete"
                    disabled={busy}
                    onClick={() => remove(f.path)}
                  >
                    حذف
                  </button>

                  <FileShare
                    userId={user.id}
                    filePath={f.path}
                    fileName={f.name}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderAccount() {
    return (
      <section className="panel accountPanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">ACCOUNT DETAILS</span>
            <h2>اطلاعات حساب</h2>
          </div>
          <span className="storageIcon">♙</span>
        </div>

        <div className="accountDetails">
          <div className="accountDetail">
            <span>ایمیل</span>
            <b>{user.email}</b>
          </div>
          <div className="accountDetail">
            <span>شناسه اختصاصی</span>
            <code>{user.id}</code>
          </div>
          <div className="accountDetail">
            <span>نوع حساب</span>
            <b>{isAdmin ? "مدیر اصلی" : "کاربر عادی"}</b>
          </div>
          <div className="accountDetail">
            <span>وضعیت</span>
            <b>{isBlocked ? "مسدود" : "فعال"}</b>
          </div>
        </div>

        <button
          className="copyId"
          onClick={() => {
            navigator.clipboard?.writeText(user.id);
            setMessage("شناسه حساب کپی شد.");
          }}
        >
          کپی شناسه حساب
        </button>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="panel settingsPanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">PERSONAL SETTINGS</span>
            <h2>تنظیمات</h2>
            <p>شخصی‌سازی تجربه My Cloud</p>
          </div>
          <span className="storageIcon">⚙</span>
        </div>

        <div className="settingGroup">
          <h3>🎨 ظاهر برنامه</h3>
          <label htmlFor="themeSelect">پوسته برنامه</label>
          <select
            id="themeSelect"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="light">روشن</option>
            <option value="dark">تیره</option>
            <option value="system">هماهنگ با گوشی</option>
          </select>

          <label>رنگ اصلی</label>
          <div className="colorChoices">
            <button
              type="button"
              className={`colorChoice blue ${accent === "blue" ? "selected" : ""}`}
              onClick={() => setAccent("blue")}
              aria-label="آبی"
              title="آبی"
            />
            <button
              type="button"
              className={`colorChoice purple ${accent === "purple" ? "selected" : ""}`}
              onClick={() => setAccent("purple")}
              aria-label="بنفش"
              title="بنفش"
            />
            <button
              type="button"
              className={`colorChoice green ${accent === "green" ? "selected" : ""}`}
              onClick={() => setAccent("green")}
              aria-label="سبز"
              title="سبز"
            />
            <button
              type="button"
              className={`colorChoice pink ${accent === "pink" ? "selected" : ""}`}
              onClick={() => setAccent("pink")}
              aria-label="صورتی"
              title="صورتی"
            />
          </div>
          <small>تنظیمات ظاهری به‌صورت خودکار ذخیره می‌شوند.</small>
        </div>

        <div className="settingGroup">
          <h3>📁 تنظیمات فایل‌ها</h3>
          <label htmlFor="settingsFileSort">مرتب‌سازی پیش‌فرض</label>
          <select
            id="settingsFileSort"
            value={fileSort}
            onChange={(e) => setFileSort(e.target.value)}
          >
            <option value="name">بر اساس نام</option>
            <option value="size">بر اساس حجم</option>
          </select>
        </div>

        <div className="settingGroup">
          <h3>🔐 امنیت حساب</h3>
          <label htmlFor="newPassword">رمز عبور جدید</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="حداقل ۸ کاراکتر"
          />

          <label htmlFor="confirmPassword">تکرار رمز جدید</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="رمز جدید را دوباره وارد کن"
          />

          <button
            className="settingsAction"
            disabled={busy || newPassword.length < 8 || !confirmPassword}
            onClick={changePassword}
          >
            تغییر رمز عبور
          </button>
        </div>

        <div className="settingGroup">
          <h3>☁ درباره My Cloud</h3>
          <div className="accountDetail">
            <span>نام برنامه</span>
            <b>My Cloud</b>
          </div>
          <div className="accountDetail">
            <span>نسخه سایت</span>
            <b>2.0.0</b>
          </div>
          <button className="settingsSupport" onClick={() => goTo("support")}>
            رفتن به صفحه پشتیبانی
          </button>
        </div>
      </section>
    );
  }

  function renderAdmin() {
    const onlineCount = adminUsers.filter((u) => u.is_online).length;
    const totalUsed = adminUsers.reduce(
      (sum, u) => sum + Number(u.used_bytes || 0),
      0
    );

    return (
      <section className="panel adminPanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">ADMIN CONTROL CENTER</span>
            <h2>پنل مدیریت</h2>
            <p>مدیریت کاربران و فضای ذخیره‌سازی</p>
          </div>
          <button
            className="ghost refreshButton"
            disabled={adminRefreshing}
            onClick={() => refreshAdminStats(true)}
          >
            {adminRefreshing ? "در حال دریافت..." : "↻ به‌روزرسانی آمار"}
          </button>
        </div>

        <div className="adminSummary">
          <span>تعداد کل کاربران</span>
          <strong>{adminUsers.length.toLocaleString("fa-IR")}</strong>
        </div>

        <div className="adminSummary">
          <span>کاربران آنلاین</span>
          <strong>{onlineCount.toLocaleString("fa-IR")}</strong>
        </div>

        <div className="adminSummary">
          <span>مجموع فضای مصرف‌شده</span>
          <strong>{formatUsage(totalUsed)}</strong>
        </div>

        <label htmlFor="userSearch">جست‌وجوی کاربر</label>
        <input
          id="userSearch"
          type="text"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder="ایمیل یا شناسه کاربر..."
        />

        <div className="adminUserList">
          {filteredUsers.length === 0 ? (
            <div className="empty">کاربری پیدا نشد.</div>
          ) : (
            filteredUsers.map((u) => (
              <article className="adminUser" key={u.id}>
                <div className="adminUserTop">
                  <b>{u.email || "بدون ایمیل"}</b>
                  <span className={u.is_blocked ? "statusBlocked" : "statusActive"}>
                    {u.is_blocked ? "مسدود" : "فعال"}
                  </span>
                </div>

                <div className="adminSummary">
                  <span>وضعیت حضور</span>
                  <strong
                    style={{
                      color: u.is_online ? "#16a34a" : "#9ca3af",
                    }}
                  >
                    {u.is_online ? "● آنلاین" : "○ آفلاین"}
                  </strong>
                </div>

                <small className="adminUid">{u.id}</small>

                <small>
                  آخرین بازدید: {formatLastSeen(u.last_seen)}
                </small>

                <small>
                  نقش: {u.role === "admin" ? "مدیر" : "کاربر"}
                </small>

                <div className="adminSummary">
                  <span>تعداد فایل‌ها</span>
                  <strong>
                    {Number(u.file_count || 0).toLocaleString("fa-IR")}
                  </strong>
                </div>

                <div className="adminSummary">
                  <span>حجم مصرف‌شده</span>
                  <strong>{formatUsage(Number(u.used_bytes || 0))}</strong>
                </div>

                <div className="adminSummary">
                  <span>سهمیه کل</span>
                  <strong>{formatGB(Number(u.quota_bytes))} گیگابایت</strong>
                </div>

                <div className="adminSummary">
                  <span>فضای باقی‌مانده</span>
                  <strong>
                    {formatUsage(Number(u.free_bytes || 0))}
                  </strong>
                </div>

                <label>فضا به گیگابایت</label>
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

                <div className="adminActions">
                  <button
                    className="small"
                    disabled={u.id === user.id || busy}
                    onClick={() => updateQuota(u)}
                  >
                    ذخیره سهمیه
                  </button>
                  <button
                    className={u.is_blocked ? "small" : "delete"}
                    disabled={u.id === user.id || busy}
                    onClick={() => toggleBlock(u)}
                  >
                    {u.is_blocked ? "فعال‌کردن" : "مسدودکردن"}
                  </button>
                </div>

                {u.id === user.id && (
                  <small>این حساب، حساب مدیر اصلی است.</small>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderSupport() {
    return (
      <section className="panel supportPagePanel">
        <div className="sectionHeading">
          <div>
            <span className="eyebrow">MY CLOUD SUPPORT</span>
            <h2>مرکز پشتیبانی</h2>
            <p>برای راهنمایی و پیگیری درخواست‌ها با ما در ارتباط باش.</p>
          </div>
          <span className="storageIcon">✈</span>
        </div>

        <div className="supportCard premiumSupport">
          <div className="supportIcon">✈</div>
          <div className="supportText">
            <b>پشتیبانی تلگرام My Cloud</b>
            <p>
              برای مشکلات حساب، ارتقای فضای ذخیره‌سازی یا دریافت راهنمایی،
              از طریق تلگرام با ما تماس بگیر.
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
        </div>

        <div className="settingGroup">
          <h3>اطلاعاتی که بهتر است ارسال کنی</h3>
          <p>برای پیگیری سریع‌تر، ایمیل حساب و شناسه اختصاصی خودت را بفرست.</p>
          <button className="copyId" onClick={() => goTo("account")}>
            مشاهده شناسه حساب
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className="shell premiumShell" id="home">
      <header className="premiumHeader">
        <button
          className="brand premiumBrand"
          onClick={goHome}
          style={{ border: 0, background: "transparent", cursor: "pointer" }}
        >
          <span className="cloud">☁</span>
          <span className="brandText">
            <b>My Cloud</b>
            <small>فضای ابری شخصی شما</small>
          </span>
        </button>

        {user ? (
          <div className="headerActions">
            <span className="onlineStatus">
              <i />
              آنلاین
            </span>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => supabase.auth.signOut()}
            >
              خروج
            </button>
          </div>
        ) : (
          <span className="secureLabel">فضای ابری امن</span>
        )}
      </header>

      {!user ? (
        <section className="loginLayout">
          <div className="loginIntro">
            <span className="eyebrow">MY CLOUD STORAGE</span>
            <h1>
              فایل‌هایت را
              <br />
              <span>همیشه همراهت</span>
              <br />
              داشته باش.
            </h1>
            <p>
              فضای شخصی تو برای نگهداری امن عکس‌ها، ویدئوها و اسناد،
              همیشه و از هر دستگاه در دسترس.
            </p>
            <div className="loginFeatures">
              <span>✓ فضای شخصی</span>
              <span>✓ دسترسی امن</span>
              <span>✓ مدیریت آسان فایل‌ها</span>
            </div>
          </div>

          <section className="panel auth premiumAuth">
            <div className="authLogo">☁</div>
            <span className="eyebrow">خوش آمدی</span>
            <h2>ورود به حساب کاربری</h2>
            <p>برای ادامه وارد حساب خودت شو یا ثبت‌نام کن.</p>

            <label htmlFor="email">آدرس ایمیل</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
            />

            <label htmlFor="password">رمز عبور</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="حداقل ۸ کاراکتر"
              autoComplete="current-password"
            />

            <div className="authButtons">
              <button
                disabled={busy || !email || password.length < 8}
                onClick={signIn}
              >
                {busy ? "لطفاً صبر کن..." : "ورود به حساب"}
              </button>
              <button
                className="secondary"
                disabled={busy || !email || password.length < 8}
                onClick={signUp}
              >
                ساخت حساب جدید
              </button>
            </div>

            <div className="authFoot">
              با ورود به My Cloud، فایل‌هایت در فضای شخصی خودت نگهداری می‌شوند.
            </div>
          </section>
        </section>
      ) : (
        <>
          {activeTab !== "home" && (
            <div
              className="pageTopBar"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: "16px 0",
              }}
            >
              <button
                className="ghost"
                onClick={goHome}
                aria-label="بازگشت به خانه"
                style={{ fontSize: 24, minWidth: 44 }}
              >
                ←
              </button>
              <div>
                <span className="eyebrow">MY CLOUD</span>
                <h2 style={{ margin: 0 }}>{pageNames[activeTab]}</h2>
              </div>
            </div>
          )}

          {activeTab === "home" && (
            <>
              <section className="dashboardHero">
                <div className="heroContent">
                  <span className="eyebrow">داشبورد شخصی</span>
                  <h1>سلام، خوش آمدی 👋</h1>
                  <p>{user.email}</p>

                  {isAdmin && (
                    <div className="adminPill">★ مدیر اصلی My Cloud</div>
                  )}

                  {isBlocked && (
                    <div className="notice">
                      حساب شما مسدود شده است. برای پیگیری با پشتیبانی تماس بگیر.
                    </div>
                  )}
                </div>

                <div className="heroGraphic">
                  <div className="heroCloud">☁</div>
                  <span className="heroOrbit orbitOne" />
                  <span className="heroOrbit orbitTwo" />
                </div>
              </section>

              <section className="statsGrid">
                <article className="statCard">
                  <span className="statIcon">▤</span>
                  <div>
                    <small>تعداد فایل‌ها</small>
                    <strong>{files.length.toLocaleString("fa-IR")}</strong>
                  </div>
                </article>

                <article className="statCard">
                  <span className="statIcon">◈</span>
                  <div>
                    <small>فضای مصرف‌شده</small>
                    <strong>{formatUsage(used)}</strong>
                  </div>
                </article>

                <article className="statCard">
                  <span className="statIcon">♙</span>
                  <div>
                    <small>نوع حساب</small>
                    <strong>{isAdmin ? "مدیر" : "شخصی"}</strong>
                  </div>
                </article>
              </section>

              {renderStorage()}

              <section className="panel">
                <div className="sectionHeading">
                  <div>
                    <span className="eyebrow">QUICK ACCESS</span>
                    <h2>دسترسی سریع</h2>
                    <p>بخش موردنظرت را انتخاب کن.</p>
                  </div>
                </div>

                <div className="quickActions">
                  <button className="quickAction" onClick={() => goTo("upload")}>
                    <span>＋</span>
                    <b>آپلود فایل</b>
                    <small>ارسال فایل جدید</small>
                  </button>
                  <button className="quickAction" onClick={() => goTo("files")}>
                    <span>▤</span>
                    <b>فایل‌های من</b>
                    <small>مدیریت فایل‌ها</small>
                  </button>
                  <button className="quickAction" onClick={() => goTo("settings")}>
                    <span>⚙</span>
                    <b>تنظیمات</b>
                    <small>شخصی‌سازی برنامه</small>
                  </button>
                  <button className="quickAction" onClick={() => goTo("support")}>
                    <span>✈</span>
                    <b>پشتیبانی</b>
                    <small>ارتباط با ما</small>
                  </button>
                </div>
              </section>
            </>
          )}

          {activeTab === "upload" && renderUpload()}
          {activeTab === "files" && renderFiles()}
          {activeTab === "account" && renderAccount()}
          {activeTab === "settings" && renderSettings()}
          {activeTab === "support" && renderSupport()}
          {activeTab === "admin" && isAdmin && renderAdmin()}

          {activeTab === "admin" && !isAdmin && (
            <section className="panel">
              <h2>دسترسی غیرمجاز</h2>
              <p>این بخش فقط برای مدیر سایت قابل مشاهده است.</p>
              <button onClick={goHome}>بازگشت به خانه</button>
            </section>
          )}
        </>
      )}

      {user && (
        <nav className="bottomNav premiumNav" aria-label="منوی اصلی">
          <a
            href="#home"
            className={activeTab === "home" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              goTo("home");
            }}
          >
            <span>⌂</span>
            <small>خانه</small>
          </a>

          <a
            href="#files"
            className={activeTab === "files" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              goTo("files");
            }}
          >
            <span>▤</span>
            <small>فایل‌ها</small>
          </a>

          <a
            href="#upload"
            className={activeTab === "upload" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              goTo("upload");
            }}
          >
            <span>＋</span>
            <small>آپلود</small>
          </a>

          <a
            href="#support"
            className={activeTab === "support" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              goTo("support");
            }}
          >
            <span>✈</span>
            <small>پشتیبانی</small>
          </a>

          <a
            href="#settings"
            className={activeTab === "settings" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              goTo("settings");
            }}
          >
            <span>⚙</span>
            <small>تنظیمات</small>
          </a>

          {isAdmin && (
            <a
              href="#admin"
              className={activeTab === "admin" ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                goTo("admin");
              }}
            >
              <span>♜</span>
              <small>مدیریت</small>
            </a>
          )}
        </nav>
      )}

      {message && (
        <div className="notice messageNotice">
          <span>{message}</span>
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}

      <footer className="premiumFooter">
        <b>☁ My Cloud</b>
        <span>فضای شخصی، همیشه در دسترس</span>
        <small>پشتیبانی: @MyCloudSuppor</small>
      </footer>
    </main>
  );
}
