import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────────────────────────────────────
// SEED COOKIES  (grabbed from your real browser session)
// WHY: The listing endpoint (/restaurants/list) works with just a fresh
//      homepage visit.  The menu endpoint (/menu/pl) requires a real session:
//      _sid, _guest_tid, aws-waf-token, tid, deviceId, lat/lng etc.
//      Auto-fetching swiggy.com/ only gives us lightweight cookies; it does
//      NOT give us aws-waf-token or _sid, so the menu call gets blocked.
//
// HOW TO REFRESH: Open swiggy.com in Chrome → F12 → Application → Cookies
//   Copy every cookie as  name=value  separated by "; "
//   Replace the string below and redeploy.
//   These typically last 7–30 days.
// ─────────────────────────────────────────────────────────────────────────────
const SEED_COOKIES = [
  `__SW=HI-TVNpWpxWCox_zE_qivMZVLyhxnnuQ`,
  `_device_id=99c7435b-953b-51fa-de13-38e4297df740`,
  `_guest_tid=4d23ea2b-fe75-458a-b6d3-073854bb57ea`,
  `_is_logged_in=`,
  `_sid=qdxc515b728-09f3-4979-a0eb-e8efb5ca1`,
  `address=s:.4Wx2Am9WLolnmzVcU32g6YaFDw0QbIBFRj2nkO7P25s`,
  `addressId=s:.4Wx2Am9WLolnmzVcU32g6YaFDw0QbIBFRj2nkO7P25s`,
  `ally-on=false`,
  `aws-waf-token=bb37aed2-240b-48b7-a39a-3da8b5219c16:NQoAjfN0ZG0SAAAA:0zDOq9+dKpNYDIIisCp3pMnCb6cHw8FR/1Y3Abqw3OfQbMSeE2vta7gXjh9nYSwTp7kq5UxeexPNhtdeVaKP3nA3OQbZ4SYAEvv7dhARzJUjQFDL6cYQoEyDo42XkJtAgx4l/IwkVo8GzaFdX9ufyLQgAcBR6Wh2FgFalPUepsFocoDyMffWngNYwjU9j/k=`,
  `bottomOffset=0`,
  `dadl=true`,
  `deviceId=s:d3fdfb95-f9b9-49cc-ad2f-b7926241cc30.pS3X3oClHILR/RM6rWwr4PUfjnX0Cuk1bwKEuPZRaqw`,
  `fontsLoaded=1`,
  `genieTrackOn=false`,
  `isNative=false`,
  `lat=s:28.5625376.cWz978+WStHtMWP2wQoVjXR2ypRstIr7WTy0RUuoCQw`,
  `lng=s:77.21151231.s2pT+zvMjcMk3WAcSt7ICqtj29LqMbW4x3bw5yiZ950`,
  `openIMHP=false`,
  `platform=web`,
  `statusBarHeight=0`,
  `strId=`,
  `subplatform=dweb`,
  `tid=s:ec0fde04-a6c2-4bea-963e-88d706f67bc6.ukLjbWscnVlbN4+pQclAftpuYLCzTJaPIoBCzoBcYwQ`,
  `userLocation={"lat":26.7619079,"lng":94.2110386,"address":"Q666+QC7, Chowk Bazaar Rd, New Colony, Jorhat, Dulia Gaon, Assam 785001, India","area":"","showUserDefaultAddressHint":false}`,
  `versionCode=1200`,
  `webBottomBarHeight=0`,
].join("; ");

// ─────────────────────────────────────────────────────────────────────────────
// Cookie store — starts with seed, gets updated by Swiggy's Set-Cookie replies
// ─────────────────────────────────────────────────────────────────────────────
let cookieStore = parseCookieString(SEED_COOKIES);
let cookiesFetchedAt = Date.now(); // seed counts as "just fetched"
const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 min before re-fetching homepage

/** Parse "k=v; k2=v2" into a Map */
function parseCookieString(str) {
  const map = new Map();
  for (const pair of str.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
}

/** Merge a Set-Cookie array into the store (existing keys get updated) */
function mergeSetCookies(setCookieArray) {
  for (const raw of setCookieArray) {
    const pair = raw.split(";")[0]; // drop path/domain/expires
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookieStore.set(key, val);
  }
}

/** Serialise the store back to "k=v; k2=v2" */
function serialiseCookies() {
  return [...cookieStore.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Background session refresher — tops up lightweight cookies from homepage
// NOTE: this will NOT replace aws-waf-token or _sid (Swiggy doesn't send
//       those on a plain homepage hit).  The seed above covers those.
// ─────────────────────────────────────────────────────────────────────────────
const refreshHomepageCookies = async () => {
  const now = Date.now();
  if (now - cookiesFetchedAt < COOKIE_TTL_MS) return;

  try {
    const res = await fetch("https://www.swiggy.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        // Send existing cookies so Swiggy can rotate them gracefully
        Cookie: serialiseCookies(),
      },
    });

    const raw = res.headers.getSetCookie?.() ?? [];
    if (raw.length > 0) {
      mergeSetCookies(raw); // MERGE, don't overwrite — preserves _sid / waf token
      cookiesFetchedAt = now;
      console.log(`[Session] Homepage cookies merged (${raw.length} updated).`);
    }
  } catch (err) {
    console.error("[Session] Homepage refresh failed:", err.message);
  }
};

// Run once at startup, then every 25 min
refreshHomepageCookies();
setInterval(refreshHomepageCookies, 25 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Express setup
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({ origin: "*" }));

app.use(
  "/api/proxy/swiggy/dapi",
  createProxyMiddleware({
    target: "https://www.swiggy.com",
    changeOrigin: true,
    pathRewrite: { "^/api/proxy/swiggy/dapi": "/dapi" },
    on: {
      proxyReq: async (proxyReq, req) => {
        // Refresh homepage cookies if stale (non-blocking — already recent enough most of the time)
        await refreshHomepageCookies();

        const cookies = serialiseCookies();

        proxyReq.setHeader("Cookie", cookies);
        proxyReq.setHeader(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        );
        proxyReq.setHeader("Referer", "https://www.swiggy.com/");
        proxyReq.setHeader("Origin", "https://www.swiggy.com");
        proxyReq.setHeader("Accept", "application/json, text/plain, */*");
        proxyReq.setHeader("Accept-Language", "en-GB,en;q=0.9");
        proxyReq.setHeader(
          "sec-ch-ua",
          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        );
        proxyReq.setHeader("sec-ch-ua-mobile", "?0");
        proxyReq.setHeader("sec-ch-ua-platform", '"Windows"');
        proxyReq.setHeader("Sec-Fetch-Dest", "empty");
        proxyReq.setHeader("Sec-Fetch-Mode", "cors");
        proxyReq.setHeader("Sec-Fetch-Site", "same-origin");

        console.log(`[Proxy] → ${req.method} ${req.url}`);
      },

      proxyRes: (proxyRes, req) => {
        if (proxyRes.statusCode !== 200) {
          console.error(
            `[Proxy] ✗ Swiggy ${proxyRes.statusCode} for ${req.url}`,
          );
        } else {
          console.log(`[Proxy] ✓ Swiggy 200 for ${req.url}`);
        }

        // Strip Swiggy's own CORS headers — ours (set by cors()) must win
        delete proxyRes.headers["access-control-allow-origin"];
        delete proxyRes.headers["access-control-allow-credentials"];
        delete proxyRes.headers["access-control-allow-methods"];
        delete proxyRes.headers["access-control-allow-headers"];

        // MERGE any rotated cookies back into the store
        const newCookies = proxyRes.headers["set-cookie"];
        if (newCookies?.length > 0) {
          mergeSetCookies(newCookies);
          cookiesFetchedAt = Date.now();
          console.log(
            `[Session] ${newCookies.length} cookie(s) rotated by Swiggy.`,
          );
        }
      },

      error: (err, req, res) => {
        console.error("[Proxy] Unhandled proxy error:", err.message);
        res.status(502).json({ error: "Proxy error", detail: err.message });
      },
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    cookieCount: cookieStore.size,
    cookiesAgeMs: Date.now() - cookiesFetchedAt,
    hasSid: cookieStore.has("_sid"),
    hasWafToken: cookieStore.has("aws-waf-token"),
  });
});

app.get("/", (_req, res) => {
  res.send("<h1>FoodSheer Proxy — running ✓</h1>");
});

app.listen(PORT, () => {
  console.log(`[Server] FoodSheer proxy on http://localhost:${PORT}`);
  console.log(`[Session] Seeded with ${cookieStore.size} cookies.`);
});
