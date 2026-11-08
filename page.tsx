 "use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const LIMIT = 15 * 1024 * 1024 * 1024;

type FileRow = { name: string; id: string; metadata?: { size?: number } | null };

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<any>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function refreshFiles() {
    if (!user) return;
    const { data, error } = await supabase.storage.from("user-files").list(user.id, {
      limit: 1000, sortBy: { column: "name", order: "asc" }
    });
    if (error) { setMessage(error.message); return; }
    const rows = (data ?? []) as FileRow[];
    setFiles(rows);
    setUsed(rows.reduce((sum, f) => sum + (f.metadata?.size ?? 0), 0));
  }

  useEffect(() => { if (user) refreshFiles(); }, [user]);

  async function signUp() {
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error ? error.message : "ثبت‌نام انجام شد. اگر تأیید ایمیل فعال باشد، ایمیلت را بررسی کن.");
    setBusy(false);
  }
  async function signIn() {
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? error.message : "با موفقیت وارد شدی.");
    setBusy(false);
  }
  async function upload(file?: File) {
    if (!file || !user) return;
    setBusy(true); setMessage("");
    if (used + file.size > LIMIT) {
      setMessage("با این فایل از سقف ۱۵ گیگابایت فضای حسابت عبور می‌کنی.");
      setBusy(false); return;
    }
    const safeName = file.name.replace(/[^\w.\-آ-ی]/g, "_");
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from("user-files").upload(path, file, {
      upsert: false, contentType: file.type || "application/octet-stream"
    });
    setMessage(error ? error.message : "فایل با موفقیت بارگذاری شد.");
    await refreshFiles();
    setBusy(false);
  }
  async function download(name: string) {
    const { data, error } = await supabase.storage.from("user-files").download(`${user.id}/${name}`);
    if (error || !data) { setMessage(error?.message ?? "دانلود ناموفق بود."); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url; a.download = name;
    a.click(); URL.revokeObjectURL(url);
  }
  async function remove(name: string) {
    const { error } = await supabase.storage.from("user-files").remove([`${user.id}/${name}`]);
    setMessage(error ? error.message : "فایل حذف شد.");
    await refreshFiles();
  }

  return <main className="shell">
    <header><div className="brand"><span className="cloud">☁</span><div><b>My Cloud</b><small>فضای ابری شخصی شما</small></div></div>
      {user && <button className="ghost" onClick={() => supabase.auth.signOut()}>خروج</button>}
    </header>
    {!user ? <section className="panel auth">
      <div className="heroIcon">☁</div><h1>فایل‌هایت همیشه همراهت هستند</h1>
      <p>یک حساب بساز و فایل‌هایت را امن نگه دار.</p>
      <label>ایمیل</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/>
      <label>رمز عبور</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="حداقل ۸ کاراکتر"/>
      <div className="actions"><button disabled={busy || !email || password.length < 8} onClick={signUp}>ثبت‌نام</button><button className="secondary" disabled={busy || !email || password.length < 8} onClick={signIn}>ورود</button></div>
      <p className="hint">هر کاربر فقط به فایل‌های حساب خودش دسترسی دارد.</p>
    </section> : <section className="panel">
      <div className="welcome"><div><h1>فضای من</h1><p>{user.email}</p></div><span className="avatar">●</span></div>
      <div className="accountId"><div><b>شناسه اختصاصی حساب</b><small>برای درخواست افزایش فضا، این شناسه را برای پشتیبانی بفرست.</small></div><code>{user.id}</code><button className="copyId" onClick={() => { navigator.clipboard?.writeText(user.id); setMessage("شناسه حساب کپی شد."); }}>کپی شناسه</button></div>
      <div className="usage"><div className="usageTop"><b>فضای ذخیره‌سازی</b><span>{(used/1024/1024/1024).toFixed(2)} از ۱۵ گیگابایت</span></div>
        <div className="bar"><i style={{width:`${Math.min(100, used/LIMIT*100)}%`}}/></div></div>
      <label className="upload"><span>＋</span><b>انتخاب و بارگذاری فایل</b><small>عکس، ویدئو، PDF و فایل‌های دیگر</small>
        <input type="file" disabled={busy} onChange={e=>upload(e.target.files?.[0])}/>
      </label>
      <div className="filesHead"><h2>فایل‌های من</h2><button className="ghost" onClick={refreshFiles}>به‌روزرسانی</button></div>
      {files.length === 0 ? <div className="empty">هنوز فایلی بارگذاری نکرده‌ای.</div> : <div className="fileList">{files.map(f=><div className="file" key={f.name}><span className="fileIcon">▤</span><div className="fileInfo"><b>{f.name.replace(/^\d+-/, "")}</b><small>{((f.metadata?.size ?? 0)/1024/1024).toFixed(1)} مگابایت</small></div><button className="small" onClick={()=>download(f.name)}>دانلود</button><button className="delete" onClick={()=>remove(f.name)}>حذف</button></div>)}</div>}
    </section>}
    <section className="supportCard"><div className="supportIcon">✈</div><div className="supportText"><b>نیاز به فضای ذخیره‌سازی بیشتر داری؟</b><p>برای ارتقای فضای حساب یا دریافت فضای هدیه، با پشتیبانی تلگرام تماس بگیر و شناسه حسابت را ارسال کن.</p></div><a className="telegramButton" href="https://t.me/MyCloudSuppor" target="_blank" rel="noreferrer">ارتباط با پشتیبانی</a></section>
    {message && <div className="notice">{message}</div>}
    <footer>My Cloud · فضای شخصی، همیشه در دسترس · پشتیبانی: @MyCloudSuppor</footer>
  </main>;
}
