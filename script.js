
(() => {
  "use strict";

  // Keep local auth redirects on the host that is allowed in Supabase.
  if (window.location.hostname === "127.0.0.1" && window.location.port === "5500") {
    const localUrl = new URL(window.location.href);
    localUrl.hostname = "localhost";
    window.location.replace(localUrl.href);
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE_TITLES = {
    home: "หน้าแรก",
    join: "คำเชิญร่วมทริป",
    discover: "ไอเดียเที่ยว",
    planner: "วางแผนทริป",
    trips: "ทริปของฉัน",
    nearby: "ที่เที่ยวใกล้ฉัน",
    reviews: "รีวิว",
    guide: "วิธีใช้งาน"
  };
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  const currentPage = Object.prototype.hasOwnProperty.call(PAGE_TITLES, requestedPage)
    ? requestedPage
    : "home";
  document.body.dataset.page = currentPage;
  document.title = `${PAGE_TITLES[currentPage]} — Tripmate`;
  $$(`[data-page-link="${currentPage}"]`).forEach(link => {
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
  });

  const supabaseSettings = window.TRIPMATE_SUPABASE_CONFIG || {};
  const cloudConfigured = Boolean(supabaseSettings.url && supabaseSettings.anonKey);
  let supabaseClient = null;
  if (cloudConfigured && window.supabase?.createClient) {
    try {
      supabaseClient = window.supabase.createClient(
        supabaseSettings.url,
        supabaseSettings.anonKey
      );
    } catch (error) {
      console.error("Unable to initialize Supabase", error);
    }
  }

  const KEYS = {
    trips: "tripmate-saved-trips",
    reviews: "tripmate-reviews",
    theme: "tripmate-theme",
    profile: "tripmate-demo-profile",
    reviewGuest: "tripmate-review-guest-id",
    googleMapsApiKey: "tripmate-google-maps-embed-api-key",
    legacyTripMigration: "tripmate-cloud-trip-migration",
    tripSaveNotice: "tripmate-trip-save-notice"
  };

  const THAI_PROVINCES = [
    "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร",
    "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท", "ชัยภูมิ",
    "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง", "ตราด", "ตาก", "นครนายก",
    "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์",
    "นนทบุรี", "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี",
    "ประจวบคีรีขันธ์", "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา",
    "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์",
    "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน", "ยโสธร",
    "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี", "ลพบุรี", "ลำปาง",
    "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
    "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย",
    "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย", "หนองบัวลำภู",
    "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์", "อุทัยธานี", "อุบลราชธานี"
  ];
  const EXPENSE_CATEGORIES = [
    { id: "transport", label: "เดินทาง", icon: "🚆" },
    { id: "food", label: "อาหาร", icon: "🍜" },
    { id: "stay", label: "ที่พัก", icon: "🛏️" },
    { id: "activity", label: "กิจกรรม / อื่น ๆ", icon: "🎟️" }
  ];

  let friends = [];
  let trips = [];
  const tripAccess = new Map();
  let sharingAvailable = false;
  let activeShareTripId = null;
  let joinPreview = null;
  let inviteBusy = false;
  let plannerSaving = false;
  let reviews = [];
  let editingTripId = null;
  let toastTimer;
  let reviewPreviewUrl = null;
  let pendingReviewDeleteId = null;
  let currentUser = null;
  let loadedCloudUserId = null;
  let loadingCloudUserId = null;
  let migrationPromptedUserId = null;
  let cloudReviewsLoaded = false;
  let nearbyLocation = null;
  let selectedNearbyQuery = "tourist attractions";
  let nearbyWatchId = null;
  let nearbyTrackingActive = false;
  let nearbyLastMapUpdate = 0;
  let nearbyLastMappedLocation = null;
  let activeExpenseTripId = null;
  let pendingExpenseDeleteId = null;
  let editingExpenseId = null;
  let expenseSaving = false;
  let removeEditingExpenseReceipt = false;
  let expenseReceiptPreviewUrl = null;
  const MAX_EXPENSE_RECEIPT_BYTES = 8 * 1024 * 1024;
  const MAX_EXPENSE_RECEIPT_DATA_URL_LENGTH = 550_000;

  // ---------- Utilities ----------

  function readData(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveData(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast("บันทึกข้อมูลไม่สำเร็จ กรุณาตรวจสอบพื้นที่จัดเก็บ");
      return false;
    }
  }

  function money(value) {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  function moneyExact(value) {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function safeExpenseReceiptDataUrl(value) {
    const dataUrl = String(value || "");
    return dataUrl.length <= MAX_EXPENSE_RECEIPT_DATA_URL_LENGTH &&
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
      ? dataUrl
      : "";
  }

  function clearExpenseReceiptPreview(clearInput = true) {
    if (expenseReceiptPreviewUrl) URL.revokeObjectURL(expenseReceiptPreviewUrl);
    expenseReceiptPreviewUrl = null;
    const input = $("#expenseReceipt");
    const preview = $("#expenseReceiptPreview");
    const image = $("#expenseReceiptPreviewImage");
    if (clearInput && input) input.value = "";
    if (image) image.removeAttribute("src");
    if (preview) preview.hidden = true;
  }

  function updateExpenseReceiptPreview(input) {
    const file = input?.files?.[0];
    clearExpenseReceiptPreview(false);
    if (!file) {
      if (editingExpenseId && !removeEditingExpenseReceipt) {
        const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
        const expense = getTripExpenses(trip).find(item => String(item.id) === String(editingExpenseId));
        const existing = safeExpenseReceiptDataUrl(expense?.receiptImage);
        if (existing) {
          $("#expenseReceiptPreviewImage").src = existing;
          $("#expenseReceiptPreview").hidden = false;
        }
      }
      return;
    }
    if (!file.type.startsWith("image/")) {
      input.value = "";
      toast("กรุณาเลือกไฟล์รูปภาพสำหรับสลิป");
      updateExpenseReceiptPreview(input);
      return;
    }
    if (file.size > MAX_EXPENSE_RECEIPT_BYTES) {
      input.value = "";
      toast("รูปสลิปต้องมีขนาดไม่เกิน 8 MB");
      updateExpenseReceiptPreview(input);
      return;
    }

    expenseReceiptPreviewUrl = URL.createObjectURL(file);
    const image = $("#expenseReceiptPreviewImage");
    const preview = $("#expenseReceiptPreview");
    if (image && preview) {
      image.src = expenseReceiptPreviewUrl;
      preview.hidden = false;
    }
  }

  async function compressExpenseReceipt(file) {
    if (!file) return "";
    if (!file.type.startsWith("image/")) throw new Error("ไฟล์นี้ไม่ใช่รูปภาพ");
    if (file.size > MAX_EXPENSE_RECEIPT_BYTES) throw new Error("รูปสลิปต้องมีขนาดไม่เกิน 8 MB");
    if (typeof createImageBitmap !== "function") throw new Error("เบราว์เซอร์นี้อ่านรูปสลิปไม่ได้");

    const bitmap = await createImageBitmap(file);
    const maxEdge = 1200;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      throw new Error("เตรียมรูปสลิปไม่สำเร็จ");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    let quality = 0.72;
    let blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("บีบอัดรูปสลิปไม่สำเร็จ")), "image/jpeg", quality);
    });
    while (blob.size > 360 * 1024 && quality > 0.48) {
      quality -= 0.08;
      blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error("บีบอัดรูปสลิปไม่สำเร็จ")), "image/jpeg", quality);
      });
    }
    if (blob.size > 390 * 1024) throw new Error("รูปสลิปมีขนาดใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง");

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = safeExpenseReceiptDataUrl(reader.result);
        dataUrl ? resolve(dataUrl) : reject(new Error("เตรียมรูปสลิปไม่สำเร็จ"));
      };
      reader.onerror = () => reject(new Error("อ่านรูปสลิปไม่สำเร็จ"));
      reader.readAsDataURL(blob);
    });
  }

  function toast(message) {
    const box = $("#toast");
    if (!box) return;

    box.textContent = message;
    box.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove("show");
    }, 2800);
  }

  function showPendingTripSaveNotice() {
    if (currentPage !== "trips") return;

    try {
      const message = sessionStorage.getItem(KEYS.tripSaveNotice);
      if (!message) return;
      sessionStorage.removeItem(KEYS.tripSaveNotice);
      toast(message);
    } catch {}
  }

  function openDialog(id) {
    const dialog = $(id);
    if (!dialog) return;

    if (dialog.open) return;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.id === "expenseDialog" && expenseSaving) return;

    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function getDisplayName(user = currentUser) {
    const metadata = user?.user_metadata || {};
    const localProfile = user ? null : readData(KEYS.profile, null);
    return String(
      metadata.display_name || metadata.full_name || metadata.name ||
      localProfile?.name || user?.email?.split("@")[0] || "นักเดินทาง"
    ).trim();
  }

  function updateAccountUI() {
    const button = $("#openSignup");
    if (button) {
      button.textContent = currentUser ? "บัญชีของฉัน ▾" : "เข้าสู่ระบบ / สมัคร ↗";
      button.title = currentUser?.email || "เข้าสู่ระบบหรือสมัครสมาชิก";
    }

    const name = $("#accountTitle");
    const email = $("#accountEmail");
    const tripCount = $("#accountTripCount");
    if (name) name.textContent = getDisplayName();
    if (email) email.textContent = currentUser?.email || "";
    if (tripCount) tripCount.textContent = `${trips.length} ทริป`;
  }

  function requireCloudAccount() {
    if (!cloudConfigured) {
      toast("ตั้งค่า Supabase ในไฟล์ supabase-config.js ก่อนเปิดใช้ระบบบัญชีออนไลน์");
      return false;
    }
    if (!supabaseClient) {
      toast("โหลด Supabase ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
      return false;
    }
    if (!currentUser) {
      toast("เข้าสู่ระบบก่อนเพื่อบันทึกข้อมูลในบัญชีของคุณ");
      savePendingPlannerDraft();
      openDialog("#loginDialog");
      return false;
    }
    return true;
  }

  function isSharingSetupError(error) {
    return ["PGRST202", "42883"].includes(String(error?.code || ""));
  }

  function sharingErrorMessage(error) {
    if (isSharingSetupError(error)) return "ยังไม่ได้เปิดระบบเชิญเพื่อนในฐานข้อมูล กรุณารันไฟล์ supabase-trip-sharing.sql ก่อน";
    const message = String(error?.message || "");
    if (message.includes("INVITE_INVALID")) return "ลิงก์นี้หมดอายุหรือถูกปิดแล้ว ขอคำเชิญใหม่จากเจ้าของทริปได้เลย";
    if (message.includes("TRIP_CONFLICT")) return "มีเพื่อนอัปเดตทริปก่อนคุณ กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขต่อ";
    if (message.includes("EXPENSE_FORBIDDEN")) return "แก้ไขหรือลบได้เฉพาะค่าใช้จ่ายที่คุณเพิ่มเอง";
    if (message.includes("TRIP_FORBIDDEN")) return "คุณไม่มีสิทธิ์เข้าถึงทริปนี้แล้ว กรุณารีเฟรชทริป";
    if (message.includes("AUTH_REQUIRED")) return "กรุณาเข้าสู่ระบบก่อน";
    return "เชื่อมต่อไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง";
  }

  function isSharedTrip(id) {
    const access = tripAccess.get(String(id));
    return Boolean(access && access.ownerId !== currentUser?.id);
  }

  function canEditTripExpense(trip, expense) {
    return Boolean(expense) && (!isSharedTrip(trip.id) || expense.createdBy === currentUser?.id);
  }

  function mapCloudTrip(row, viewerId = currentUser?.id) {
    const ownerId = row.user_id || viewerId;
    const id = ownerId === viewerId ? String(row.id) : `${ownerId}:${row.id}`;
    tripAccess.set(id, { ownerId, tripId: String(row.id), version: row.updated_at,
      ownerName: row.owner_name || row.data?.ownerDisplayName || getDisplayName() });
    return { ...(row.data || {}), id, updatedAt: Date.parse(row.updated_at) || Date.now() };
  }

  async function writeCloudTrip(trip) {
    if (!requireCloudAccount()) return false;
    const userId = currentUser.id;
    const access = tripAccess.get(String(trip.id));
    const storedData = { ...trip, id: access?.tripId || trip.id };
    let result;
    if (access && sharingAvailable) {
      result = await supabaseClient.rpc("tripmate_update_trip", {
        p_owner_id: access.ownerId, p_trip_id: access.tripId,
        p_expected_version: access.version, p_data: storedData
      });
    } else if (access) {
      // Preserve existing installations until the sharing migration is installed.
      if (access.ownerId !== userId) throw new Error("TRIP_FORBIDDEN");
      result = await supabaseClient.from("trips").update({ data: storedData, updated_at: new Date().toISOString() })
        .eq("user_id", userId).eq("id", access.tripId).eq("updated_at", access.version)
        .select("id,user_id,data,updated_at").maybeSingle();
      if (!result.error && !result.data) result.error = { message: "TRIP_CONFLICT" };
    } else {
      result = await supabaseClient.from("trips").insert({ id: String(trip.id), user_id: userId,
        data: { ...storedData, ownerDisplayName: getDisplayName() }, updated_at: new Date().toISOString()
      }).select("id,user_id,data,updated_at").single();
    }
    if (currentUser?.id !== userId) return false;
    if (result.error) {
      if (String(result.error.message).includes("TRIP_CONFLICT")) {
        $("#reloadConflictingTrip").dataset.tripId = trip.id;
        openDialog("#tripConflictDialog");
        return false;
      }
      throw new Error(sharingErrorMessage(result.error));
    }
    Object.assign(trip, mapCloudTrip(result.data, userId));
    return true;
  }

  async function refreshSharedTripData() {
    if (!requireCloudAccount()) return false;
    const userId = currentUser.id;
    const latest = await getCloudTrips(currentUser);
    if (currentUser?.id !== userId) return false;
    trips = latest;
    renderSavedTrips();
    updateAccountUI();
    return true;
  }

  function setShareStatus(text) { $("#tripShareStatus").textContent = text; }

  async function refreshTripMembers() {
    const id = activeShareTripId;
    const access = tripAccess.get(id);
    if (!access || !currentUser) return;
    const userId = currentUser.id;
    const { data, error } = await supabaseClient.rpc("tripmate_trip_members", { p_owner_id: access.ownerId, p_trip_id: access.tripId });
    if (id !== activeShareTripId || currentUser?.id !== userId) return;
    if (error) { setShareStatus(sharingErrorMessage(error)); return; }
    const isOwner = access.ownerId === userId;
    $("#tripMemberList").innerHTML = (data.members || []).map(member => `<div class="share-member"><div><strong>${escapeHTML(member.name)}</strong><small>ตอบรับแล้ว ✓ · ช่วยแก้ไขทริปได้</small></div>${isOwner ? `<button type="button" class="text-link" data-remove-trip-member="${escapeHTML(member.user_id)}">นำออก</button>` : ""}</div>`).join("") || '<p class="field-hint">ยังไม่มีเพื่อนกดรับคำเชิญ</p>';
    $("#revokeTripInvite").hidden = !isOwner || !data.invite_expires_at;
    $("#createTripInvite").textContent = data.invite_expires_at ? "สร้างลิงก์ใหม่ (ลิงก์เก่าจะใช้ไม่ได้)" : "สร้างลิงก์เชิญเพื่อน";
    setShareStatus(data.invite_expires_at ? `เปิดรับเพื่อนถึง ${new Date(data.invite_expires_at).toLocaleString("th-TH")}` : "");
  }

  async function openTripSharing(id) {
    if (!requireCloudAccount()) return;
    const trip = trips.find(item => String(item.id) === String(id));
    if (!trip) return;
    activeShareTripId = String(id);
    $("#tripShareDescription").textContent = trip.destination || "ทริปของคุณ";
    $("#tripShareOwnerControls").hidden = isSharedTrip(id);
    $("#tripInviteLinkBox").hidden = true;
    $("#tripInviteLink").value = "";
    $("#tripMemberList").textContent = "กำลังโหลดผู้ตอบรับ…";
    setShareStatus("");
    openDialog("#tripShareDialog");
    if (!sharingAvailable) {
      setShareStatus("ยังไม่ได้เปิดระบบเชิญเพื่อนในฐานข้อมูล กรุณารันไฟล์ supabase-trip-sharing.sql ก่อน");
      $("#tripMemberList").textContent = "";
      return;
    }
    await refreshTripMembers();
  }

  async function loadTripInvitation() {
    if (currentPage !== "join") return;
    joinPreview = null;
    $("#acceptTripInvite").hidden = true;
    $("#retryTripInvite").hidden = true;
    $("#loginForInvite").hidden = true;
    const content = $("#joinTripContent");
    const token = new URLSearchParams(location.search).get("invite") || "";
    if (!/^[a-f0-9]{64}$/.test(token)) { content.textContent = "ลิงก์คำเชิญไม่ครบ ขอให้เพื่อนส่งลิงก์ใหม่อีกครั้ง"; return; }
    if (!cloudConfigured || !supabaseClient) { content.textContent = "ระบบบัญชียังไม่พร้อม กรุณาลองอีกครั้ง"; $("#retryTripInvite").hidden = false; return; }
    if (!currentUser) {
      content.textContent = "เข้าสู่ระบบหรือสมัครสมาชิกก่อน แล้วคุณจะเห็นรายละเอียดและเลือกตอบรับคำเชิญได้";
      $("#loginForInvite").hidden = false;
      return;
    }
    const userId = currentUser.id;
    content.textContent = "กำลังตรวจคำเชิญ…";
    try {
      const { data, error } = await supabaseClient.rpc("tripmate_invite_preview", { p_token: token });
      if (currentUser?.id !== userId) return;
      if (error) throw error;
      joinPreview = data;
      content.innerHTML = `<h2>${escapeHTML(data.destination || "ทริปเที่ยว")}</h2><p>${escapeHTML(data.owner_name)} ชวนคุณไปเที่ยวด้วยกัน</p><p>${escapeHTML(formatDate(data.start_date))} – ${escapeHTML(formatDate(data.end_date))}</p><div class="join-permissions">เมื่อกดเข้าร่วม คุณจะดูรายละเอียดและสลิปค่าใช้จ่าย ช่วยแก้แผนทริป และเพิ่มค่าใช้จ่ายได้ สมาชิกคนอื่นจะเห็นชื่อบัญชีและรายการที่คุณเพิ่ม</div>`;
      $("#acceptTripInvite").textContent = data.joined ? "เปิดทริปที่เข้าร่วมแล้ว" : "ยืนยันเข้าร่วมทริป";
      $("#acceptTripInvite").hidden = false;
    } catch (error) {
      if (currentUser?.id !== userId) return;
      content.textContent = sharingErrorMessage(error);
      $("#retryTripInvite").hidden = false;
    }
  }

  function initTripSharingEvents() {
    $("#loginForInvite").addEventListener("click", () => openDialog("#loginDialog"));
    $("#retryTripInvite").addEventListener("click", () => void loadTripInvitation());
    $("#refreshTripMembers").addEventListener("click", () => {
      void refreshTripMembers().catch(error => setShareStatus(sharingErrorMessage(error)));
    });
    $("#refreshSharedTrips").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try { if (await refreshSharedTripData()) toast("โหลดทริปล่าสุดแล้ว"); }
      catch (error) { toast(sharingErrorMessage(error)); }
      finally { button.disabled = false; }
    });
    $("#reloadConflictingTrip").addEventListener("click", async event => {
      const button = event.currentTarget;
      const id = button.dataset.tripId;
      button.disabled = true;
      try {
        if (!await refreshSharedTripData()) return;
        closeDialog($("#tripConflictDialog"));
        if (activeExpenseTripId === id) { editingExpenseId = null; pendingExpenseDeleteId = null; removeEditingExpenseReceipt = false; renderExpenseDialog(); }
        else if (currentPage === "planner") {
          const latest = trips.find(trip => String(trip.id) === id);
          if (latest) loadTrip(id); else { resetPlanner(); toast("คุณไม่มีสิทธิ์เข้าถึงทริปนี้แล้ว"); }
        }
      } catch (error) { toast(sharingErrorMessage(error)); }
      finally { button.disabled = false; }
    });
    $("#acceptTripInvite").addEventListener("click", async event => {
      if (inviteBusy || !joinPreview || !requireCloudAccount()) return;
      inviteBusy = true;
      const button = event.currentTarget;
      button.disabled = true;
      const userId = currentUser.id;
      try {
        const token = new URLSearchParams(location.search).get("invite");
        const { data, error } = await supabaseClient.rpc("tripmate_accept_invite", { p_token: token });
        if (currentUser?.id !== userId) return;
        if (error) throw error;
        sessionStorage.setItem(KEYS.tripSaveNotice, "เข้าร่วมทริปแล้ว ช่วยแก้แผนและเพิ่มค่าใช้จ่ายได้เลย");
        navigateToPage("trips");
      } catch (error) { $("#joinTripContent").textContent = sharingErrorMessage(error); }
      finally { inviteBusy = false; button.disabled = false; }
    });
    $("#createTripInvite").addEventListener("click", async event => {
      const access = tripAccess.get(activeShareTripId);
      if (!access || access.ownerId !== currentUser?.id || inviteBusy) return;
      const button = event.currentTarget;
      const shareId = activeShareTripId;
      button.disabled = true; inviteBusy = true;
      try {
        const { data, error } = await supabaseClient.rpc("tripmate_create_invite", { p_trip_id: access.tripId });
        if (error) throw error;
        if (shareId !== activeShareTripId || currentUser?.id !== access.ownerId) return;
        const url = new URL("https://tripmate-1.netlify.app/");
        url.searchParams.set("page", "join"); url.searchParams.set("invite", data.token);
        $("#tripInviteLink").value = url.href;
        $("#tripInviteLinkBox").hidden = false;
        await refreshTripMembers();
        setShareStatus("สร้างลิงก์แล้ว คัดลอกส่งให้เพื่อนได้เลย");
      } catch (error) { setShareStatus(sharingErrorMessage(error)); }
      finally { button.disabled = false; inviteBusy = false; }
    });
    $("#copyTripInvite").addEventListener("click", async () => {
      const input = $("#tripInviteLink");
      if (!input.value) return;
      try { await navigator.clipboard.writeText(input.value); setShareStatus("คัดลอกลิงก์แล้ว ส่งให้เพื่อนทางแชตได้เลย"); }
      catch { input.focus(); input.select(); setShareStatus("เลือกลิงก์ไว้ให้แล้ว กดคัดลอกเพื่อส่งให้เพื่อน"); }
    });
    $("#revokeTripInvite").addEventListener("click", async event => {
      const access = tripAccess.get(activeShareTripId);
      if (!access || access.ownerId !== currentUser?.id || inviteBusy) return;
      const button = event.currentTarget;
      button.disabled = true; inviteBusy = true;
      try {
        const { error } = await supabaseClient.rpc("tripmate_revoke_invite", { p_trip_id: access.tripId });
        if (error) throw error;
        $("#tripInviteLink").value = ""; $("#tripInviteLinkBox").hidden = true;
        await refreshTripMembers(); setShareStatus("ปิดลิงก์แล้ว คนที่ตอบรับก่อนหน้านี้ยังอยู่ในทริป");
      } catch (error) { setShareStatus(sharingErrorMessage(error)); }
      finally { button.disabled = false; inviteBusy = false; }
    });
    $("#tripMemberList").addEventListener("click", async event => {
      const button = event.target.closest("[data-remove-trip-member]");
      const access = tripAccess.get(activeShareTripId);
      if (!button || !access || access.ownerId !== currentUser?.id || inviteBusy) return;
      if (!button.dataset.confirmed) { button.dataset.confirmed = "true"; button.textContent = "ยืนยันนำออกและปิดลิงก์เดิม"; return; }
      button.disabled = true; inviteBusy = true;
      try {
        const { error } = await supabaseClient.rpc("tripmate_remove_member", { p_trip_id: access.tripId, p_user_id: button.dataset.removeTripMember });
        if (error) throw error;
        $("#tripInviteLink").value = ""; $("#tripInviteLinkBox").hidden = true;
        await refreshTripMembers(); setShareStatus("นำสมาชิกออกแล้ว ประวัติค่าใช้จ่ายยังอยู่ ลิงก์เดิมถูกปิดแล้ว");
      } catch (error) { setShareStatus(sharingErrorMessage(error)); }
      finally { button.disabled = false; inviteBusy = false; }
    });
    $("#tripShareDialog").addEventListener("close", () => {
      activeShareTripId = null; $("#tripInviteLink").value = "";
    });
  }

  function savePendingPlannerDraft() {
    if (currentPage !== "planner" || !$("#destination").value.trim()) return;
    try {
      sessionStorage.setItem("tripmate-pending-cloud-trip", JSON.stringify(collectTrip()));
    } catch {}
  }

  function takePendingPlannerDraft() {
    try {
      const value = sessionStorage.getItem("tripmate-pending-cloud-trip");
      sessionStorage.removeItem("tripmate-pending-cloud-trip");
      const draft = value ? JSON.parse(value) : null;
      return draft && typeof draft === "object" ? draft : null;
    } catch {
      return null;
    }
  }

  function showDatabaseSetupError(error) {
    console.error("Tripmate cloud data error", error);
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (code === "42501" || /row-level security|permission denied/i.test(message)) {
      toast("บันทึกไม่ได้: สิทธิ์ฐานข้อมูลไม่ผ่าน กรุณาตรวจสอบนโยบาย RLS ของตาราง trips");
      return;
    }
    if (code === "42P01" || /relation .* does not exist/i.test(message)) {
      toast("บันทึกไม่ได้: ยังไม่พบตาราง trips กรุณารัน supabase-setup.sql ใน Supabase");
      return;
    }
    if (code === "PGRST301" || /invalid.*jwt|jwt.*expired/i.test(message)) {
      toast("เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่");
      return;
    }
    toast(message
      ? `บันทึกข้อมูลไม่สำเร็จ: ${message.slice(0, 150)}`
      : "เชื่อมต่อข้อมูลไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตและการตั้งค่า Supabase");
  }

  async function ensureCloudProfile(user) {
    const metadata = user.user_metadata || {};
    const { error } = await supabaseClient.from("profiles").upsert({
      id: user.id,
      display_name: getDisplayName(user),
      email: user.email || null,
      avatar_url: metadata.avatar_url || metadata.picture || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    if (error) throw error;
  }

  async function getCloudTrips(user) {
    const shared = await supabaseClient.rpc("tripmate_my_trips");
    sharingAvailable = !shared.error;
    let rows;
    if (shared.error) {
      if (!isSharingSetupError(shared.error)) throw shared.error;
      const { data, error } = await supabaseClient.from("trips")
        .select("id, user_id, data, created_at, updated_at").eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      rows = data || [];
    } else rows = Array.isArray(shared.data) ? shared.data : [];
    const migrationStatus = readData(KEYS.legacyTripMigration, null);
    if (currentPage !== "join" && !rows.length && !migrationStatus && migrationPromptedUserId !== user.id) {
      migrationPromptedUserId = user.id;
      let legacyTrips = readData(KEYS.trips, []);
      if (!Array.isArray(legacyTrips) || !legacyTrips.length) {
        const oldTrip = readData("tripmate-plan", null);
        legacyTrips = oldTrip && (oldTrip.destination || oldTrip.startDate) ? [oldTrip] : [];
      }

      if (legacyTrips.length) {
        const shouldMigrate = confirm("พบแผนทริปเดิมที่เก็บไว้ในเบราว์เซอร์นี้ ต้องการย้ายสำเนาไปยังบัญชีที่เข้าสู่ระบบหรือไม่?");
        if (shouldMigrate) {
          const timestamp = new Date().toISOString();
          const records = legacyTrips.map(trip => {
            const id = String(trip.id || globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}`);
            return {
              id,
              user_id: user.id,
              data: { ...trip, id },
              created_at: timestamp,
              updated_at: timestamp
            };
          });
          const { error: migrationError } = await supabaseClient
            .from("trips")
            .upsert(records, { onConflict: "user_id,id" });
          if (migrationError) throw migrationError;
          rows = records.map(record => ({ ...record, data: record.data }));
          try {
            localStorage.removeItem(KEYS.trips);
            localStorage.removeItem("tripmate-plan");
          } catch {}
        }
        saveData(KEYS.legacyTripMigration, { userId: user.id, migrated: shouldMigrate, at: Date.now() });
      }
    }

    if (currentUser?.id !== user.id) return [];
    tripAccess.clear();
    return rows.map(row => mapCloudTrip(row, user.id));
  }

  async function getCloudReviews() {
    const { data, error } = await supabaseClient
      .from("reviews")
      .select("id, owner_id, data, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return (data || []).map(row => ({
      ...(row.data && typeof row.data === "object" ? row.data : {}),
      id: String(row.id),
      ownerId: row.owner_id,
      createdAt: Date.parse(row.created_at || "") || Number(row.data?.createdAt) || Date.now()
    }));
  }

  async function applyAuthSession(session) {
    const user = session?.user || null;
    const previousId = currentUser?.id || null;
    const accountChanged = Boolean(user && previousId && previousId !== user.id);
    currentUser = user;
    if (!user || accountChanged) {
      tripAccess.clear();
      joinPreview = null;
      activeShareTripId = null;
      closeDialog($("#tripShareDialog"));
      $("#tripInviteLink").value = "";
      $("#tripMemberList").replaceChildren();
    }
    if (accountChanged) {
      loadedCloudUserId = null;
      cloudReviewsLoaded = false;
      trips = [];
      reviews = [];
      resetPlanner();
      try { sessionStorage.removeItem("tripmate-pending-cloud-trip"); } catch {}
      renderSavedTrips();
      renderReviews();
    }
    updateAccountUI();

    if (!user) {
      loadedCloudUserId = null;
      if (previousId) {
        trips = [];
        reviews = [];
        renderSavedTrips();
        renderReviews();
        resetPlanner();
        cloudReviewsLoaded = false;
        try { sessionStorage.removeItem("tripmate-pending-cloud-trip"); } catch {}
      }
      if (supabaseClient && !cloudReviewsLoaded) {
        cloudReviewsLoaded = true;
        try {
          reviews = await getCloudReviews();
          renderReviews();
        } catch (error) {
          showDatabaseSetupError(error);
        }
      }
      updateAccountUI();
      if (currentPage === "join") void loadTripInvitation();
      return;
    }

    if (!supabaseClient || loadedCloudUserId === user.id || loadingCloudUserId === user.id) return;
    loadingCloudUserId = user.id;

    try {
      await ensureCloudProfile(user);
      const userTrips = await getCloudTrips(user);
      const publicReviews = await getCloudReviews();
      if (currentUser?.id !== user.id) return;

      trips = userTrips;
      reviews = publicReviews;
      cloudReviewsLoaded = true;
      loadedCloudUserId = user.id;
      renderSavedTrips();
      renderReviews();
      const pendingDraft = accountChanged ? null : takePendingPlannerDraft();
      if (pendingDraft) populatePlannerFromTrip(pendingDraft, false);
      else initializePlannerFromTrips();
      updateAccountUI();
      showPendingTripSaveNotice();
      if (currentPage === "join") void loadTripInvitation();
    } catch (error) {
      if (currentUser?.id === user.id) {
        trips = [];
        reviews = [];
        renderSavedTrips();
        renderReviews();
        updateAccountUI();
        showDatabaseSetupError(error);
      }
    } finally {
      if (loadingCloudUserId === user.id) loadingCloudUserId = null;
    }
  }

  async function initializeCloudAuth() {
    if (!cloudConfigured) return;
    if (!supabaseClient) {
      toast("เริ่มระบบบัญชีไม่ได้ ตรวจสอบ CDN หรือคีย์ Supabase");
      return;
    }

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      // Run database work after the auth callback releases its internal lock.
      window.setTimeout(() => { void applyAuthSession(session); }, 0);
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.error("Tripmate auth session error", error);
      toast("ตรวจสอบสถานะเข้าสู่ระบบไม่สำเร็จ");
      return;
    }
    await applyAuthSession(data.session);
  }

  async function signInWithGoogle() {
    if (!cloudConfigured || !supabaseClient) {
      toast("ตั้งค่า Supabase และ Google OAuth ก่อนใช้งานเข้าสู่ระบบด้วย Google");
      return;
    }

    savePendingPlannerDraft();
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`
      }
    });
    if (error) toast(error.message || "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
  }

  function scrollToPlanner() {
    $("#planner").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function navigateToPage(page, extraParams = {}) {
    const params = new URLSearchParams({ page, ...extraParams });
    window.location.assign(`${window.location.pathname}?${params.toString()}`);
  }

  // ---------- Google Maps nearby search ----------

  const NEARBY_CATEGORIES = [
    { name: "สถานที่ท่องเที่ยว", description: "แหล่งท่องเที่ยวและสถานที่น่าสนใจ", icon: "📍", query: "tourist attractions" },
    { name: "วัดและสถานที่ประวัติศาสตร์", description: "วัด โบราณสถาน และแหล่งเรียนรู้", icon: "🛕", query: "temples and historical landmarks" },
    { name: "ธรรมชาติและจุดชมวิว", description: "สวน น้ำตก ชายหาด และจุดชมวิว", icon: "🌿", query: "parks natural attractions and viewpoints" },
    { name: "ร้านอาหาร & คาเฟ่", description: "ร้านอาหาร คาเฟ่ และของกินใกล้คุณ", icon: "🍽️", query: "restaurants and cafes" }
  ];

  function getGoogleMapsApiKey() {
    const configuredKey = String(window.TRIPMATE_GOOGLE_MAPS_API_KEY || "").trim();
    if (configuredKey) return configuredKey;

    try {
      return localStorage.getItem(KEYS.googleMapsApiKey) || "";
    } catch {
      return "";
    }
  }

  function updateGoogleMapsKeyLabels() {
    const hasKey = Boolean(getGoogleMapsApiKey());
    const sharedKeyConfigured = Boolean(String(window.TRIPMATE_GOOGLE_MAPS_API_KEY || "").trim());
    $("#configureGoogleMaps").hidden = sharedKeyConfigured;
    $("#configureGoogleMapsFromCard").hidden = sharedKeyConfigured;
    $("#googleMapsSettingsLabel").textContent = hasKey ? "จัดการ API key" : "ตั้งค่า Google Maps";
    $("#nearbyMapPromptHeading").textContent = hasKey ? "พร้อมค้นหาสถานที่ใกล้คุณ" : "ตั้งค่าแผนที่ Google";
    $("#nearbyMapHint").textContent = hasKey
      ? "กดค้นหาจากตำแหน่งของคุณเพื่อดูสถานที่ท่องเที่ยวบนแผนที่ Google"
      : "วาง API key ที่จำกัดไว้สำหรับ Maps Embed API แล้วอนุญาตตำแหน่งเพื่อดูสถานที่ใกล้คุณ";
    $("#removeGoogleMapsKey").hidden = !hasKey;
  }

  function openGoogleMapsSettings() {
    $("#googleMapsApiKey").value = getGoogleMapsApiKey();
    $("#showGoogleMapsApiKey").checked = false;
    $("#googleMapsApiKey").type = "password";
    openDialog("#googleMapsKeyDialog");
    setTimeout(() => $("#googleMapsApiKey").focus(), 0);
  }

  function saveGoogleMapsApiKey(event) {
    event.preventDefault();
    const apiKey = $("#googleMapsApiKey").value.trim();
    if (!apiKey) {
      toast("กรุณาวาง Google Maps API key");
      return;
    }

    try {
      localStorage.setItem(KEYS.googleMapsApiKey, apiKey);
    } catch {
      toast("บันทึก key ไม่สำเร็จ เบราว์เซอร์ปิดกั้นพื้นที่จัดเก็บ");
      return;
    }

    closeDialog($("#googleMapsKeyDialog"));
    updateGoogleMapsKeyLabels();
    if (nearbyLocation) {
      renderGoogleNearbySearches(nearbyLocation, selectedNearbyQuery);
    } else {
      $("#nearbyStatus").textContent = "บันทึก API key แล้ว กดค้นหาจากตำแหน่งของคุณเพื่อเปิดแผนที่";
    }
    toast("บันทึก API key ไว้ในเบราว์เซอร์นี้แล้ว");
  }

  function removeGoogleMapsApiKey() {
    try {
      localStorage.removeItem(KEYS.googleMapsApiKey);
    } catch {
      toast("ลบ key จากเบราว์เซอร์ไม่สำเร็จ");
      return;
    }

    if (nearbyWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(nearbyWatchId);
      nearbyWatchId = null;
    }
    nearbyTrackingActive = false;
    nearbyLastMappedLocation = null;

    $("#nearbyGoogleMap").removeAttribute("src");
    $("#nearbyGoogleMap").hidden = true;
    $("#googleMapCard").hidden = false;
    $("#googleCurrentSearchLink").hidden = true;
    closeDialog($("#googleMapsKeyDialog"));
    updateGoogleMapsKeyLabels();
    $("#nearbyStatus").textContent = "ลบ API key แล้ว ตั้งค่า key ใหม่เพื่อใช้แผนที่ Google";
    toast("ลบ API key ออกจากเบราว์เซอร์นี้แล้ว");
  }

  function setNearbySearchButton(disabled, label) {
    const button = $("#nearbySearch");
    button.disabled = disabled;
    $("#nearbySearchLabel").textContent = label;
  }

  function buildGoogleMapsUrl(query, location) {
    const encodedQuery = encodeURIComponent(query);
    const latitude = Number(location.latitude).toFixed(6);
    const longitude = Number(location.longitude).toFixed(6);
    return `https://www.google.com/maps/search/${encodedQuery}/@${latitude},${longitude},13z`;
  }

  function buildGoogleMapsEmbedUrl(query, location) {
    const latitude = Number(location.latitude).toFixed(6);
    const longitude = Number(location.longitude).toFixed(6);
    const params = new URLSearchParams({
      key: getGoogleMapsApiKey(),
      q: `${query} near ${latitude},${longitude}`,
      center: `${latitude},${longitude}`,
      zoom: "14",
      language: "th",
      region: "TH"
    });
    return `https://www.google.com/maps/embed/v1/search?${params.toString()}`;
  }

  function buildGoogleMapsLiveEmbedUrl(location) {
    const params = new URLSearchParams({
      key: getGoogleMapsApiKey(),
      center: `${location.latitude},${location.longitude}`,
      zoom: "17",
      maptype: "roadmap"
    });
    return `https://www.google.com/maps/embed/v1/view?${params.toString()}`;
  }

  function distanceBetweenLocations(a, b) {
    if (!a || !b) return Infinity;
    const toRadians = value => value * Math.PI / 180;
    const earthRadius = 6371000;
    const latitudeDelta = toRadians(b.latitude - a.latitude);
    const longitudeDelta = toRadians(b.longitude - a.longitude);
    const firstLatitude = toRadians(a.latitude);
    const secondLatitude = toRadians(b.latitude);
    const value = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function showGoogleLiveLocationMap(location, force = false) {
    nearbyTrackingActive = true;
    const now = Date.now();
    const moved = distanceBetweenLocations(nearbyLastMappedLocation, location);
    if (force || moved >= 5 || now - nearbyLastMapUpdate >= 10000) {
      const frame = $("#nearbyGoogleMap");
      frame.src = buildGoogleMapsLiveEmbedUrl(location);
      frame.hidden = false;
      nearbyLastMappedLocation = { ...location };
      nearbyLastMapUpdate = now;
    }
    $("#googleMapCard").hidden = true;
    $("#nearbyMapHeading").textContent = "ตำแหน่งของคุณแบบเรียลไทม์";
    $("#googleCurrentSearchLink").href = buildGoogleMapsUrl("สถานที่ท่องเที่ยว", location);
    $("#googleCurrentSearchLink").hidden = false;
    $("#nearbyStatus").textContent = "กำลังติดตามตำแหน่งแบบเรียลไทม์ แผนที่จะเลื่อนตามพิกัดเมื่อคุณเคลื่อนที่";
    setNearbySearchButton(false, "กำลังติดตามตำแหน่ง");
    $$("[data-nearby-query]", $("#nearbyResultList")).forEach(button => {
      button.setAttribute("aria-pressed", "false");
      button.classList.remove("active");
    });
  }

  function showGoogleNearbyMap(query, location) {
    nearbyTrackingActive = false;
    selectedNearbyQuery = query;
    const category = NEARBY_CATEGORIES.find(item => item.query === query) || NEARBY_CATEGORIES[0];
    const frame = $("#nearbyGoogleMap");
    frame.src = buildGoogleMapsEmbedUrl(category.query, location);
    frame.hidden = false;
    $("#googleMapCard").hidden = true;
    $("#nearbyMapHeading").textContent = category.name;
    $("#googleCurrentSearchLink").href = buildGoogleMapsUrl(category.query, location);
    $("#googleCurrentSearchLink").hidden = false;
    $$("[data-nearby-query]", $("#nearbyResultList")).forEach(button => {
      const active = button.dataset.nearbyQuery === category.query;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
    $("#nearbyStatus").textContent = "กำลังแสดงสถานที่โดยยึดตำแหน่งปัจจุบันเป็นจุดศูนย์กลาง และเน้นพื้นที่ใกล้เคียงประมาณ 10 กม.";
    setNearbySearchButton(false, "กลับมาติดตามตำแหน่ง");
  }

  function renderGoogleNearbySearches(location) {
    $("#nearbyResultList").innerHTML = NEARBY_CATEGORIES.map(category => `
      <article class="nearby-place">
        <span class="nearby-place-icon" aria-hidden="true">${category.icon}</span>
        <span class="nearby-place-copy"><strong>${category.name}</strong><small>${category.description}</small></span>
        <button class="nearby-directions" type="button" data-nearby-query="${escapeHTML(category.query)}" aria-pressed="false">แสดง</button>
      </article>
    `).join("");
    showGoogleLiveLocationMap(location, true);
  }

  function locateAndSearchNearby() {
    if (!getGoogleMapsApiKey()) {
      $("#nearbyStatus").textContent = "ตั้งค่า Google Maps API key ก่อนค้นหาสถานที่ใกล้คุณ";
      openGoogleMapsSettings();
      return;
    }

    if (!navigator.geolocation) {
      $("#nearbyStatus").textContent = "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง";
      return;
    }

    if (!window.isSecureContext) {
      $("#nearbyStatus").textContent = "เบราว์เซอร์ต้องเปิดเว็บผ่าน HTTPS หรือ localhost จึงจะใช้ตำแหน่งได้";
      return;
    }

    if (nearbyWatchId !== null && nearbyLocation) {
      showGoogleLiveLocationMap(nearbyLocation, true);
      return;
    }

    setNearbySearchButton(true, "กำลังเปิด GPS...");
    $("#nearbyStatus").textContent = "กำลังขออนุญาตและเริ่มติดตามตำแหน่งจากอุปกรณ์ของคุณ";
    nearbyTrackingActive = true;
    nearbyWatchId = navigator.geolocation.watchPosition(position => {
      nearbyLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      if (!$("#nearbyResultList").querySelector("[data-nearby-query]")) {
        renderGoogleNearbySearches(nearbyLocation);
      } else if (nearbyTrackingActive) {
        showGoogleLiveLocationMap(nearbyLocation);
      }
    }, error => {
      const messages = {
        1: "ยังไม่ได้รับอนุญาตใช้ตำแหน่ง โปรดอนุญาตตำแหน่งในเบราว์เซอร์แล้วลองอีกครั้ง",
        2: "ระบุตำแหน่งปัจจุบันไม่ได้ โปรดเปิดบริการตำแหน่งของอุปกรณ์แล้วลองอีกครั้ง",
        3: "ระบุตำแหน่งนานเกินไป โปรดลองค้นหาอีกครั้ง"
      };
      const message = messages[error.code] || "เกิดปัญหาในการระบุตำแหน่ง โปรดลองอีกครั้ง";
      $("#nearbyStatus").textContent = message;
      setNearbySearchButton(false, nearbyLocation ? "กลับมาติดตามตำแหน่ง" : "ค้นหาจากตำแหน่งของฉัน");
      if (error.code === 1) {
        nearbyWatchId = null;
        nearbyTrackingActive = false;
      }
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
  }

  function handleNearbySearch() {
    locateAndSearchNearby();
  }
  // ---------- Dates ----------

  function durationDays(start, end) {
    if (!start || !end) return null;

    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);

    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
      return null;
    }

    if (b < a) return null;

    return Math.round((b - a) / 86400000) + 1;
  }

  function formatDate(value) {
    if (!value) return "ยังไม่ระบุวัน";

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  // ---------- Planner ----------

  function populateDestinationOptions() {
    const select = $("#destination");
    THAI_PROVINCES.forEach(province => {
      const option = document.createElement("option");
      option.value = province;
      option.textContent = province;
      select.append(option);
    });
  }

  function populateDiscoverProvinceOptions() {
    const select = $("#discoverProvince");
    THAI_PROVINCES.forEach(province => {
      const option = document.createElement("option");
      option.value = province;
      option.textContent = province;
      select.append(option);
    });
  }

  function setDestinationValue(destination) {
    const select = $("#destination");
    const value = String(destination || "");
    const hasOption = [...select.options].some(option => option.value === value);

    // คงจุดหมายของทริปเก่าไว้ให้แก้ไขได้ แม้ไม่ใช่จังหวัดในรายการใหม่
    if (value && !hasOption) {
      const legacyOption = document.createElement("option");
      legacyOption.value = value;
      legacyOption.textContent = `${value} (ทริปเดิม)`;
      legacyOption.dataset.legacyDestination = "true";
      select.append(legacyOption);
    }

    select.value = value;
  }

  function getCosts() {
    const number = id => Math.max(0, Number($(id).value) || 0);

    return {
      budget: number("#budget"),
      transport: number("#transport"),
      food: number("#food"),
      stay: number("#stay"),
      other: number("#other")
    };
  }

  function getTotal(costs = getCosts()) {
    return costs.transport + costs.food + costs.stay + costs.other;
  }

  function getPeopleCount() {
    return 1 + friends.filter(friend => friend.going).length;
  }

  function updateSummary() {
    const destination = $("#destination").value.trim();
    const start = $("#startDate").value;
    const end = $("#endDate").value;

    const costs = getCosts();
    const total = getTotal(costs);
    const remaining = costs.budget - total;
    const people = getPeopleCount();

    const duration = durationDays(start, end);

    $("#summaryDestination").textContent =
      destination || "ทริปใหม่ของคุณ";

    if (duration !== null) {
      $("#summaryDates").textContent =
        `${formatDate(start)} – ${formatDate(end)} · ${duration} วัน`;

      $("#dateHint").textContent =
        `ทริปนี้ ${duration} วัน${duration > 1 ? ` ${duration - 1} คืน` : ""}`;
    } else if (start && end) {
      $("#summaryDates").textContent = "วันกลับต้องไม่ก่อนวันไป";
      $("#dateHint").textContent = "กรุณาตรวจสอบวันเดินทางอีกครั้ง";
    } else {
      $("#summaryDates").textContent = "ยังไม่ได้เลือกวันเดินทาง";
      $("#dateHint").textContent = "เลือกวันไปและวันกลับเพื่อดูระยะเวลาทริป";
    }

    $("#summaryBudget").textContent = money(costs.budget);
    $("#summaryCost").textContent = money(total);
    $("#summaryRemaining").textContent = money(remaining);
    $("#summaryRemaining").style.color =
      remaining < 0 ? "#c0392b" : "";

    $("#perPerson").textContent = money(total / people);
    $("#peopleCount").textContent = `${people} คนในทริป`;

    const percentage = costs.budget > 0
      ? Math.min(100, total / costs.budget * 100)
      : (total > 0 ? 100 : 0);

    $("#budgetBar").style.width = `${percentage}%`;
    $("#budgetBar").style.background =
      total > costs.budget ? "#c0392b" : "";

    $("#budgetTrack").setAttribute(
      "aria-valuenow",
      String(Math.round(percentage))
    );

    let step = 1;

    if (destination) step = 2;
    if (destination && duration !== null) step = 3;

    $("#stepNumber").textContent = String(step).padStart(2, "0");

    $$(".step").forEach(item => {
      const active = Number(item.dataset.step) === step;
      item.classList.toggle("active", active);

      if (active) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function renderFriends() {
    const container = $("#friendList");

    if (!friends.length) {
      container.innerHTML =
        '<div class="empty-state">ยังไม่มีเพื่อนในทริปนี้</div>';

      updateSummary();
      return;
    }

    container.innerHTML = friends.map((friend, index) => `
      <div class="friend-row">
        <span class="friend-avatar">${escapeHTML(
          friend.name.trim().charAt(0).toUpperCase()
        )}</span>

        <div class="friend-info">
          <b>${escapeHTML(friend.name)}</b>
          <small>${friend.userId ? "ตอบรับด้วยบัญชีแล้ว ✓" : friend.going ? "เพิ่มชื่อไว้ในแผน" : "ยังไม่ร่วมเดินทาง"}</small>
        </div>

        <label class="friend-confirm">
          <input
            type="checkbox"
            data-friend-going="${index}"
            ${friend.going ? "checked" : ""}
            ${friend.userId ? "disabled" : ""}
          >
          ไปแน่
        </label>

        <button
          type="button"
          class="remove-friend"
          data-remove-friend="${index}"
          aria-label="ลบเพื่อน"
          ${friend.userId ? "hidden" : ""}
        >×</button>
      </div>
    `).join("");

    updateSummary();
  }

  function addFriend() {
    const input = $("#friendEmail");
    const name = input.value.trim();

    if (!name) {
      toast("กรุณากรอกชื่อหรืออีเมลเพื่อน");
      input.focus();
      return;
    }

    const duplicate = friends.some(friend =>
      friend.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      toast("มีเพื่อนคนนี้ในรายการแล้ว");
      return;
    }

    friends.push({ name, going: true });
    input.value = "";
    renderFriends();
    toast("เพิ่มเพื่อนเรียบร้อยแล้ว");
  }

  function validatePlanner() {
    const destination = $("#destination");
    const start = $("#startDate");
    const end = $("#endDate");

    if (!destination.value.trim()) {
      toast("กรุณากรอกจุดหมายปลายทาง");
      destination.focus();
      return false;
    }

    if (!start.value || !end.value) {
      toast("กรุณาเลือกวันไปและวันกลับ");
      (!start.value ? start : end).focus();
      return false;
    }

    if (durationDays(start.value, end.value) === null) {
      toast("วันกลับต้องไม่ก่อนวันไป");
      end.focus();
      return false;
    }

    const costInputs = [
      "#budget", "#transport", "#food", "#stay", "#other"
    ];

    for (const id of costInputs) {
      const input = $(id);
      const value = input.value.trim();

      if (value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
        toast("กรุณากรอกค่าใช้จ่ายเป็นตัวเลขศูนย์หรือมากกว่า");
        input.focus();
        return false;
      }
    }

    return true;
  }

  function collectTrip() {
    const costs = getCosts();
    const previousTrip = editingTripId
      ? trips.find(item => String(item.id) === String(editingTripId))
      : null;

    const previousTripData = { ...(previousTrip || {}) };
    delete previousTripData.smartPlan;

    return {
      ...previousTripData,
      id: editingTripId || (
        globalThis.crypto?.randomUUID?.() ||
        `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ),
      destination: $("#destination").value.trim(),
      startDate: $("#startDate").value,
      endDate: $("#endDate").value,
      friends: friends.map(friend => ({
        name: friend.name,
        going: friend.going,
        ...(friend.userId ? { userId: friend.userId } : {})
      })),
      budget: costs.budget,
      transport: costs.transport,
      food: costs.food,
      stay: costs.stay,
      other: costs.other,
      transportType: $("#transportType").value,
      foodType: $("#foodType").value,
      stayType: $("#stayType").value,
      expenses: Array.isArray(previousTrip?.expenses) ? previousTrip.expenses : [],
      updatedAt: Date.now()
    };
  }

  async function saveTrip() {
    if (plannerSaving) return;
    plannerSaving = true;
    $("#saveTrip").disabled = true;
    try {
    if (!validatePlanner()) return;
    if (cloudConfigured && !requireCloudAccount()) return;

    const trip = collectTrip();
    const index = trips.findIndex(item => item.id === trip.id);
    const nextTrips = index >= 0
      ? trips.map(item => item.id === trip.id ? trip : item)
      : [trip, ...trips];

    if (cloudConfigured) {
      if (!await writeCloudTrip(trip)) return;
    } else if (!saveData(KEYS.trips, nextTrips)) {
      return;
    }

    trips = nextTrips;

    const successMessage = index >= 0 ? "อัปเดตทริปแล้ว" : "สร้างทริปแล้ว";

    editingTripId = null;

    try {
      sessionStorage.setItem(KEYS.tripSaveNotice, successMessage);
    } catch {}
    navigateToPage("trips");
    } catch (error) { toast(sharingErrorMessage(error)); } finally {
      plannerSaving = false;
      $("#saveTrip").disabled = false;
    }
  }

  function resetPlanner() {
    editingTripId = null;
    $("#plannerForm").reset();
    $$("#destination [data-legacy-destination]").forEach(option => option.remove());
    $("#destination").value = "";

    $("#budget").value = 6000;
    $("#transport").value = 1500;
    $("#food").value = 1200;
    $("#stay").value = 1000;
    $("#other").value = 200;

    friends = [];

    $("#saveMessage").textContent = "";
    renderFriends();
    updateSummary();
  }

  function loadTrip(id) {
    const trip = trips.find(item => item.id === id);
    if (!trip) return;

    populatePlannerFromTrip(trip, true);
    scrollToPlanner();
  }

  function populatePlannerFromTrip(trip, isSavedTrip) {
    editingTripId = String(trip.id || globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}`);

    setDestinationValue(trip.destination || "");
    $("#startDate").value = trip.startDate || "";
    $("#endDate").value = trip.endDate || "";

    $("#budget").value = trip.budget ?? 6000;
    $("#transport").value = trip.transport ?? 1500;
    $("#food").value = trip.food ?? 1200;
    $("#stay").value = trip.stay ?? 1000;
    $("#other").value = trip.other ?? 200;

    $("#transportType").value = trip.transportType || "ยังไม่แน่ใจ";
    $("#foodType").value = trip.foodType || "กินได้ทุกอย่าง";
    $("#stayType").value = trip.stayType || "ยังไม่แน่ใจ";
    friends = Array.isArray(trip.friends)
      ? trip.friends.map(friend => {
          if (typeof friend === "string") {
            return { name: friend, going: true };
          }

          return {
            name: String(friend.name || ""),
            going: friend.going !== false,
            ...(friend.userId ? { userId: friend.userId } : {})
          };
        }).filter(friend => friend.name)
      : [];

    $("#saveMessage").textContent = isSavedTrip
      ? `กำลังแก้ไขทริป: ${trip.destination}`
      : "ข้อมูลทริปพร้อมแล้ว กดบันทึกเพื่อเก็บไว้ในบัญชี";

    renderFriends();
    updateSummary();
    if (currentPage === "planner") scrollToPlanner();
  }

  function renderSavedTrips() {
    const grid = $("#savedTripGrid");

    if (!trips.length) {
      grid.innerHTML =
        '<div class="saved-empty">ยังไม่มีทริปที่บันทึกไว้ ลองสร้างทริปแรกของคุณได้เลย</div>';
      return;
    }

    grid.innerHTML = trips.map(trip => {
      const total =
        Number(trip.transport || 0) +
        Number(trip.food || 0) +
        Number(trip.stay || 0) +
        Number(trip.other || 0);

      const days = durationDays(trip.startDate, trip.endDate);

      const friendList = Array.isArray(trip.friends) ? trip.friends : [];
      const people = 1 + friendList.filter(friend =>
        typeof friend === "string" || friend.going !== false
      ).length;
      const expenses = getTripExpenses(trip);
      const actualSpend = expenses.reduce((sum, expense) => sum + Math.max(0, Number(expense.amount) || 0), 0);
      const budgetPercent = Number(trip.budget) > 0
        ? Math.min(100, actualSpend / Number(trip.budget) * 100)
        : 0;

      return `
        <article class="saved-trip-card">
          <div class="section-kicker">${isSharedTrip(trip.id) ? "ทริปที่เข้าร่วม · ช่วยแก้ไขได้" : "TRIP PLAN"}</div>
          <h3>${escapeHTML(trip.destination || "ทริปใหม่")}</h3>
          <p>${escapeHTML(formatDate(trip.startDate))} – ${escapeHTML(formatDate(trip.endDate))}</p>
          <p>${days ? `${days} วัน` : "ยังไม่ระบุระยะเวลา"} · ${people} คน</p>
          <p>การเดินทาง: ${escapeHTML(trip.transportType || "ไม่ระบุ")}</p>
          <div class="trip-total">${money(total)}</div>
          <p>งบประมาณ ${money(trip.budget || 0)}</p>
          <div class="saved-expense-summary">
            <div><span>ใช้จริงแล้ว</span><strong>${moneyExact(actualSpend)}</strong></div>
            <span>${expenses.length ? `${expenses.length} รายการ` : "ยังไม่มีรายการ"}</span>
            <div class="saved-expense-meter${actualSpend > Number(trip.budget || 0) ? " over" : ""}" aria-hidden="true"><span style="width:${budgetPercent}%"></span></div>
          </div>
          <div class="saved-trip-actions">
            <button type="button" class="saved-expense-button" data-expense-trip="${escapeHTML(trip.id)}">จัดการค่าใช้จ่ายจริง ↗</button>
            <button type="button" data-edit-trip="${escapeHTML(trip.id)}">แก้ไขทริป</button>
            ${cloudConfigured ? `<button type="button" data-share-trip="${escapeHTML(trip.id)}">${isSharedTrip(trip.id) ? "สมาชิกในทริป" : "ชวนเพื่อน / ดูผู้ตอบรับ"}</button>` : ""}
            ${isSharedTrip(trip.id) ? "" : `<button type="button" data-delete-trip="${escapeHTML(trip.id)}">ลบทริป</button>`}
          </div>
        </article>
      `;
    }).join("");
  }

  function expenseParticipantNames(trip) {
    const names = [tripAccess.get(String(trip.id))?.ownerName || trip.ownerDisplayName || getDisplayName() || "ฉัน"];
    const friendsInTrip = Array.isArray(trip.friends) ? trip.friends : [];
    friendsInTrip.forEach(friend => {
      if (friend && typeof friend === "object" && friend.going === false) return;
      const name = typeof friend === "string" ? friend : friend?.name;
      if (String(name || "").trim()) names.push(String(name).trim());
    });

    const seen = new Set();
    return names.filter(name => {
      const key = name.normalize("NFC").toLocaleLowerCase("th-TH");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getTripExpenses(trip) {
    return Array.isArray(trip?.expenses)
      ? trip.expenses.filter(expense => expense && typeof expense === "object" && Number(expense.amount) > 0)
      : [];
  }

  function getExpenseBalances(trip, participants) {
    const members = new Map();
    const addMember = name => {
      const label = String(name || "").trim();
      if (!label) return null;
      const key = label.normalize("NFC").toLocaleLowerCase("th-TH");
      if (!members.has(key)) members.set(key, { key, name: label, paid: 0, share: 0 });
      return members.get(key);
    };
    participants.forEach(addMember);

    getTripExpenses(trip).forEach(expense => {
      const totalCents = Math.round(Number(expense.amount) * 100);
      const payer = addMember(expense.paidBy || participants[0] || "ฉัน");
      if (!payer || totalCents <= 0) return;
      payer.paid += totalCents;

      const requestedSplit = Array.isArray(expense.splitBetween) && expense.splitBetween.length
        ? expense.splitBetween
        : participants;
      const split = [...new Set(requestedSplit.map(addMember).filter(Boolean))];
      if (!split.length) return;

      const baseShare = Math.floor(totalCents / split.length);
      const extraCents = totalCents % split.length;
      split.forEach((member, index) => {
        member.share += baseShare + (index < extraCents ? 1 : 0);
      });
    });

    return [...members.values()];
  }

  function getExpenseSettlement(trip, participants) {
    const debtors = [];
    const creditors = [];
    getExpenseBalances(trip, participants).forEach(member => {
      const balance = member.paid - member.share;
      if (balance < 0) debtors.push({ ...member, balance: -balance });
      if (balance > 0) creditors.push({ ...member, balance });
    });

    const transfers = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const cents = Math.min(debtor.balance, creditor.balance);
      if (cents > 0) transfers.push({ from: debtor.name, to: creditor.name, cents });
      debtor.balance -= cents;
      creditor.balance -= cents;
      if (!debtor.balance) debtorIndex += 1;
      if (!creditor.balance) creditorIndex += 1;
    }
    return transfers;
  }

  function expenseFormParticipants(trip, expense) {
    return [...new Set([
      ...expenseParticipantNames(trip),
      ...(expense?.paidBy ? [expense.paidBy] : []),
      ...(Array.isArray(expense?.splitBetween) ? expense.splitBetween : [])
    ].map(name => String(name || "").trim()).filter(Boolean))];
  }

  function setExpenseFeedback(message, isError = false) {
    const status = $("#expenseSaveStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
    status.hidden = !message;
  }

  function setExpenseBusy(busy) {
    expenseSaving = busy;
    const dialog = $("#expenseDialog");
    dialog.setAttribute("aria-busy", String(busy));
    $$("input, select, button", dialog).forEach(control => {
      if (busy) {
        control.dataset.walletWasDisabled = String(control.disabled);
        control.disabled = true;
      } else if ("walletWasDisabled" in control.dataset) {
        control.disabled = control.dataset.walletWasDisabled === "true";
        delete control.dataset.walletWasDisabled;
      }
    });
  }

  function renderExpenseDeleteConfirmation() {
    const container = $("#expenseDeleteConfirmation");
    if (!container) return;
    const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
    const expense = getTripExpenses(trip).find(item => String(item.id) === String(pendingExpenseDeleteId));
    container.innerHTML = expense
      ? `<div class="expense-delete-confirm" role="alert"><span>ลบ “${escapeHTML(expense.title)}” จำนวน ${moneyExact(expense.amount)} ใช่ไหม?</span><div><button type="button" data-cancel-expense-delete>ยกเลิก</button><button type="button" class="confirm" data-confirm-expense-delete>ลบรายการ</button></div></div>`
      : "";
  }

  function renderExpenseDialog() {
    clearExpenseReceiptPreview();
    const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
    if (!trip) {
      closeDialog($("#expenseDialog"));
      return;
    }

    const content = $("#expenseContent");
    const expenses = getTripExpenses(trip);
    const participants = expenseParticipantNames(trip);
    const editingExpense = editingExpenseId
      ? expenses.find(expense => String(expense.id) === String(editingExpenseId))
      : null;
    const savedSplit = Array.isArray(editingExpense?.splitBetween) && editingExpense.splitBetween.length
      ? editingExpense.splitBetween
      : participants;
    const splitSelection = new Set(savedSplit);
    const formParticipants = expenseFormParticipants(trip, editingExpense);
    const existingReceipt = editingExpense && !removeEditingExpenseReceipt
      ? safeExpenseReceiptDataUrl(editingExpense.receiptImage)
      : "";
    const peopleCount = Math.max(1, participants.length);
    const budget = Math.max(0, Number(trip.budget) || 0);
    const spent = expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const remaining = budget - spent;
    const percentage = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
    const isOverBudget = spent > budget;
    const categorySpent = Object.fromEntries(EXPENSE_CATEGORIES.map(category => [category.id, 0]));
    expenses.forEach(expense => {
      const categoryId = categorySpent[expense.category] !== undefined ? expense.category : "activity";
      categorySpent[categoryId] += Number(expense.amount) || 0;
    });
    const categoryBudget = {
      transport: Number(trip.transport) || 0,
      food: Number(trip.food) || 0,
      stay: Number(trip.stay) || 0,
      activity: Number(trip.other) || 0
    };
    const settlement = getExpenseSettlement(trip, participants);
    const today = new Date();
    const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
    const categories = EXPENSE_CATEGORIES.map(category => {
      const actual = categorySpent[category.id];
      const planned = categoryBudget[category.id];
      const barWidth = planned > 0 ? Math.min(100, actual / planned * 100) : (actual > 0 ? 100 : 0);
      const over = planned > 0 && actual > planned;
      return `
        <div class="expense-category-row">
          <div class="expense-category-label"><span>${category.icon} ${category.label}</span><strong>${moneyExact(actual)} <small>/ ${moneyExact(planned)}</small></strong></div>
          <div class="expense-category-meter${over ? " over" : ""}" aria-hidden="true"><span style="width:${barWidth}%"></span></div>
        </div>`;
    }).join("");
    const expenseRows = [...expenses]
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map(expense => {
        const category = EXPENSE_CATEGORIES.find(item => item.id === expense.category) || EXPENSE_CATEGORIES[3];
        const splitCount = Array.isArray(expense.splitBetween) && expense.splitBetween.length
          ? expense.splitBetween.length
          : peopleCount;
        const splitNames = Array.isArray(expense.splitBetween) && expense.splitBetween.length
          ? expense.splitBetween
          : participants;
        const receiptImage = safeExpenseReceiptDataUrl(expense.receiptImage);
        return `
          <article class="expense-entry">
            <span class="expense-entry-icon" aria-hidden="true">${category.icon}</span>
            <div class="expense-entry-info">
              <strong>${escapeHTML(expense.title || category.label)}</strong>
              <small title="${escapeHTML(splitNames.join(", "))}">${escapeHTML(category.label)} · ${escapeHTML(formatDate(expense.date))} · ${escapeHTML(expense.paidBy || participants[0] || "ฉัน")} จ่าย · หาร ${splitCount} คน</small>
              ${receiptImage ? `<button class="expense-receipt-link" type="button" data-view-expense-receipt="${escapeHTML(expense.id)}">🧾 ดูสลิป</button>` : ""}
            </div>
            <strong class="expense-entry-amount">${moneyExact(expense.amount)}</strong>
            ${canEditTripExpense(trip, expense) ? `<div class="expense-entry-actions"><button class="expense-edit-button" type="button" data-edit-expense="${escapeHTML(expense.id)}" aria-label="แก้ไขรายการ ${escapeHTML(expense.title || category.label)}">✎</button><button class="expense-delete-button" type="button" data-delete-expense="${escapeHTML(expense.id)}" aria-label="ลบรายการ ${escapeHTML(expense.title || category.label)}">×</button></div>` : ""}
          </article>`;
      }).join("");
    const settlementTotalCents = settlement.reduce((total, item) => total + item.cents, 0);
    const transferRows = settlement.map((item, index) => `<li class="wallet-transfer-step">${settlement.length > 1 ? `<span class="wallet-transfer-number" aria-hidden="true">${index + 1}</span>` : ""}<p><b>${escapeHTML(item.from)}</b> <span>โอนให้</span> <b>${escapeHTML(item.to)}</b></p><strong class="wallet-transfer-amount">${moneyExact(item.cents / 100)}</strong></li>`).join("");
    const settlementMarkup = expenses.length
      ? `<p class="wallet-settlement-context">รวมค่าใช้จ่ายทั้ง ${expenses.length} รายการ และหักยอดที่จ่ายแทนกันแล้ว</p>${settlement.length
        ? `<ol class="wallet-transfer-steps">${transferRows}</ol>${settlement.length > 1 ? `<p class="wallet-transfer-total">รวม ${settlement.length} รายการโอน · ${moneyExact(settlementTotalCents / 100)}</p>` : ""}<p class="expense-disclaimer">ถ้าโอนคืนกันไปแล้ว ยอดในหน้านี้ยังไม่ได้หักเงินโอนนั้น</p>`
        : `<p class="wallet-no-transfer">ทุกคนจ่ายครบส่วนของตัวเองแล้ว ไม่ต้องโอนคืนกัน</p>`}`
      : `<p class="expense-settlement-empty">เพิ่มค่าใช้จ่ายก่อน แล้วจะเห็นว่าใครต้องโอนให้ใคร</p>`;
    const memberRows = getExpenseBalances(trip, participants).map(member => {
      const balance = member.paid - member.share;
      return `<tr><th scope="row">${escapeHTML(member.name)}</th><td>${moneyExact(member.paid / 100)}</td><td>${moneyExact(member.share / 100)}</td><td class="${balance < 0 ? "wallet-owes" : "wallet-receives"}">${balance === 0 ? "พอดีแล้ว" : `${balance > 0 ? "รับคืน" : "โอนคืน"} ${moneyExact(Math.abs(balance) / 100)}`} </td></tr>`;
    }).join("");
    const memberSummary = expenses.length ? `<details class="expense-member-details"><summary>ยอดนี้คิดยังไง?</summary><div class="expense-member-scroll"><table class="expense-member-table"><caption>ยอดจ่ายและส่วนแบ่ง คำนวณจากรายการค่าใช้จ่ายที่บันทึก</caption><thead><tr><th scope="col">สมาชิก</th><th scope="col">จ่ายไป</th><th scope="col">ส่วนของตัวเอง</th><th scope="col">ยอดสุทธิ</th></tr></thead><tbody>${memberRows}</tbody></table></div><p class="expense-disclaimer">แบ่งเศษสตางค์ตามลำดับคนที่เลือก เพื่อให้ยอดรวมตรงกัน · ยอดนี้ยังไม่ได้หักการโอนคืนภายหลัง</p></details>` : "";

    content.innerHTML = `
      <div class="expense-dialog-heading">
        <span class="expense-icon-large" aria-hidden="true">฿</span>
        <div><span class="section-kicker">TRIP WALLET</span><h2 id="expenseDialogTitle">คุมค่าใช้จ่ายจริง</h2><p>${escapeHTML(trip.destination || "ทริปของคุณ")} · ${escapeHTML(formatDate(trip.startDate))} – ${escapeHTML(formatDate(trip.endDate))}</p></div>
      </div>
      <section class="expense-overview${isOverBudget ? " over" : ""}" aria-label="สรุปค่าใช้จ่ายจริง">
        <div class="expense-overview-primary"><span>ใช้ไปแล้ว</span><strong>${moneyExact(spent)}</strong><small>จากงบ ${moneyExact(budget)}</small></div>
        <div class="expense-budget-meter${isOverBudget ? " over" : ""}" role="progressbar" aria-label="สัดส่วนงบที่ใช้จริง" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width:${percentage}%"></span></div>
        <div class="expense-overview-stats"><div><span>${isOverBudget ? "เกินงบ" : "งบคงเหลือ"}</span><strong>${moneyExact(Math.abs(remaining))}</strong></div><div><span>เฉลี่ยต่อสมาชิกทั้งหมด · ${peopleCount} คน</span><strong>${moneyExact(spent / peopleCount)}</strong></div></div>
        ${isOverBudget ? `<p class="expense-budget-alert">⚠️ ใช้เกินงบรวม ${moneyExact(Math.abs(remaining))} ลองดูยอดแต่ละหมวดก่อนวางแผนรายการถัดไป</p>` : ""}
      </section>
      <section class="expense-main-grid">
        <div class="expense-panel expense-add-panel">
          <div class="expense-panel-heading"><div><span class="section-kicker">TRIP WALLET</span><h3>${editingExpense ? "แก้ไขรายการ" : "เพิ่มรายการ"}</h3></div><span aria-hidden="true">${editingExpense ? "✎" : "＋"}</span></div>
          <form class="expense-form" id="expenseForm">
            ${editingExpense ? `<p class="expense-editing-note">กำลังแก้ไข “${escapeHTML(editingExpense.title || "รายการนี้")}” · ยอดหารและสรุปโอนจะคำนวณใหม่เมื่อบันทึก</p>` : ""}
            <label>จ่ายค่าอะไร<input name="title" type="text" maxlength="80" placeholder="เช่น ค่าอาหารมื้อเย็น" value="${escapeHTML(editingExpense?.title || "")}" required></label>
            <div class="expense-form-row"><label>หมวดหมู่<select name="category">${EXPENSE_CATEGORIES.map(category => `<option value="${category.id}"${category.id === editingExpense?.category ? " selected" : ""}>${category.icon} ${category.label}</option>`).join("")}</select></label><label>จำนวนเงิน (บาท)<input name="amount" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal" placeholder="0" value="${editingExpense ? escapeHTML(editingExpense.amount) : ""}" required></label></div>
            <div class="expense-form-row"><label>วันที่<input name="date" type="date" value="${escapeHTML(editingExpense?.date || localToday)}" required></label><label>ใครจ่าย<select name="paidBy">${formParticipants.map(name => `<option value="${escapeHTML(name)}"${(editingExpense?.paidBy || participants[0]) === name ? " selected" : ""}>${escapeHTML(name)}</option>`).join("")}</select></label></div>
            <fieldset class="expense-split-field"><legend>หารค่าใช้จ่ายกับใคร <small>เลือกเฉพาะคนที่ร่วมรายการนี้</small></legend><div class="expense-split-members">${formParticipants.map(name => `<label class="expense-split-member"><input type="checkbox" name="splitBetween" value="${escapeHTML(name)}"${splitSelection.has(name) ? " checked" : ""}><span>${escapeHTML(name)}</span></label>`).join("")}</div></fieldset>
            <div class="expense-receipt-field"><label for="expenseReceipt">แนบสลิป <span>(ไม่บังคับ)</span></label><input id="expenseReceipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp"><small>${editingExpense ? "เลือกรูปใหม่เพื่อแทนสลิปเดิม · เว้นว่างเพื่อเก็บรูปเดิม" : "JPG, PNG หรือ WEBP · ไม่เกิน 8 MB · ระบบจะย่อรูปก่อนบันทึก"}</small><div class="expense-receipt-preview${existingReceipt ? " expense-existing-receipt" : ""}" id="expenseReceiptPreview"${existingReceipt ? "" : " hidden"}><img id="expenseReceiptPreviewImage" alt="ตัวอย่างรูปสลิป"${existingReceipt ? ` src="${existingReceipt}"` : ""}><span>${existingReceipt ? "สลิปที่แนบไว้" : "แนบรูปสลิปแล้ว"}</span><button type="button" id="removeExpenseReceipt">เอาออก</button></div></div>
            <p class="expense-form-note" id="expenseFormNote">หารเท่ากันระหว่าง <strong>${splitSelection.size} คน · ${moneyExact((Number(editingExpense?.amount) || 0) / Math.max(1, splitSelection.size))} / คน</strong></p>
            <p id="expenseSaveStatus" class="expense-save-status" role="status" aria-live="polite" hidden></p>
            <button class="btn btn-dark full" type="submit">${editingExpense ? "บันทึกการแก้ไข" : "＋ บันทึกค่าใช้จ่าย"}</button>
            ${editingExpense ? `<button class="btn btn-outline full" type="button" data-cancel-expense-edit>ยกเลิกการแก้ไข</button>` : ""}
          </form>
        </div>
        <div class="expense-panel expense-breakdown-panel">
          <div class="expense-panel-heading"><div><span class="section-kicker">PLAN VS ACTUAL</span><h3>เทียบกับงบที่วางไว้</h3></div><span aria-hidden="true">◷</span></div>
          <div class="expense-category-list">${categories}</div>
          <p class="expense-disclaimer">หมวดกิจกรรมรวมกับค่าใช้จ่ายอื่นตามแผนเดิม</p>
        </div>
      </section>
      <section class="expense-settlement-panel"><div class="expense-panel-heading"><div><span class="section-kicker">SETTLE UP</span><h3>ใครต้องโอนให้ใคร?</h3></div><span aria-hidden="true">⇄</span></div>${settlementMarkup}${memberSummary}${expenses.length ? `<button class="expense-copy-button" type="button" data-copy-expense-summary>คัดลอกสรุปส่งให้เพื่อน ↗</button>` : ""}</section>
      <section class="expense-ledger-panel"><div class="expense-ledger-heading"><div><span class="section-kicker">TRIP LEDGER</span><h3>รายการทั้งหมด</h3></div><span>${expenses.length} รายการ</span></div><div id="expenseDeleteConfirmation"></div>${expenseRows || `<div class="expense-empty"><span aria-hidden="true">🧾</span><strong>ยังไม่มีค่าใช้จ่ายจริง</strong><p>เริ่มบันทึกรายการแรก เพื่อดูยอดคงเหลือและสรุปหารเงิน</p></div>`}</section>
    `;
    updateExpenseSplitNote();
    renderExpenseDeleteConfirmation();
  }

  function updateExpenseSplitNote(form = $("#expenseForm")) {
    if (!form) return;
    const checked = [...form.querySelectorAll("input[name=\"splitBetween\"]:checked")];
    const amount = Number(form.querySelector("[name=\"amount\"]")?.value) || 0;
    const note = form.querySelector("#expenseFormNote");
    if (!note) return;
    if (!checked.length) {
      note.textContent = "เลือกคนอย่างน้อย 1 คนเพื่อแบ่งยอดค่าใช้จ่าย";
      return;
    }
    const cents = Math.max(0, Math.round(amount * 100));
    const base = Math.floor(cents / checked.length);
    const extra = cents % checked.length;
    note.innerHTML = `หาร <strong>${checked.length} คน · ${moneyExact(base / 100)}${extra ? "–" + moneyExact((base + 1) / 100) : ""} / คน</strong>${extra ? " · " + extra + " คนแรกเพิ่มคนละ 0.01 บาท" : ""}`;
  }
  async function persistTripUpdate(trip) {
    const nextTrips = trips.map(item => String(item.id) === String(trip.id) ? trip : item);
    if (cloudConfigured) {
      if (!requireCloudAccount()) return false;
      if (!await writeCloudTrip(trip)) return false;
    } else if (!saveData(KEYS.trips, nextTrips)) {
      return false;
    }

    trips = nextTrips;
    renderSavedTrips();
    updateAccountUI();
    return true;
  }

  async function addTripExpense(event) {
    event.preventDefault();
    if (expenseSaving) return;
    const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
    if (!trip) return;
    if (cloudConfigured && !requireCloudAccount()) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    setExpenseFeedback("");
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const amount = Number(formData.get("amount"));
    const date = String(formData.get("date") || "");
    const category = String(formData.get("category") || "");
    const paidBy = String(formData.get("paidBy") || "");
    const splitBetween = [...new Set(formData.getAll("splitBetween").map(name => String(name)))];
    const receiptFile = formData.get("receipt");
    const previousExpense = editingExpenseId
      ? getTripExpenses(trip).find(expense => String(expense.id) === String(editingExpenseId))
      : null;
    if (previousExpense && !canEditTripExpense(trip, previousExpense)) {
      setExpenseFeedback("แก้ไขได้เฉพาะค่าใช้จ่ายของตัวเอง", true);
      return;
    }
    if (editingExpenseId && !previousExpense) {
      toast("หารายการที่ต้องการแก้ไขไม่พบ กรุณาเปิด Trip Wallet อีกครั้ง");
      editingExpenseId = null;
      renderExpenseDialog();
      return;
    }
    if (!title || !date || !EXPENSE_CATEGORIES.some(item => item.id === category) || !Number.isFinite(amount) || amount <= 0 || amount > 999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) {
      setExpenseFeedback("กรอกชื่อรายการ วันที่ และจำนวนเงินมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)", true);
      return;
    }
    const participants = expenseFormParticipants(trip, previousExpense);
    const validNames = new Set(participants);
    const validSplit = splitBetween.filter(name => validNames.has(name));
    if (!validSplit.length) {
      setExpenseFeedback("เลือกคนที่ร่วมรายการอย่างน้อย 1 คน", true);
      return;
    }
    if (!validNames.has(paidBy)) {
      setExpenseFeedback("เลือกชื่อผู้จ่ายจากสมาชิกในทริป", true);
      return;
    }
    const submitButton = form.querySelector("button[type=\"submit\"]");
    if (submitButton?.disabled) return;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "กำลังบันทึก…";
    }
    setExpenseBusy(true);
    setExpenseFeedback("กำลังบันทึกค่าใช้จ่าย…");
    try {
      const uploadedReceipt = receiptFile && typeof receiptFile === "object" && receiptFile.size
        ? await compressExpenseReceipt(receiptFile)
        : "";
      const retainedReceipt = !removeEditingExpenseReceipt
        ? safeExpenseReceiptDataUrl(previousExpense?.receiptImage)
        : "";
      const expense = {
        ...(previousExpense || {}),
        id: previousExpense?.id || globalThis.crypto?.randomUUID?.() || `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title, category, amount: Math.round(amount * 100) / 100, date, paidBy, splitBetween: validSplit,
        ...((uploadedReceipt || retainedReceipt) ? { receiptImage: uploadedReceipt || retainedReceipt } : {}),
        createdAt: previousExpense?.createdAt || Date.now(),
        ...(currentUser ? { createdBy: previousExpense?.createdBy || currentUser.id } : {}),
        updatedAt: Date.now()
      };
      if (!uploadedReceipt && !retainedReceipt) delete expense.receiptImage;
      const currentExpenses = getTripExpenses(trip);
      const nextExpenses = previousExpense
        ? currentExpenses.map(item => String(item.id) === String(previousExpense.id) ? expense : item)
        : [...currentExpenses, expense];
      const updatedTrip = { ...trip, expenses: nextExpenses, updatedAt: Date.now() };
      if (!await persistTripUpdate(updatedTrip)) {
        setExpenseFeedback("บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง", true);
        return;
      }
      const wasEditing = Boolean(previousExpense);
      editingExpenseId = null;
      removeEditingExpenseReceipt = false;
      pendingExpenseDeleteId = null;
      renderExpenseDialog();
      $("#expenseForm [name=\"title\"]")?.focus();
      setExpenseFeedback(wasEditing ? "แก้ไขรายการเรียบร้อย ยอดหารอัปเดตแล้ว" : "บันทึกแล้ว เพิ่มรายการถัดไปได้เลย");
      toast(wasEditing ? "แก้ไขค่าใช้จ่ายแล้ว" : "บันทึกค่าใช้จ่ายแล้ว");
    } catch (error) {
      console.error("Tripmate expense save error", error);
      setExpenseFeedback(error.message || "บันทึกค่าใช้จ่ายไม่สำเร็จ กรุณาลองอีกครั้ง", true);
    } finally {
      setExpenseBusy(false);
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = editingExpenseId ? "บันทึกการแก้ไข" : "＋ บันทึกค่าใช้จ่าย";
      }
    }
  }
  async function deleteTripExpense(expenseId) {
    if (expenseSaving) return;
    const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
    if (!trip || !expenseId) return;
    if (!canEditTripExpense(trip, getTripExpenses(trip).find(item => String(item.id) === String(expenseId)))) return;
    if (cloudConfigured && !requireCloudAccount()) return;
    setExpenseBusy(true);
    try {
      const updatedTrip = {
        ...trip,
        expenses: getTripExpenses(trip).filter(expense => String(expense.id) !== String(expenseId)),
        updatedAt: Date.now()
      };
      if (!await persistTripUpdate(updatedTrip)) {
        setExpenseFeedback("ลบไม่สำเร็จ รายการเดิมยังอยู่ กรุณาลองอีกครั้ง", true);
        return;
      }
      if (String(editingExpenseId) === String(expenseId)) {
        editingExpenseId = null;
        removeEditingExpenseReceipt = false;
      }
      pendingExpenseDeleteId = null;
      renderExpenseDialog();
      toast("ลบรายการค่าใช้จ่ายแล้ว");
    } catch (error) {
      setExpenseFeedback("ลบรายการไม่สำเร็จ กรุณาลองอีกครั้ง", true);
    } finally {
      setExpenseBusy(false);
    }
  }

  async function copyExpenseSummary() {
    const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
    if (!trip) return;
    const expenses = getTripExpenses(trip);
    const participants = expenseParticipantNames(trip);
    const total = expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const budget = Math.max(0, Number(trip.budget) || 0);
    const remaining = budget - total;
    const settlement = getExpenseSettlement(trip, participants);
    const settlementTotalCents = settlement.reduce((sum, item) => sum + item.cents, 0);
    const lines = [
      `Tripmate · ${trip.destination || "ทริปของฉัน"}`,
      `รวมค่าใช้จ่าย ${expenses.length} รายการ · ${moneyExact(total)}`,
      "",
      "ใครต้องโอนให้ใคร:",
      ...(settlement.length
        ? settlement.map((item, index) => `${settlement.length > 1 ? (index + 1) + ". " : ""}${item.from} โอนให้ ${item.to} ${moneyExact(item.cents / 100)}`)
        : [expenses.length ? "ทุกคนจ่ายครบส่วนของตัวเองแล้ว ไม่ต้องโอนคืนกัน" : "ยังไม่มีค่าใช้จ่าย"]),
      ...(settlement.length > 1 ? [`รวมยอดโอน ${moneyExact(settlementTotalCents / 100)}`] : []),
      "",
      "คำนวณจากค่าใช้จ่ายทุกรายการ ยังไม่ได้หักเงินที่โอนคืนกันไปแล้ว"
    ].join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      toast("คัดลอกสรุปค่าใช้จ่ายแล้ว");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = lines;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      toast(copied ? "คัดลอกสรุปค่าใช้จ่ายแล้ว" : "คัดลอกไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
  }

  function openExpenseDialog(tripId) {
    if (cloudConfigured && !requireCloudAccount()) return;
    const trip = trips.find(item => String(item.id) === String(tripId));
    if (!trip) return;
    activeExpenseTripId = String(tripId);
    pendingExpenseDeleteId = null;
    editingExpenseId = null;
    removeEditingExpenseReceipt = false;
    renderExpenseDialog();
    openDialog("#expenseDialog");
  }

  async function copySummary() {
    const trip = collectTrip();
    const costs = getCosts();
    const total = getTotal(costs);
    const people = getPeopleCount();

    let text = [
      `Tripmate — ${trip.destination || "ทริปใหม่ของคุณ"}`,
      `วันเดินทาง: ${formatDate(trip.startDate)} ถึง ${formatDate(trip.endDate)}`,
      `การเดินทาง: ${trip.transportType}`,
      `อาหาร: ${trip.foodType}`,
      `ที่พัก: ${trip.stayType}`,
      `จำนวนคน: ${people} คน`,
      `งบประมาณ: ${money(costs.budget)}`,
      `ค่าใช้จ่ายรวม: ${money(total)}`,
      `งบคงเหลือ: ${money(costs.budget - total)}`,
      `เฉลี่ยต่อคน: ${money(total / people)}`
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast("คัดลอกสรุปทริปแล้ว");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";

      document.body.appendChild(textarea);
      textarea.select();

      const success = document.execCommand("copy");
      textarea.remove();

      toast(success
        ? "คัดลอกสรุปทริปแล้ว"
        : "คัดลอกไม่สำเร็จ กรุณาลองเปิดเว็บผ่าน localhost");
    }
  }

  // ---------- Reviews ----------

  function makeReviewCardInteractive(card) {
    const title = card.querySelector(".review-content h3")?.textContent.trim() || "รีวิวทริป";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-label", `เปิดรายละเอียดรีวิว: ${title}`);
  }

  function getCurrentReviewOwnerId() {
    if (currentUser?.id) return currentUser.id;

    const profile = readData(KEYS.profile, null);
    const email = String(profile?.email || "").trim().toLocaleLowerCase();
    if (email) return `email:${email}`;

    let guestId = readData(KEYS.reviewGuest, null);
    if (!guestId) {
      guestId = globalThis.crypto?.randomUUID?.() ||
        `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      saveData(KEYS.reviewGuest, guestId);
    }

    return `guest:${guestId}`;
  }

  function renderReviews() {
    const grid = $("#reviewGrid");

    // การ์ดตัวอย่างถูกเก็บไว้ใน HTML และไม่ถูกสร้างซ้ำ
    const staticCards = $$("[data-default-review]", grid);
    staticCards.forEach(makeReviewCardInteractive);

    // ลบเฉพาะรีวิวที่ JavaScript สร้างก่อนหน้า
    $$("[data-custom-review]", grid).forEach(card => card.remove());

    const customCards = reviews.map(review => {
      const card = document.createElement("article");

      card.className = "review-card";
      card.dataset.customReview = "true";
      card.dataset.reviewId = String(review.id || "");
      card.dataset.place = review.place;
      card.dataset.rating = String(review.rating);
      card.dataset.time = String(review.createdAt || 0);

      const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
      const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
      const fullText = String(review.text || "");
      const previewText = fullText.length > 140
        ? `${fullText.slice(0, 140).trimEnd()}…`
        : fullText;
      const cost = review.cost === "" || review.cost == null
        ? "ไม่ระบุค่าใช้จ่าย"
        : `${money(review.cost)} / คน`;

      const author = review.author || getDisplayName() || "นักเดินทาง";
      const image = typeof review.image === "string" &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(review.image)
        ? review.image
        : "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80";

      card.dataset.reviewText = fullText;
      card.dataset.reviewAuthor = author;
      card.dataset.reviewCost = cost;

      card.innerHTML = `
        <div class="review-image">
          <img
            src="${escapeHTML(image)}"
            alt="ภาพประกอบรีวิวการเดินทาง"
            loading="lazy"
          >
          <span class="review-category">รีวิวจากผู้ใช้</span>
        </div>
        <div class="review-content">
          <div class="review-meta">${stars} <b>${rating.toFixed(1)}</b><small>รีวิวจากผู้ใช้</small></div>
          <h3>${escapeHTML(review.place)}</h3>
          <p>${escapeHTML(previewText)}</p>
          <div class="review-bottom">
            <span class="review-author"><span class="mini-avatar mint">${escapeHTML(author.trim().charAt(0).toUpperCase() || "T")}</span> ${escapeHTML(author)}</span>
            <span class="review-cost">${escapeHTML(cost)}</span>
          </div>
        </div>
      `;

      makeReviewCardInteractive(card);
      return card;
    });

    grid.replaceChildren(...customCards, ...staticCards);
    filterReviews();
  }

  function filterReviews() {
    const grid = $("#reviewGrid");
    const query = $("#reviewSearch").value.trim().toLocaleLowerCase();
    const sort = $("#reviewSort").value;

    const cards = $$(".review-card", grid);

    const visible = cards.filter(card => {
      const searchable = (
        (card.dataset.place || "") + " " + card.textContent
      ).toLocaleLowerCase();

      const matches = searchable.includes(query);
      card.hidden = !matches;
      return matches;
    });

    visible.sort((a, b) => {
      if (sort === "rating") {
        return Number(b.dataset.rating || 0) - Number(a.dataset.rating || 0);
      }

      return Number(b.dataset.time || 0) - Number(a.dataset.time || 0);
    });

    // เรียงเฉพาะการ์ดที่แสดง โดยไม่ทำให้การ์ดซ้ำ
    visible.forEach(card => grid.appendChild(card));

    $("#noReviews").hidden = visible.length > 0;
  }

  function openReviewDetails(card) {
    const title = card.querySelector(".review-content h3")?.textContent.trim() || "รีวิวทริป";
    const category = card.querySelector(".review-category")?.textContent.trim() || "รีวิวจากผู้ใช้";
    const rating = Math.max(1, Math.min(5, Number(card.dataset.rating) || 5));
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    const text = card.dataset.reviewText ??
      card.querySelector(".review-content p")?.textContent.trim() ?? "";
    const authorNode = card.querySelector(".review-author");
    const authorClone = authorNode?.cloneNode(true);
    authorClone?.querySelector(".mini-avatar")?.remove();
    const author = card.dataset.reviewAuthor || authorClone?.textContent.trim() || "นักเดินทาง";
    const cost = card.dataset.reviewCost || card.querySelector(".review-cost")?.textContent.trim() || "ไม่ระบุค่าใช้จ่าย";
    const image = card.querySelector(".review-image img")?.getAttribute("src") || "";
    const createdAt = Number(card.dataset.time || 0);
    const reviewDate = card.dataset.customReview && createdAt
      ? new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(new Date(createdAt))
      : "";
    const review = reviews.find(item => String(item.id || "") === card.dataset.reviewId);
    const canDelete = Boolean(
      review && review.ownerId && review.ownerId === getCurrentReviewOwnerId()
    );

    $("#reviewDetailContent").innerHTML = `
      ${image ? `<img class="review-detail-image" src="${escapeHTML(image)}" alt="ภาพประกอบรีวิว ${escapeHTML(title)}">` : ""}
      <div class="review-detail-body">
        <span class="review-detail-category">${escapeHTML(category)}</span>
        <div class="review-detail-rating" aria-label="คะแนน ${rating.toFixed(1)} จาก 5">${stars} <b>${rating.toFixed(1)}</b></div>
        <h2 id="reviewDetailTitle">${escapeHTML(title)}</h2>
        <div class="review-detail-byline">รีวิวโดย ${escapeHTML(author)}${reviewDate ? ` · ${escapeHTML(reviewDate)}` : ""}</div>
        <p class="review-detail-text">${escapeHTML(text)}</p>
        <div class="review-detail-cost"><span>ค่าใช้จ่ายต่อคน</span><strong>${escapeHTML(cost)}</strong></div>
        ${canDelete ? `
          <div class="review-detail-actions">
            <button class="btn-delete-review" type="button" data-delete-review="${escapeHTML(review.id)}">
              ลบรีวิวของฉัน
            </button>
          </div>
        ` : ""}
      </div>
    `;

    openDialog("#reviewDetailDialog");
  }

  function openDeleteReviewDialog(id) {
    const review = reviews.find(item => String(item.id || "") === String(id));
    if (!review || !review.ownerId || review.ownerId !== getCurrentReviewOwnerId()) {
      toast("ลบได้เฉพาะรีวิวที่คุณเขียน");
      return;
    }

    pendingReviewDeleteId = String(id);
    $("#deleteReviewPlace").textContent = review.place || "รีวิวนี้";
    openDialog("#deleteReviewDialog");
  }

  async function deleteOwnReview() {
    const id = pendingReviewDeleteId;
    if (!id) return;

    const review = reviews.find(item => String(item.id || "") === id);
    if (!review || !review.ownerId || review.ownerId !== getCurrentReviewOwnerId()) {
      pendingReviewDeleteId = null;
      closeDialog($("#deleteReviewDialog"));
      toast("ลบได้เฉพาะรีวิวที่คุณเขียน");
      return;
    }

    if (cloudConfigured) {
      if (!requireCloudAccount()) return;
      const { error } = await supabaseClient
        .from("reviews")
        .delete()
        .eq("id", id)
        .eq("owner_id", currentUser.id);
      if (error) {
        showDatabaseSetupError(error);
        return;
      }
    }

    const nextReviews = reviews.filter(item => String(item.id || "") !== String(id));
    if (!cloudConfigured && !saveData(KEYS.reviews, nextReviews)) return;

    reviews = nextReviews;
    pendingReviewDeleteId = null;
    closeDialog($("#deleteReviewDialog"));
    closeDialog($("#reviewDetailDialog"));
    renderReviews();
    toast("ลบรีวิวของคุณแล้ว");
  }

  function compressReviewPhoto(file) {
    const maxSize = 10 * 1024 * 1024;

    if (!file.type.startsWith("image/")) {
      return Promise.reject(new Error("กรุณาเลือกไฟล์รูปภาพ"));
    }

    if (file.size > maxSize) {
      return Promise.reject(new Error("รูปภาพต้องมีขนาดไม่เกิน 10 MB"));
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("เปิดไฟล์รูปภาพนี้ไม่ได้"));
        image.onload = () => {
          const maxDimension = 1200;
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("เตรียมรูปภาพไม่สำเร็จ"));
            return;
          }

          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function clearReviewPhotoPreview() {
    const input = $("#reviewPhoto");
    if (input) input.value = "";

    if (reviewPreviewUrl) {
      URL.revokeObjectURL(reviewPreviewUrl);
      reviewPreviewUrl = null;
    }

    $("#reviewPhotoPreview").hidden = true;
    $("#reviewPhotoPreviewImage").removeAttribute("src");
  }

  function updateReviewPhotoPreview() {
    const input = $("#reviewPhoto");
    const file = input.files?.[0];
    if (!file) {
      clearReviewPhotoPreview();
      return;
    }

    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      toast(file.size > 10 * 1024 * 1024
        ? "รูปภาพต้องมีขนาดไม่เกิน 10 MB"
        : "กรุณาเลือกไฟล์รูปภาพ");
      clearReviewPhotoPreview();
      return;
    }

    if (reviewPreviewUrl) URL.revokeObjectURL(reviewPreviewUrl);
    reviewPreviewUrl = URL.createObjectURL(file);
    $("#reviewPhotoPreviewImage").src = reviewPreviewUrl;
    $("#reviewPhotoPreview").hidden = false;
  }

  async function submitReview(event) {
    event.preventDefault();

    if (cloudConfigured && !requireCloudAccount()) return;

    const place = $("#newReviewPlace").value.trim();
    const text = $("#newReviewText").value.trim();
    const costInput = $("#newReviewCost").value;

    if (!place || !text || !$("#visitedCheck").checked) {
      toast("กรอกสถานที่ รีวิว และยืนยันประสบการณ์ก่อน");
      return;
    }

    if (costInput !== "" && Number(costInput) < 0) {
      toast("ค่าใช้จ่ายต้องไม่ติดลบ");
      return;
    }

    let image = "";
    const photo = $("#reviewPhoto").files?.[0];
    if (photo) {
      try {
        image = await compressReviewPhoto(photo);
      } catch (error) {
        toast(error.message || "เตรียมรูปภาพไม่สำเร็จ");
        return;
      }
    }

    const review = {
      id: globalThis.crypto?.randomUUID?.() || `review-${Date.now()}`,
      place,
      rating: Number($("#newReviewRating").value) || 5,
      text,
      cost: costInput === "" ? "" : Number(costInput),
      image,
      author: getDisplayName(),
      ownerId: getCurrentReviewOwnerId(),
      createdAt: Date.now()
    };

    if (cloudConfigured) {
      const { error } = await supabaseClient.from("reviews").insert({
        id: review.id,
        owner_id: currentUser.id,
        data: review,
        created_at: new Date(review.createdAt).toISOString()
      });
      if (error) {
        showDatabaseSetupError(error);
        return;
      }
    }

    const nextReviews = [review, ...reviews];
    if (!cloudConfigured && !saveData(KEYS.reviews, nextReviews)) return;

    reviews = nextReviews;
    $("#reviewForm").reset();
    clearReviewPhotoPreview();
    closeDialog($("#reviewDialog"));
    renderReviews();
    toast("เพิ่มรีวิวเรียบร้อยแล้ว");
  }

  // ---------- Theme ----------

  function setTheme(theme) {
    const dark = theme === "dark";

    document.body.classList.toggle("dark", dark);

    const button = $("#themeToggle");
    button.textContent = dark ? "☀" : "☾";
    button.setAttribute(
      "aria-label",
      dark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"
    );

    try {
      localStorage.setItem(KEYS.theme, dark ? "dark" : "light");
    } catch {}
  }

  function initTheme() {
    let theme = "light";

    try {
      theme = localStorage.getItem(KEYS.theme) || "light";
    } catch {}

    setTheme(theme);
  }

  // ---------- Account demo ----------

  async function signup(event) {
    event.preventDefault();

    const name = $("#signupName").value.trim();
    const email = $("#signupEmail").value.trim();

    if (!name || !email || !$("#signupPassword").value) {
      toast("กรุณากรอกข้อมูลให้ครบ");
      return;
    }

    if (!cloudConfigured || !supabaseClient) {
      requireCloudAccount();
      return;
    }

    savePendingPlannerDraft();
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password: $("#signupPassword").value,
      options: {
        data: { display_name: name, full_name: name },
        emailRedirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`
      }
    });
    if (error) {
      toast(error.message || "สมัครสมาชิกไม่สำเร็จ");
      return;
    }

    $("#signupForm").reset();
    closeDialog($("#signupDialog"));
    if (data.session) {
      await applyAuthSession(data.session);
      toast(`ยินดีต้อนรับ ${name}`);
    } else {
      toast("สมัครแล้ว กรุณายืนยันอีเมลจากกล่องจดหมายก่อนเข้าสู่ระบบ");
    }
  }

  async function login(event) {
    event.preventDefault();

    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;

    if (!email || !password) {
      toast("กรุณากรอกอีเมลและรหัสผ่าน");
      return;
    }

    if (!cloudConfigured || !supabaseClient) {
      requireCloudAccount();
      return;
    }

    savePendingPlannerDraft();
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      toast(error.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      return;
    }

    $("#loginForm").reset();
    closeDialog($("#loginDialog"));
    await applyAuthSession(data.session);
    toast(`ยินดีต้อนรับกลับ ${getDisplayName(data.user)}`);
  }

  async function logout() {
    if (!supabaseClient) {
      toast("ระบบบัญชียังไม่พร้อม จึงออกจากระบบไม่ได้");
      return;
    }

    const button = $("#logoutButton");
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.textContent = "กำลังออกจากระบบ…";
    }

    try {
      // Explicitly revoke sessions for this account, then verify this browser
      // no longer has an active Supabase session before clearing the UI.
      const { error } = await supabaseClient.auth.signOut({ scope: "global" });
      if (error) {
        toast(error.message || "ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
        return;
      }

      const { data, error: verifyError } = await supabaseClient.auth.getSession();
      if (!verifyError && data.session) {
        toast("ยังพบเซสชันที่เข้าสู่ระบบอยู่ กรุณากดออกจากระบบอีกครั้ง");
        return;
      }

      if (verifyError) {
        console.warn("Could not recheck the Supabase session after sign out", verifyError);
      }

      closeDialog($("#accountDialog"));
      try {
        sessionStorage.removeItem("tripmate-pending-cloud-trip");
        sessionStorage.removeItem(KEYS.tripSaveNotice);
      } catch {}
      await applyAuthSession(null);
      toast(verifyError
        ? "ออกจากระบบแล้ว แต่ตรวจสอบซ้ำไม่ได้ กรุณาโหลดหน้าเว็บใหม่หากยังเห็นข้อมูลบัญชี"
        : "ออกจากระบบแล้ว และล้างข้อมูลบัญชีออกจากหน้านี้แล้ว");
    } catch (error) {
      console.error("Tripmate sign out error", error);
      toast("ออกจากระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "ออกจากระบบ";
      }
    }
  }

  // ---------- Event listeners ----------

  function initEvents() {
    $("#themeToggle").addEventListener("click", () => {
      setTheme(document.body.classList.contains("dark") ? "light" : "dark");
    });

    $("#startPlanning").addEventListener("click", () => navigateToPage("planner"));
    $("#startPlanningBottom").addEventListener("click", () => navigateToPage("planner"));
    $("#discoverCategories").addEventListener("click", event => {
      const button = event.target.closest("[data-discover-query]");
      if (!button) return;
      $$("[data-discover-query]", $("#discoverCategories")).forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      $("#discoverCategoryLabel").textContent = button.textContent.trim();
      const province = $("#discoverProvince").value;
      $("#discoverStatus").textContent = province
        ? "พร้อมค้นหา" + button.textContent.trim() + "ใน" + province
        : "เลือกจังหวัดก่อนค้นหาไอเดียเที่ยว";
    });
    $("#discoverProvince").addEventListener("change", () => {
      const province = $("#discoverProvince").value;
      $("#discoverStatus").textContent = province
        ? "เลือก " + province + " แล้ว · เลือกหมวดหมู่ที่สนใจเพื่อดูผลค้นหา"
        : "เลือกจังหวัดและหมวดหมู่ แล้วเปิดผลค้นหาใน Google Maps ได้เลย";
    });
    $("#discoverRandomProvince").addEventListener("click", () => {
      const choices = THAI_PROVINCES.filter(province => province !== $("#discoverProvince").value);
      const province = choices[Math.floor(Math.random() * choices.length)];
      $("#discoverProvince").value = province;
      $("#discoverProvince").dispatchEvent(new Event("change"));
    });
    $("#discoverSearch").addEventListener("click", () => {
      const province = $("#discoverProvince").value;
      if (!province) {
        toast("เลือกจังหวัดก่อนค้นหาที่เที่ยว");
        $("#discoverProvince").focus();
        return;
      }
      const category = $("[data-discover-query].active", $("#discoverCategories"));
      const query = (category?.dataset.discoverQuery || "สถานที่ท่องเที่ยว") + " " + province + " ประเทศไทย";
      const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
      window.open(url, "_blank", "noopener,noreferrer");
      $("#discoverStatus").textContent = "เปิดผลค้นหา " + (category?.textContent.trim() || "ที่เที่ยว") + " ใน" + province + " บน Google Maps แล้ว";
    });
    $("#discoverPlanTrip").addEventListener("click", () => {
      const province = $("#discoverProvince").value;
      if (!province) {
        toast("เลือกจังหวัดที่อยากไปก่อนเริ่มวางแผน");
        $("#discoverProvince").focus();
        return;
      }
      navigateToPage("planner", { new: "1", destination: province });
    });

    $("#goPlanner").addEventListener("click", () => {
      navigateToPage("planner", { new: "1" });
    });

    $("#openSignup").addEventListener("click", () => {
      openDialog(currentUser ? "#accountDialog" : "#signupDialog");
    });
    $("#openReview").addEventListener("click", () => openDialog("#reviewDialog"));
    $("#googleSignup").addEventListener("click", signInWithGoogle);
    $("#googleLogin").addEventListener("click", signInWithGoogle);
    $("#logoutButton").addEventListener("click", logout);

    $("#switchToLogin").addEventListener("click", () => {
      closeDialog($("#signupDialog"));
      openDialog("#loginDialog");
    });

    $("#switchToSignup").addEventListener("click", () => {
      closeDialog($("#loginDialog"));
      openDialog("#signupDialog");
    });

    $$("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => {
        closeDialog(button.closest("dialog"));
      });
    });

    $$("dialog.modal").forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    $("#deleteReviewDialog").addEventListener("close", () => {
      pendingReviewDeleteId = null;
    });

    $("#addFriend").addEventListener("click", addFriend);

    $("#friendEmail").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        addFriend();
      }
    });

    $("#friendList").addEventListener("change", event => {
      const input = event.target.closest("[data-friend-going]");
      if (!input) return;

      const index = Number(input.dataset.friendGoing);
      if (!friends[index]) return;
      friends[index].going = input.checked;
      renderFriends();
    });

    $("#friendList").addEventListener("click", event => {
      const button = event.target.closest("[data-remove-friend]");
      if (!button) return;
      friends.splice(Number(button.dataset.removeFriend), 1);
      renderFriends();
    });

    $$("[data-destination]").forEach(button => {
      button.addEventListener("click", () => {
        $("#destination").value = button.dataset.destination;
        updateSummary();
      });
    });

    $("#suggestDestination").addEventListener("click", () => {
      const current = $("#destination").value.trim();
      const choices = THAI_PROVINCES.filter(province => province !== current);
      const choice = choices[Math.floor(Math.random() * choices.length)];

      $("#destination").value = choice;
      updateSummary();
    });

    [
      "#destination", "#startDate", "#endDate", "#budget",
      "#transport", "#food", "#stay", "#other",
      "#transportType", "#foodType", "#stayType"
    ].forEach(selector => {
      const refreshPlanner = () => {
        updateSummary();
      };
      $(selector).addEventListener("input", refreshPlanner);
      $(selector).addEventListener("change", refreshPlanner);
    });

    $("#saveTrip").addEventListener("click", saveTrip);
    $("#copySummary").addEventListener("click", copySummary);

    $("#savedTripGrid").addEventListener("click", async event => {
      const shareButton = event.target.closest("[data-share-trip]");
      if (shareButton) { void openTripSharing(shareButton.dataset.shareTrip); return; }
      const expenseButton = event.target.closest("[data-expense-trip]");
      const editButton = event.target.closest("[data-edit-trip]");
      const deleteButton = event.target.closest("[data-delete-trip]");

      if (expenseButton) {
        openExpenseDialog(expenseButton.dataset.expenseTrip);
        return;
      }

      if (editButton) {
        navigateToPage("planner", { trip: editButton.dataset.editTrip });
        return;
      }

      if (deleteButton) {
        const id = deleteButton.dataset.deleteTrip;
        const trip = trips.find(item => item.id === id);

        if (!trip || isSharedTrip(trip.id)) return;

        if (!confirm(`ต้องการลบทริป "${trip.destination}" หรือไม่?`)) {
          return;
        }

        const nextTrips = trips.filter(item => item.id !== id);
        if (cloudConfigured) {
          if (!requireCloudAccount()) return;
          const { error } = await supabaseClient
            .from("trips")
            .delete()
            .eq("id", String(id))
            .eq("user_id", currentUser.id);
          if (error) {
            showDatabaseSetupError(error);
            return;
          }
        } else if (!saveData(KEYS.trips, nextTrips)) {
          return;
        }

        trips = nextTrips;
        if (editingTripId === id) resetPlanner();

        renderSavedTrips();
        updateAccountUI();
        toast("ลบทริปแล้ว");
      }
    });

    const expenseDialog = $("#expenseDialog");
    expenseDialog.addEventListener("cancel", event => {
      if (expenseSaving) event.preventDefault();
    });
    expenseDialog.addEventListener("submit", event => {
      if (event.target.id === "expenseForm") void addTripExpense(event);
    });
    expenseDialog.addEventListener("input", event => {
      if (event.target.closest("#expenseForm")) updateExpenseSplitNote(event.target.closest("#expenseForm"));
    });
    expenseDialog.addEventListener("change", event => {
      if (event.target.id === "expenseReceipt") updateExpenseReceiptPreview(event.target);
      else if (event.target.closest("#expenseForm")) updateExpenseSplitNote(event.target.closest("#expenseForm"));
    });
    expenseDialog.addEventListener("click", event => {
      if (expenseSaving) return;
      const receiptButton = event.target.closest("[data-view-expense-receipt]");
      if (receiptButton) {
        const trip = trips.find(item => String(item.id) === String(activeExpenseTripId));
        const expense = getTripExpenses(trip).find(item => String(item.id) === String(receiptButton.dataset.viewExpenseReceipt));
        const receiptImage = safeExpenseReceiptDataUrl(expense?.receiptImage);
        if (!receiptImage) {
          toast("ไม่พบรูปสลิปนี้ กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
          return;
        }
        $("#receiptViewerImage").src = receiptImage;
        openDialog("#receiptViewerDialog");
        return;
      }
      if (event.target.closest("#removeExpenseReceipt")) {
        const hadNewFile = Boolean(expenseReceiptPreviewUrl);
        clearExpenseReceiptPreview();
        if (editingExpenseId && !hadNewFile) removeEditingExpenseReceipt = true;
        if (hadNewFile) updateExpenseReceiptPreview($("#expenseReceipt"));
        return;
      }
      const editExpenseButton = event.target.closest("[data-edit-expense]");
      if (editExpenseButton) {
        editingExpenseId = editExpenseButton.dataset.editExpense;
        removeEditingExpenseReceipt = false;
        pendingExpenseDeleteId = null;
        renderExpenseDialog();
        $("#expenseForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
        $("#expenseForm [name=\"title\"]")?.focus();
        return;
      }
      if (event.target.closest("[data-cancel-expense-edit]")) {
        editingExpenseId = null;
        removeEditingExpenseReceipt = false;
        renderExpenseDialog();
        return;
      }
      const deleteButton = event.target.closest("[data-delete-expense]");
      if (deleteButton) {
        pendingExpenseDeleteId = deleteButton.dataset.deleteExpense;
        renderExpenseDeleteConfirmation();
        $("[data-confirm-expense-delete]")?.focus();
        return;
      }
      if (event.target.closest("[data-cancel-expense-delete]")) {
        const originalButton = $$("[data-delete-expense]").find(button => button.dataset.deleteExpense === pendingExpenseDeleteId);
        pendingExpenseDeleteId = null;
        renderExpenseDeleteConfirmation();
        originalButton?.focus();
        return;
      }
      if (event.target.closest("[data-confirm-expense-delete]")) {
        void deleteTripExpense(pendingExpenseDeleteId);
        return;
      }
      if (event.target.closest("[data-copy-expense-summary]")) void copyExpenseSummary();
    });
    expenseDialog.addEventListener("close", () => {
      activeExpenseTripId = null;
      pendingExpenseDeleteId = null;
      editingExpenseId = null;
      removeEditingExpenseReceipt = false;
      clearExpenseReceiptPreview();
      $("#expenseContent").replaceChildren();
    });
    $("#receiptViewerDialog").addEventListener("close", () => {
      $("#receiptViewerImage").removeAttribute("src");
    });

    $("#reviewSearch").addEventListener("input", filterReviews);
    $("#reviewSort").addEventListener("change", filterReviews);
    $("#reviewPhoto").addEventListener("change", updateReviewPhotoPreview);
    $("#removeReviewPhoto").addEventListener("click", clearReviewPhotoPreview);

    $("#configureGoogleMaps").addEventListener("click", openGoogleMapsSettings);
    $("#configureGoogleMapsFromCard").addEventListener("click", openGoogleMapsSettings);
    $("#googleMapsKeyForm").addEventListener("submit", saveGoogleMapsApiKey);
    $("#showGoogleMapsApiKey").addEventListener("change", event => {
      $("#googleMapsApiKey").type = event.target.checked ? "text" : "password";
    });
    $("#removeGoogleMapsKey").addEventListener("click", removeGoogleMapsApiKey);
    $("#nearbyResultList").addEventListener("click", event => {
      const button = event.target.closest("[data-nearby-query]");
      if (!button || !nearbyLocation) return;
      showGoogleNearbyMap(button.dataset.nearbyQuery, nearbyLocation);
    });
    $("#nearbySearch").addEventListener("click", handleNearbySearch);

    $("#reviewGrid").addEventListener("click", event => {
      const card = event.target.closest(".review-card");
      if (card) openReviewDetails(card);
    });

    $("#reviewGrid").addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".review-card");
      if (!card) return;

      event.preventDefault();
      openReviewDetails(card);
    });

    $("#reviewDetailContent").addEventListener("click", event => {
      const button = event.target.closest("[data-delete-review]");
      if (button) openDeleteReviewDialog(button.dataset.deleteReview);
    });

    $("#confirmDeleteReview").addEventListener("click", deleteOwnReview);

    $("#signupForm").addEventListener("submit", signup);
    $("#loginForm").addEventListener("submit", login);
    $("#reviewForm").addEventListener("submit", submitReview);
  }

  // ---------- Load saved data ----------

  function initializePlannerFromTrips() {
    const params = new URLSearchParams(window.location.search);
    const requestedTrip = params.get("trip");
    if (requestedTrip && trips.some(trip => trip.id === requestedTrip)) {
      loadTrip(requestedTrip);
    } else if (params.get("destination")) {
      setDestinationValue(params.get("destination"));
      updateSummary();
      renderFriends();
    } else if (params.get("new") !== "1" && trips.length) {
      const latest = [...trips].sort(
        (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
      )[0];
      if (latest) loadTrip(latest.id);
    } else {
      updateSummary();
      renderFriends();
    }
  }

  function loadInitialData() {
    const storedTrips = readData(KEYS.trips, []);
    trips = cloudConfigured ? [] : (Array.isArray(storedTrips) ? storedTrips : []);

    // รองรับข้อมูลจากคีย์เก่าของ Tripmate
    if (!cloudConfigured && !trips.length) {
      const oldTrip = readData("tripmate-plan", null);

      if (oldTrip && typeof oldTrip === "object" &&
          (oldTrip.destination || oldTrip.startDate)) {
        trips = [{
          ...oldTrip,
          id: `migrated-${Date.now()}`,
          updatedAt: Date.now()
        }];

        saveData(KEYS.trips, trips);
      }
    }

    const storedReviews = readData(KEYS.reviews, []);
    reviews = cloudConfigured ? [] : (Array.isArray(storedReviews) ? storedReviews : []);

    // รีวิวจากรุ่นก่อนยังไม่มีข้อมูลเจ้าของ จึงผูกกับบัญชี/เบราว์เซอร์ที่เปิดเว็บนี้
    let ownershipUpdated = false;
    const hasLegacyReviews = !cloudConfigured && reviews.some(review =>
      review && typeof review === "object" && review.id && !review.ownerId
    );
    const currentOwnerId = hasLegacyReviews ? getCurrentReviewOwnerId() : "";
    reviews = reviews.map(review => {
      if (review && typeof review === "object" && review.id && !review.ownerId) {
        ownershipUpdated = true;
        return { ...review, ownerId: currentOwnerId };
      }

      return review;
    });
    if (!cloudConfigured && ownershipUpdated) saveData(KEYS.reviews, reviews);

    renderSavedTrips();
    renderReviews();
    initializePlannerFromTrips();
    updateAccountUI();
    if (!cloudConfigured) showPendingTripSaveNotice();
  }

  // ---------- Start application ----------

  populateDestinationOptions();
  populateDiscoverProvinceOptions();
  initTheme();
  initEvents();
  initTripSharingEvents();
  updateGoogleMapsKeyLabels();
  loadInitialData();
  void initializeCloudAuth();
  if (currentPage === "join" && !cloudConfigured) void loadTripInvitation();
})();
