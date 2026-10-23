# ตั้งค่าระบบบัญชีและฐานข้อมูล Tripmate

เว็บไซต์เชื่อม Supabase สำหรับบัญชีสมาชิก, แผนทริปส่วนตัว และรีวิวที่เผยแพร่บนหน้าเว็บ ต้องตั้งค่าโปรเจกต์ของเจ้าของเว็บก่อน ผู้เข้าชมจึงจะสมัครและใช้ Google Login ได้

## 1. สร้างฐานข้อมูล

1. สร้างโปรเจกต์ที่ [Supabase](https://supabase.com/dashboard).
2. เปิด **SQL Editor** ในโปรเจกต์ แล้ววางเนื้อหาทั้งหมดจาก `supabase-setup.sql` จากนั้นกด Run.
3. เปิด **Project Settings → API Keys** แล้วคัดลอก Project URL กับ `publishable` key (โปรเจกต์เดิมอาจแสดงชื่อ `anon` key).
4. ใส่สองค่านี้ใน `supabase-config.js`:

```js
window.TRIPMATE_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

คีย์นี้เป็นคีย์สำหรับหน้าเว็บและต้องใช้คู่กับ Row Level Security ที่สคริปต์ SQL เปิดไว้ ห้ามนำ `service_role` หรือ secret key มาใส่ในเว็บ

## 2. เปิดสมัครด้วย Google

1. ใน Supabase ไปที่ **Authentication → Providers → Google** แล้วเปิด Google provider.
2. คัดลอก callback URL ที่ Supabase แสดงในหน้าตั้งค่า Google provider.
3. ใน Google Cloud สร้าง OAuth Client ID ชนิด **Web application**.
4. เพิ่ม Authorized JavaScript origins:
   - `https://tripmate-1.netlify.app`
   - `http://localhost:5500` (สำหรับทดสอบในเครื่อง)
5. เพิ่ม callback URL จาก Supabase ลงใน Authorized redirect URIs ของ Google OAuth client.
6. นำ Google OAuth Client ID และ Client Secret ไปใส่ในช่อง Google provider ของ Supabase แล้วบันทึก.
7. ใน Supabase เปิด **Authentication → URL Configuration** ตั้ง Site URL เป็น `https://tripmate-1.netlify.app` และเพิ่ม Redirect URLs:
   - `https://tripmate-1.netlify.app/**`
   - `http://localhost:5500/**`

Google Maps API key ใช้แทน Supabase key หรือ Google OAuth Client ID ไม่ได้

## 3. ทดสอบและเผยแพร่

1. เปิดโฟลเดอร์โปรเจกต์ผ่าน `python -m http.server 5500` แล้วเข้า `http://localhost:5500`.
2. กด **เข้าสู่ระบบ / สมัคร** แล้วลองสมัครด้วยอีเมลหรือ Google. ถ้าระบบขอ ให้กดยืนยันอีเมลก่อนเข้าสู่ระบบ.
3. เมื่อเข้าสู่ระบบแล้ว บันทึกทริปและเปิดหน้า **ทริปของฉัน** ข้อมูลจะโหลดจากบัญชีที่ล็อกอิน.
4. อัปโหลดไฟล์เว็บชุดล่าสุดขึ้น Netlify หลังตั้งค่า URL และ key ใน `supabase-config.js`.

หากเบราว์เซอร์นี้มีทริปจากเวอร์ชันเดิม ระบบจะถามก่อนคัดลอกแผนเหล่านั้นเข้าบัญชีที่กำลังล็อกอิน

## ข้อมูลและสิทธิ์

- ตาราง `profiles` เก็บชื่อ อีเมล และรูปโปรไฟล์ที่ได้จาก provider โดยสมาชิกอ่าน/แก้ไขแถวของบัญชีตัวเองได้.
- ตาราง `trips` เก็บรายละเอียดทริปทั้งชุดเป็น JSON และใช้ `user_id` กับ RLS แยกข้อมูลตามบัญชี.
- ตาราง `reviews` แสดงรีวิวให้ผู้เข้าชมอ่านได้ เจ้าของรีวิวเพิ่มหรือลบได้เฉพาะของตัวเอง.
- Supabase Auth จัดการรหัสผ่านและ session; เว็บไซต์ไม่บันทึกรหัสผ่านเอง.
- การล็อกอิน Google จะใช้เฉพาะข้อมูลพื้นฐานโปรไฟล์และอีเมล ไม่ขอสิทธิ์เข้าถึง Google Maps หรือข้อมูลบริการอื่น.
