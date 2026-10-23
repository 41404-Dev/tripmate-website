
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE_TITLES = {
    home: "หน้าแรก",
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
    premiumDemo: "tripmate-premium-demo",
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

  let friends = [];
  let trips = [];
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
  let selectedNearbyQuery = "สถานที่ท่องเที่ยว";
  let smartPlan = null;
  let isPremiumDemo = false;

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

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
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
    toast("เชื่อมต่อข้อมูลไม่สำเร็จ ตรวจสอบว่ารัน supabase-setup.sql แล้ว");
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
    const { data, error } = await supabaseClient
      .from("trips")
      .select("id, data, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    let rows = data || [];
    const migrationStatus = readData(KEYS.legacyTripMigration, null);
    if (!rows.length && !migrationStatus && migrationPromptedUserId !== user.id) {
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

    return rows.map(row => ({
      ...(row.data && typeof row.data === "object" ? row.data : {}),
      id: String(row.id),
      updatedAt: Date.parse(row.updated_at || row.created_at || "") ||
        Number(row.data?.updatedAt) || Date.now()
    }));
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
    { name: "สถานที่ท่องเที่ยว", description: "แหล่งท่องเที่ยวและสถานที่น่าสนใจ", icon: "📍", query: "สถานที่ท่องเที่ยว" },
    { name: "วัดและสถานที่ประวัติศาสตร์", description: "วัด โบราณสถาน และแหล่งเรียนรู้", icon: "🛕", query: "วัดและสถานที่ประวัติศาสตร์" },
    { name: "ธรรมชาติและจุดชมวิว", description: "สวน น้ำตก ชายหาด และจุดชมวิว", icon: "🌿", query: "ธรรมชาติ น้ำตก ชายหาด จุดชมวิว" },
    { name: "พิพิธภัณฑ์และหอศิลป์", description: "พิพิธภัณฑ์ แกลเลอรี และนิทรรศการ", icon: "🏛️", query: "พิพิธภัณฑ์และหอศิลป์" }
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
    const params = new URLSearchParams({
      api: "1",
      query: `${query} near ${location.latitude},${location.longitude}`
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  function buildGoogleMapsEmbedUrl(query, location) {
    const params = new URLSearchParams({
      key: getGoogleMapsApiKey(),
      q: `${query} near ${location.latitude},${location.longitude}`
    });
    return `https://www.google.com/maps/embed/v1/search?${params.toString()}`;
  }

  function showGoogleNearbyMap(query, location) {
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
  }

  function renderGoogleNearbySearches(location, query = "สถานที่ท่องเที่ยว") {
    $("#nearbyResultList").innerHTML = NEARBY_CATEGORIES.map(category => `
      <article class="nearby-place">
        <span class="nearby-place-icon" aria-hidden="true">${category.icon}</span>
        <span class="nearby-place-copy"><strong>${category.name}</strong><small>${category.description}</small></span>
        <button class="nearby-directions" type="button" data-nearby-query="${escapeHTML(category.query)}" aria-pressed="false">แสดง</button>
      </article>
    `).join("");
    showGoogleNearbyMap(query, location);
    $("#nearbyStatus").textContent = "เลือกหมวดหมู่เพื่อค้นหาสถานที่รอบตำแหน่งของคุณ หรือเปิดผลลัพธ์บน Google Maps";
    setNearbySearchButton(false, "อัปเดตตำแหน่ง");
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

    setNearbySearchButton(true, "กำลังระบุตำแหน่ง...");
    $("#nearbyStatus").textContent = "กำลังขออนุญาตใช้ตำแหน่งจากเบราว์เซอร์ของคุณ";
    navigator.geolocation.getCurrentPosition(position => {
      nearbyLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      renderGoogleNearbySearches(nearbyLocation);
    }, error => {
      const messages = {
        1: "ยังไม่ได้รับอนุญาตใช้ตำแหน่ง โปรดอนุญาตตำแหน่งในเบราว์เซอร์แล้วลองอีกครั้ง",
        2: "ระบุตำแหน่งปัจจุบันไม่ได้ โปรดเปิดบริการตำแหน่งของอุปกรณ์แล้วลองอีกครั้ง",
        3: "ระบุตำแหน่งนานเกินไป โปรดลองค้นหาอีกครั้ง"
      };
      const message = messages[error.code] || "เกิดปัญหาในการระบุตำแหน่ง โปรดลองอีกครั้ง";
      $("#nearbyStatus").textContent = message;
      setNearbySearchButton(false, nearbyLocation ? "อัปเดตตำแหน่ง" : "ค้นหาจากตำแหน่งของฉัน");
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 18000
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

  function clearSmartTripPlan() {
    smartPlan = null;
    const result = $("#smartTripResult");
    if (!result) return;
    result.hidden = true;
    result.innerHTML = "";
  }

  function updatePremiumUI() {
    const button = $("#generateSmartTrip");
    const badge = $("#smartPremiumBadge");
    const hint = $("#smartPremiumHint");
    if (!button || !badge || !hint) return;

    button.textContent = isPremiumDemo ? "✦ จัดทริปตามงบ" : "🔒 สมัคร Premium";
    badge.textContent = isPremiumDemo ? "DEMO ACTIVE" : "PREMIUM";
    badge.classList.toggle("active", isPremiumDemo);
    hint.textContent = isPremiumDemo
      ? "เปิดสิทธิ์ Premium โหมดเดโมแล้ว · เลือกสไตล์ จังหวะเที่ยว และแนวที่สนใจได้"
      : "ฟีเจอร์ Premium · ใช้จังหวัด วันเดินทาง จำนวนคน งบ และรูปแบบเที่ยวที่คุณเลือก";

    const unlockButton = $("#premiumDemoUnlock");
    const disableButton = $("#disablePremiumDemo");
    const paymentNotice = $("#premiumPaymentNotice");
    if (unlockButton) unlockButton.hidden = isPremiumDemo;
    if (disableButton) disableButton.hidden = !isPremiumDemo;
    if (paymentNotice && isPremiumDemo) {
      paymentNotice.textContent = "กำลังใช้สิทธิ์ Premium โหมดเดโมในเบราว์เซอร์นี้ ยังไม่มีการสมัครหรือเรียกเก็บเงินจริง";
    } else if (paymentNotice) {
      paymentNotice.textContent = "ระบบสมัครสมาชิกและชำระเงินจริงยังไม่เชื่อมต่อ ปุ่มด้านล่างเป็นโหมดเดโมและไม่มีการเรียกเก็บเงิน";
    }
  }

  function openPremiumDialog() {
    updatePremiumUI();
    openDialog("#premiumDialog");
  }

  function enablePremiumDemo() {
    isPremiumDemo = true;
    saveData(KEYS.premiumDemo, true);
    updatePremiumUI();
    closeDialog($("#premiumDialog"));
    toast("เปิด Premium โหมดเดโมแล้ว · ไม่มีการชำระเงินจริง");
  }

  function disablePremiumDemo() {
    isPremiumDemo = false;
    saveData(KEYS.premiumDemo, false);
    updatePremiumUI();
    renderSmartTripPlan(smartPlan);
    toast("ปิดสิทธิ์ Premium โหมดเดโมแล้ว");
  }

  function smartBudgetBaseShares(style, days) {
    const profiles = {
      budget: days === 1 ? [31, 42, 0, 27] : [25, 33, 27, 15],
      balanced: days === 1 ? [32, 40, 0, 28] : [24, 32, 30, 14],
      comfort: days === 1 ? [29, 39, 0, 32] : [22, 29, 37, 12]
    };
    return [...(profiles[style] || profiles.balanced)];
  }

  function allocateBudget(amount, shares) {
    const totalShare = shares.reduce((sum, share) => sum + share, 0) || 1;
    const amounts = shares.map(() => 0);
    const activeIndices = shares
      .map((share, index) => share > 0 ? index : -1)
      .filter(index => index >= 0);
    let allocated = 0;

    shares.forEach((share, index) => {
      if (share <= 0) return;
      const value = index === activeIndices[activeIndices.length - 1]
        ? amount - allocated
        : Math.floor(amount * share / totalShare);
      amounts[index] = value;
      allocated += value;
    });

    return amounts;
  }

  function smartMapSearch(query, destination) {
    const search = `${query} ${destination}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(search)}`;
  }

  const SMART_INTERESTS = {
    culture: {
      label: "วัฒนธรรม",
      icon: "🏛️",
      options: [
        { title: "เริ่มวันด้วยวัดหรือสถานที่ประวัติศาสตร์", query: "วัดและสถานที่ประวัติศาสตร์" },
        { title: "แวะพิพิธภัณฑ์หรือแหล่งเรียนรู้ของจังหวัด", query: "พิพิธภัณฑ์และแหล่งเรียนรู้" },
        { title: "เดินสำรวจย่านเก่าและสถาปัตยกรรมท้องถิ่น", query: "ย่านเมืองเก่า สถาปัตยกรรม" }
      ]
    },
    nature: {
      label: "ธรรมชาติ",
      icon: "🌿",
      options: [
        { title: "เลือกจุดชมวิวหรือเส้นทางธรรมชาติใกล้กัน", query: "จุดชมวิว เส้นทางธรรมชาติ" },
        { title: "พักผ่อนที่สวน น้ำตก หรือพื้นที่สีเขียว", query: "สวนสาธารณะ น้ำตก ธรรมชาติ" },
        { title: "วางจุดแวะกลางแจ้งโดยเผื่อเวลาเดินทาง", query: "อุทยาน จุดชมวิว ที่เที่ยวธรรมชาติ" }
      ]
    },
    food: {
      label: "ของกิน",
      icon: "🍜",
      options: [
        { title: "ชิมอาหารท้องถิ่นในย่านที่เดินทางสะดวก", query: "อาหารท้องถิ่น" },
        { title: "เดินตลาดเพื่อเลือกมื้ออาหารตามงบ", query: "ตลาดท้องถิ่น ของกิน" },
        { title: "ลองร้านอาหารที่ตรงกับรูปแบบอาหารที่เลือก", query: "ร้านอาหาร" }
      ]
    },
    cafe: {
      label: "คาเฟ่",
      icon: "☕",
      options: [
        { title: "พักคาเฟ่ใกล้เส้นทางเที่ยวหลัก", query: "คาเฟ่ใกล้สถานที่ท่องเที่ยว" },
        { title: "เลือกคาเฟ่ท้องถิ่นเป็นจุดพักระหว่างวัน", query: "คาเฟ่ท้องถิ่น" },
        { title: "แวะร้านกาแฟและเผื่อเวลาพักก่อนเดินทางต่อ", query: "ร้านกาแฟ คาเฟ่" }
      ]
    },
    adventure: {
      label: "กิจกรรม",
      icon: "🧗",
      options: [
        { title: "เลือกกิจกรรมกลางแจ้งที่เหมาะกับเวลาและงบ", query: "กิจกรรมกลางแจ้ง ผจญภัย" },
        { title: "ค้นหากิจกรรมในพื้นที่และตรวจสอบการจองล่วงหน้า", query: "กิจกรรมท่องเที่ยว จอง" },
        { title: "จัดกิจกรรมหลักหนึ่งอย่างแล้วเว้นเวลาพัก", query: "กิจกรรมท่องเที่ยวในจังหวัด" }
      ]
    },
    shopping: {
      label: "ตลาด/ช้อปปิ้ง",
      icon: "🛍️",
      options: [
        { title: "เดินตลาดชุมชนและลองของกินระหว่างทาง", query: "ตลาดชุมชน" },
        { title: "แวะย่านของฝากโดยกำหนดงบซื้อของไว้ก่อน", query: "ร้านของฝาก ตลาดท้องถิ่น" },
        { title: "เลือกถนนคนเดินหรือตลาดตามวันเปิดทำการ", query: "ถนนคนเดิน ตลาดนัด" }
      ]
    },
    beach: {
      label: "ทะเล",
      icon: "🏖️",
      options: [
        { title: "จัดช่วงพักริมทะเลและเช็กสภาพอากาศก่อนเดินทาง", query: "ชายหาด ทะเล" },
        { title: "ค้นหาจุดชมวิวชายฝั่งที่อยู่ในเส้นทางเดียวกัน", query: "จุดชมวิวชายทะเล" },
        { title: "เลือกกิจกรรมทะเลและตรวจสอบราคา/เงื่อนไขก่อนจอง", query: "กิจกรรมทางทะเล" }
      ]
    }
  };

  function getSelectedSmartInterests() {
    return $$('input[name="smartInterest"]:checked')
      .map(input => input.value)
      .filter(value => Object.prototype.hasOwnProperty.call(SMART_INTERESTS, value));
  }

  function smartBudgetShares(style, days, transportMode, stayMode) {
    const shares = smartBudgetBaseShares(style, days);
    const transfer = (from, to, amount) => {
      const moved = Math.min(shares[from], amount);
      shares[from] -= moved;
      shares[to] += moved;
    };

    const transportAdjustments = {
      "เครื่องบิน": 10,
      "รถยนต์ส่วนตัว": 6,
      "เรือ": 6,
      "รถไฟ": 3,
      "รถโดยสาร": -3
    };
    const transportShift = transportAdjustments[transportMode] || 0;
    if (transportShift > 0) transfer(3, 0, transportShift);
    if (transportShift < 0) transfer(0, 3, Math.abs(transportShift));

    if (days > 1 && stayMode === "แคมป์ปิ้ง") transfer(2, 3, 8);
    if (days > 1 && stayMode === "โฮมสเตย์") transfer(2, 1, 4);
    if (days > 1 && stayMode === "รีสอร์ต") transfer(3, 2, 8);

    return shares;
  }

  function createSmartActivity(category, day, slot, foodType) {
    const interest = SMART_INTERESTS[category] || SMART_INTERESTS.food;
    const option = interest.options[(day + slot - 1) % interest.options.length];
    const foodQuery = foodType && foodType !== "กินได้ทุกอย่าง"
      ? `${foodType} ${option.query}`
      : option.query;

    return {
      category,
      label: interest.label,
      icon: interest.icon,
      title: option.title,
      query: category === "food" ? foodQuery : option.query
    };
  }

  function buildSmartDailyBudgets(plan) {
    const days = Math.max(1, Math.min(30, Number(plan.days) || 1));
    const evenWeights = Array(days).fill(1);
    const travelWeights = [...evenWeights];
    if (days > 1) {
      travelWeights[0] = 1.35;
      travelWeights[days - 1] = 1.2;
    }
    const nightWeights = Array.from({ length: days }, (_, index) =>
      index < days - 1 ? 1 : 0
    );
    const transportByDay = allocateBudget(Number(plan.transport) || 0, travelWeights);
    const foodByDay = allocateBudget(Number(plan.food) || 0, evenWeights);
    const stayByDay = allocateBudget(Number(plan.stay) || 0, nightWeights);
    const otherByDay = allocateBudget(Number(plan.other) || 0, evenWeights);

    return Array.from({ length: days }, (_, index) => {
      const day = {
        transport: transportByDay[index],
        food: foodByDay[index],
        stay: stayByDay[index],
        other: otherByDay[index]
      };
      day.total = day.transport + day.food + day.stay + day.other;
      return day;
    });
  }

  function buildSmartDayPlans(plan) {
    const days = Math.max(1, Math.min(30, Number(plan.days) || 1));
    const interests = Array.isArray(plan.interests) && plan.interests.length
      ? plan.interests
      : getSelectedSmartInterests();
    const nonFoodInterests = interests.filter(interest => interest !== "food");
    const activityCounts = { relaxed: 2, balanced: 3, packed: 4 };
    const activityCount = activityCounts[plan.pace] || activityCounts.balanced;
    const times = {
      2: ["09:00", "17:30"],
      3: ["09:00", "13:30", "17:30"],
      4: ["08:30", "11:30", "14:30", "18:00"]
    }[activityCount];
    const dailyBudgets = Array.isArray(plan.dailyBudgets)
      ? plan.dailyBudgets
      : buildSmartDailyBudgets(plan);

    return Array.from({ length: days }, (_, index) => {
      const day = index + 1;
      const activities = Array.from({ length: activityCount }, (_, slot) => {
        let category;
        if (slot === activityCount - 1) {
          category = "food";
        } else if (nonFoodInterests.length) {
          category = nonFoodInterests[(day + slot - 1) % nonFoodInterests.length];
        } else {
          category = interests[(day + slot - 1) % interests.length] || "food";
        }
        return {
          time: times[slot],
          ...createSmartActivity(category, day, slot, plan.foodType)
        };
      });

      const date = plan.startDate ? new Date(`${plan.startDate}T00:00:00`) : null;
      if (date && !Number.isNaN(date.getTime())) date.setDate(date.getDate() + index);
      const dateLabel = date && !Number.isNaN(date.getTime())
        ? formatDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`)
        : `วันที่ ${day}`;

      return {
        day,
        dateLabel,
        budget: dailyBudgets[index] || { transport: 0, food: 0, stay: 0, other: 0, total: 0 },
        activities
      };
    });
  }

  function getSmartPlanInsights(plan) {
    const insights = [];
    if (plan.days === 1) {
      insights.push("ทริปวันเดียวไม่กันงบที่พัก เพื่อย้ายงบไปใช้กับการเดินทาง อาหาร และกิจกรรมแทน");
    } else if (plan.stayType === "แคมป์ปิ้ง") {
      insights.push("ลดสัดส่วนที่พักสำหรับแคมป์ปิ้ง และเพิ่มงบกิจกรรม/อุปกรณ์ไว้เผื่อ");
    } else if (plan.stayType === "โฮมสเตย์") {
      insights.push("จัดงบที่พักแบบโฮมสเตย์และเผื่อค่าอาหารท้องถิ่นเพิ่มขึ้น");
    } else {
      insights.push(`จัดสรรค่าที่พักสำหรับ ${plan.days - 1} คืนตามรูปแบบที่เลือก`);
    }

    if (plan.transportType === "เครื่องบิน") {
      insights.push("กันสัดส่วนค่าเดินทางเพิ่มสำหรับการเดินทางด้วยเครื่องบิน และควรเช็กราคารวมสัมภาระก่อนจอง");
    } else if (plan.transportType === "รถยนต์ส่วนตัว") {
      insights.push("รวมงบเดินทางเผื่อน้ำมันและค่าทางด่วน แล้วเช็กระยะทางระหว่างจุดเที่ยวก่อนออกเดินทาง");
    } else {
      insights.push("วางจุดเที่ยวใกล้กันในแต่ละวันเพื่อลดเวลาและค่าเดินทางต่อพื้นที่");
    }

    if (plan.perPersonPerDay < 500) {
      insights.push("งบใช้ต่อคนต่อวันค่อนข้างจำกัด ลองเน้นจุดเข้าฟรีและกำหนดงบอาหารก่อนออกเดินทาง");
    } else if (plan.perPersonPerDay > 2500) {
      insights.push("มีงบต่อคนต่อวันค่อนข้างยืดหยุ่น แนะนำกันเงินสำรองไว้สำหรับกิจกรรมหรือค่าใช้จ่ายหน้างาน");
    } else {
      insights.push("เฉลี่ยงบใช้ต่อคนต่อวันให้แล้ว ปรับราคาและค่าเข้าชมตามข้อมูลจริงก่อนจอง");
    }
    return insights;
  }

  function renderSmartTripPlan(plan) {
    const result = $("#smartTripResult");
    if (!result) return;

    if (!isPremiumDemo) {
      if (plan) {
        result.innerHTML = `
          <div class="premium-locked-preview">
            <span class="premium-lock-icon" aria-hidden="true">🔒</span>
            <div><strong>แผนนี้ใช้ Smart Budget Trip</strong><p>ปลดล็อก Premium เพื่อดูรายละเอียดงบและร่างแผนเที่ยวที่บันทึกไว้</p></div>
            <button class="btn btn-green" type="button" data-open-premium>ดู Premium</button>
          </div>
        `;
        result.hidden = false;
      } else {
        result.hidden = true;
        result.innerHTML = "";
      }
      return;
    }

    if (!plan) return;

    const destination = plan.destination || $("#destination").value.trim();
    const labels = {
      budget: "ประหยัด",
      balanced: "สมดุล",
      comfort: "สะดวกสบาย"
    };
    const paceLabels = {
      relaxed: "สบาย ๆ",
      balanced: "พอดี",
      packed: "เก็บให้ครบ"
    };
    const categories = [
      ["🚆", "ค่าเดินทาง", Number(plan.transport) || 0],
      ["🍜", "ค่าอาหาร", Number(plan.food) || 0],
      ["🛏️", "ค่าที่พัก", Number(plan.stay) || 0],
      ["🎟️", "กิจกรรม/อื่น ๆ", Number(plan.other) || 0]
    ];
    const days = Math.max(1, Math.min(30, Number(plan.days) || 1));
    const people = Math.max(1, Number(plan.people) || getPeopleCount());
    const plannedSpend = Number(plan.plannedSpend) || categories.reduce((sum, [, , value]) => sum + value, 0);
    const budget = Number(plan.budget) || plannedSpend + (Number(plan.reserve) || 0);
    const reserve = Number(plan.reserve) || Math.max(0, budget - plannedSpend);
    const plannedPercentage = budget > 0
      ? Math.min(100, Math.max(0, Math.round(plannedSpend / budget * 100)))
      : 0;
    const perPersonPerDay = Number(plan.perPersonPerDay) || plannedSpend / people / days;
    const interests = Array.isArray(plan.interests) && plan.interests.length
      ? plan.interests
      : getSelectedSmartInterests();
    const selectedInterests = interests.map(value => SMART_INTERESTS[value]?.label).filter(Boolean);
    const dailyPlans = Array.isArray(plan.dailyPlans) && plan.dailyPlans.length
      ? plan.dailyPlans.slice(0, days)
      : buildSmartDayPlans({ ...plan, days, dailyBudgets: plan.dailyBudgets });
    const displayedDays = Math.min(days, 10);
    const daysHtml = dailyPlans.slice(0, displayedDays).map(dayPlan => {
      const dayBudget = dayPlan.budget || {};
      const dailyCategories = [
        ["เดินทาง", Number(dayBudget.transport) || 0],
        ["อาหาร", Number(dayBudget.food) || 0],
        ["ที่พัก", Number(dayBudget.stay) || 0],
        ["กิจกรรม", Number(dayBudget.other) || 0]
      ];
      return `
        <article class="smart-day-card">
          <div class="smart-day-top">
            <div class="smart-day-title"><span>DAY ${String(dayPlan.day).padStart(2, "0")}</span><strong>${escapeHTML(dayPlan.dateLabel || `วันที่ ${dayPlan.day}`)}</strong></div>
            <div class="smart-day-limit"><strong>${money(Number(dayBudget.total) || 0)}</strong><small>งบรวมวันนี้ · ${money((Number(dayBudget.total) || 0) / people)} / คน</small></div>
          </div>
          <div class="smart-day-costs">
            ${dailyCategories.map(([label, value]) => `<span>${label} <b>${money(value)}</b></span>`).join("")}
          </div>
          <div class="smart-day-activities">
            ${(dayPlan.activities || []).map(activity => `
              <div class="smart-day-idea">
                <span>${escapeHTML(activity.time)} · ${escapeHTML(activity.icon || "📍")} ${escapeHTML(activity.label || "กิจกรรม")}</span>
                <p>${escapeHTML(activity.title)}</p>
                <a href="${escapeHTML(smartMapSearch(activity.query, destination))}" target="_blank" rel="noopener noreferrer">ค้นหาใน Google Maps ↗</a>
              </div>
            `).join("")}
          </div>
        </article>
      `;
    }).join("");

    result.innerHTML = `
      <div class="smart-result-header">
        <div><span class="section-kicker">YOUR SMART PLAN</span><h3>แผนเที่ยว ${escapeHTML(destination)} ตามงบ</h3><p>${escapeHTML(formatDate(plan.startDate))} – ${escapeHTML(formatDate(plan.endDate))} · ${days} วัน · ${people} คน</p></div>
        <span class="smart-style-badge">${labels[plan.style] || labels.balanced} · ${paceLabels[plan.pace] || paceLabels.balanced}</span>
      </div>
      <div class="smart-budget-progress">
        <div><span>งบรวมทริป</span><strong>${money(budget)}</strong></div>
        <div class="smart-budget-meter" role="progressbar" aria-label="สัดส่วนงบที่จัดสรร" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${plannedPercentage}"><span style="width:${plannedPercentage}%"></span></div>
        <small>จัดสรรสำหรับทริป ${money(plannedSpend)} · กันเงินสำรอง ${money(reserve)}</small>
      </div>
      <p class="smart-applied-note">✓ ใส่งบแนะนำในช่องค่าใช้จ่ายด้านบนแล้ว ปรับตัวเลขเองได้ก่อนบันทึก</p>
      <div class="smart-budget-stats">
        <div><span>งบที่ใช้ตามแผน</span><strong>${money(plannedSpend)}</strong></div>
        <div><span>เงินสำรอง 10%</span><strong>${money(reserve)}</strong></div>
        <div><span>งบใช้ต่อคน / วัน</span><strong>${money(perPersonPerDay)}</strong></div>
        <div><span>งบรวมเฉลี่ย / คน</span><strong>${money(budget / people)}</strong></div>
      </div>
      <div class="smart-breakdown" aria-label="สัดส่วนงบที่แนะนำ">
        ${categories.map(([icon, label, value]) => {
          const percentage = plannedSpend > 0 ? Math.round(value / plannedSpend * 100) : 0;
          return `
            <div class="smart-budget-row">
              <div class="smart-budget-row-heading"><span>${icon} ${label} <small>${percentage}%</small></span><strong>${money(value)}</strong></div>
              <div class="smart-budget-meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width:${percentage}%"></span></div>
              <small>เฉลี่ย ${money(value / people / days)} ต่อคน / วัน</small>
            </div>
          `;
        }).join("")}
      </div>
      <section class="smart-insights" aria-label="ข้อแนะนำสำหรับทริปนี้">
        <strong>✦ ข้อแนะนำสำหรับทริปนี้</strong>
        <ul>${getSmartPlanInsights({ ...plan, days, perPersonPerDay }).map(insight => `<li>${escapeHTML(insight)}</li>`).join("")}</ul>
      </section>
      <div class="smart-preference-summary"><span>สไตล์ที่เลือก</span><b>${escapeHTML(selectedInterests.join(" · ") || "ยังไม่ได้เลือกแนวเที่ยว")}</b><span>อาหาร: ${escapeHTML(plan.foodType || "ไม่ระบุ")} · ที่พัก: ${escapeHTML(plan.stayType || "ไม่ระบุ")}</span></div>
      <div class="smart-itinerary-heading"><strong>แผนเที่ยวรายวัน</strong><span>${days} วัน · จังหวะ${paceLabels[plan.pace] || paceLabels.balanced}</span></div>
      <div class="smart-itinerary-list">${daysHtml}</div>
      ${days > displayedDays ? `<p class="smart-estimate-note">แสดง ${displayedDays} วันแรก จากทั้งหมด ${days} วัน</p>` : ""}
      <div class="smart-result-footer"><p>ค่าใช้จ่ายเป็นประมาณการ ระบบไม่ได้ดึงราคาจริงหรือยืนยันเวลาเปิดทำการ โปรดตรวจสอบก่อนจอง</p><button class="btn btn-dark" type="button" data-save-smart-trip>บันทึกทริปนี้ ↗</button></div>
    `;
    result.hidden = false;
  }

  function generateSmartTrip() {
    if (!isPremiumDemo) {
      openPremiumDialog();
      return;
    }

    const destination = $("#destination").value.trim();
    const start = $("#startDate").value;
    const end = $("#endDate").value;
    const days = durationDays(start, end);
    const budget = Number($("#budget").value);

    if (!destination) {
      toast("เลือกจังหวัดปลายทางก่อนจัดทริปตามงบ");
      $("#destination").focus();
      return;
    }
    if (days === null) {
      toast("เลือกวันไปและวันกลับให้ถูกต้องก่อนจัดทริป");
      (!start ? $("#startDate") : $("#endDate")).focus();
      return;
    }
    if (!Number.isFinite(budget) || budget <= 0) {
      toast("กรอกงบประมาณรวมเป็นตัวเลขมากกว่า 0");
      $("#budget").focus();
      return;
    }

    const style = $("#smartTripStyle").value;
    const people = getPeopleCount();
    if (days > 30) {
      toast("Smart Budget รองรับการจัดแผนไม่เกิน 30 วันต่อครั้ง");
      return;
    }
    const reserve = Math.round(budget * 0.1);
    const plannedSpend = Math.max(0, budget - reserve);
    const interests = getSelectedSmartInterests();
    if (!interests.length) {
      toast("เลือกแนวเที่ยวอย่างน้อย 1 แบบก่อนสร้างแผน");
      $("input[name='smartInterest']").focus();
      return;
    }

    const shares = smartBudgetShares(
      style,
      days,
      $("#transportType").value,
      $("#stayType").value
    );

    const [transport, food, stay, other] = allocateBudget(plannedSpend, shares);
    $("#transport").value = transport;
    $("#food").value = food;
    $("#stay").value = stay;
    $("#other").value = other;

    smartPlan = {
      style,
      pace: $("#smartTripPace").value,
      interests,
      destination,
      startDate: start,
      endDate: end,
      days,
      people,
      budget,
      reserve,
      plannedSpend,
      perPersonPerDay: plannedSpend / people / days,
      transportType: $("#transportType").value,
      foodType: $("#foodType").value,
      stayType: $("#stayType").value,
      transport,
      food,
      stay,
      other
    };
    smartPlan.dailyBudgets = buildSmartDailyBudgets(smartPlan);
    smartPlan.dailyPlans = buildSmartDayPlans(smartPlan);
    updateSummary();
    renderSmartTripPlan(smartPlan);
    $("#smartTripResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
    toast("จัดสรรงบและร่างแผนเที่ยวให้แล้ว");
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
    if (destination && duration !== null && friends.length > 0) step = 4;

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
          <small>${friend.going ? "ยืนยันร่วมทริป" : "ยังไม่ยืนยัน"}</small>
        </div>

        <label class="friend-confirm">
          <input
            type="checkbox"
            data-friend-going="${index}"
            ${friend.going ? "checked" : ""}
          >
          ไปแน่
        </label>

        <button
          type="button"
          class="remove-friend"
          data-remove-friend="${index}"
          aria-label="ลบเพื่อน"
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
    clearSmartTripPlan();

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

    return {
      id: editingTripId || (
        globalThis.crypto?.randomUUID?.() ||
        `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ),
      destination: $("#destination").value.trim(),
      startDate: $("#startDate").value,
      endDate: $("#endDate").value,
      friends: friends.map(friend => ({
        name: friend.name,
        going: friend.going
      })),
      budget: costs.budget,
      transport: costs.transport,
      food: costs.food,
      stay: costs.stay,
      other: costs.other,
      transportType: $("#transportType").value,
      foodType: $("#foodType").value,
      stayType: $("#stayType").value,
      smartPlan: isPremiumDemo && smartPlan ? { ...smartPlan } : null,
      updatedAt: Date.now()
    };
  }

  async function saveTrip() {
    if (!validatePlanner()) return;
    if (cloudConfigured && !requireCloudAccount()) return;

    const trip = collectTrip();
    const index = trips.findIndex(item => item.id === trip.id);
    const nextTrips = index >= 0
      ? trips.map(item => item.id === trip.id ? trip : item)
      : [trip, ...trips];

    if (cloudConfigured) {
      const timestamp = new Date(trip.updatedAt).toISOString();
      const { error } = await supabaseClient.from("trips").upsert({
        id: String(trip.id),
        user_id: currentUser.id,
        data: trip,
        updated_at: timestamp
      }, { onConflict: "user_id,id" });
      if (error) {
        showDatabaseSetupError(error);
        return;
      }
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
  }

  function resetPlanner() {
    editingTripId = null;
    clearSmartTripPlan();
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
    smartPlan = trip.smartPlan && typeof trip.smartPlan === "object"
      ? { ...trip.smartPlan }
      : null;
    $("#smartTripStyle").value = smartPlan?.style || "balanced";
    $("#smartTripPace").value = smartPlan?.pace || "balanced";
    if (Array.isArray(smartPlan?.interests)) {
      $$('input[name="smartInterest"]').forEach(input => {
        input.checked = smartPlan.interests.includes(input.value);
      });
    }

    friends = Array.isArray(trip.friends)
      ? trip.friends.map(friend => {
          if (typeof friend === "string") {
            return { name: friend, going: true };
          }

          return {
            name: String(friend.name || ""),
            going: friend.going !== false
          };
        }).filter(friend => friend.name)
      : [];

    $("#saveMessage").textContent = isSavedTrip
      ? `กำลังแก้ไขทริป: ${trip.destination}`
      : "ข้อมูลทริปพร้อมแล้ว กดบันทึกเพื่อเก็บไว้ในบัญชี";

    renderFriends();
    updateSummary();
    renderSmartTripPlan(smartPlan);
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

      return `
        <article class="saved-trip-card">
          <div class="section-kicker">TRIP PLAN</div>
          <h3>${escapeHTML(trip.destination || "ทริปใหม่")}</h3>
          <p>${escapeHTML(formatDate(trip.startDate))} – ${escapeHTML(formatDate(trip.endDate))}</p>
          <p>${days ? `${days} วัน` : "ยังไม่ระบุระยะเวลา"} · ${people} คน</p>
          <p>การเดินทาง: ${escapeHTML(trip.transportType || "ไม่ระบุ")}</p>
          <div class="trip-total">${money(total)}</div>
          <p>งบประมาณ ${money(trip.budget || 0)}</p>
          ${trip.smartPlan ? `<p class="saved-smart-badge">${isPremiumDemo ? `✦ วางแผนด้วย Smart Budget · เงินสำรอง ${money(trip.smartPlan.reserve || 0)}` : "🔒 มีแผน Smart Budget Premium"}</p>` : ""}
          <div class="saved-trip-actions">
            <button type="button" data-edit-trip="${escapeHTML(trip.id)}">แก้ไขทริป</button>
            <button type="button" data-delete-trip="${escapeHTML(trip.id)}">ลบทริป</button>
          </div>
        </article>
      `;
    }).join("");
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

    if (isPremiumDemo && smartPlan) {
      text += `\nSmart Budget: ${money(smartPlan.plannedSpend)} สำหรับแผนใช้จ่าย · สำรอง ${money(smartPlan.reserve)}`;
    }

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
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`
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

      clearSmartTripPlan();
      friends[index].going = input.checked;
      renderFriends();
    });

    $("#friendList").addEventListener("click", event => {
      const button = event.target.closest("[data-remove-friend]");
      if (!button) return;

      clearSmartTripPlan();
      friends.splice(Number(button.dataset.removeFriend), 1);
      renderFriends();
    });

    $$("[data-destination]").forEach(button => {
      button.addEventListener("click", () => {
        clearSmartTripPlan();
        $("#destination").value = button.dataset.destination;
        updateSummary();
      });
    });

    $("#suggestDestination").addEventListener("click", () => {
      clearSmartTripPlan();
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
        clearSmartTripPlan();
        updateSummary();
      };
      $(selector).addEventListener("input", refreshPlanner);
      $(selector).addEventListener("change", refreshPlanner);
    });

    $("#smartTripStyle").addEventListener("change", clearSmartTripPlan);
    $("#smartTripPace").addEventListener("change", clearSmartTripPlan);
    $$('input[name="smartInterest"]').forEach(input => {
      input.addEventListener("change", event => {
        const selected = getSelectedSmartInterests();
        if (event.target.checked && selected.length > 3) {
          event.target.checked = false;
          toast("เลือกแนวเที่ยวได้สูงสุด 3 แบบ");
          return;
        }
        clearSmartTripPlan();
      });
    });
    $("#generateSmartTrip").addEventListener("click", generateSmartTrip);
    $("#smartTripResult").addEventListener("click", event => {
      if (event.target.closest("[data-open-premium]")) openPremiumDialog();
      if (event.target.closest("[data-save-smart-trip]")) void saveTrip();
    });
    $("#premiumDemoUnlock").addEventListener("click", enablePremiumDemo);
    $("#disablePremiumDemo").addEventListener("click", disablePremiumDemo);
    $("#saveTrip").addEventListener("click", saveTrip);
    $("#copySummary").addEventListener("click", copySummary);

    $("#savedTripGrid").addEventListener("click", async event => {
      const editButton = event.target.closest("[data-edit-trip]");
      const deleteButton = event.target.closest("[data-delete-trip]");

      if (editButton) {
        navigateToPage("planner", { trip: editButton.dataset.editTrip });
        return;
      }

      if (deleteButton) {
        const id = deleteButton.dataset.deleteTrip;
        const trip = trips.find(item => item.id === id);

        if (!trip) return;

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
    isPremiumDemo = readData(KEYS.premiumDemo, false) === true;
    updatePremiumUI();

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
  initTheme();
  initEvents();
  updateGoogleMapsKeyLabels();
  loadInitialData();
  void initializeCloudAuth();
})();
