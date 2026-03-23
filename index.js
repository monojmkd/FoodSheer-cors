import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";

const app = express();
const PORT = 3001;

let swiggySessionCookies = "";
let cookiesFetchedAt = 0;
const COOKIE_TTL_MS = 30 * 60 * 1000;

const fetchSwiggySession = async () => {
  const now = Date.now();
  if (swiggySessionCookies && now - cookiesFetchedAt < COOKIE_TTL_MS) return;
  try {
    const res = await fetch("https://www.swiggy.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    const raw = res.headers.getSetCookie?.() ?? [];
    if (raw.length > 0) {
      swiggySessionCookies = raw.map((c) => c.split(";")[0]).join("; ");
      cookiesFetchedAt = now;
      console.log("[Session] Swiggy cookies refreshed.");
    }
  } catch (err) {
    console.error("[Session] Failed to fetch Swiggy cookies:", err.message);
  }
};

fetchSwiggySession();

app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

app.use(
  "/api/proxy/swiggy/dapi",
  createProxyMiddleware({
    target: "https://www.swiggy.com",
    changeOrigin: true,
    pathRewrite: {
      "^/api/proxy/swiggy/dapi": "/dapi",
    },
    on: {
      proxyReq: async (proxyReq) => {
        await fetchSwiggySession();
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
        if (swiggySessionCookies) {
          proxyReq.setHeader("Cookie", swiggySessionCookies);
        }
      },
      proxyRes: (proxyRes, req) => {
        if (proxyRes.statusCode !== 200) {
          console.error(
            `[Proxy] Swiggy returned ${proxyRes.statusCode} for ${req.url}`,
          );
        }

        // KEY FIX: Swiggy sends back its own CORS headers pointing to swiggy.com.
        // The browser rejects these because the requesting origin is localhost/your domain.
        // We delete Swiggy's CORS headers and let our own cors() middleware handle it instead.
        delete proxyRes.headers["access-control-allow-origin"];
        delete proxyRes.headers["access-control-allow-credentials"];
        delete proxyRes.headers["access-control-allow-methods"];
        delete proxyRes.headers["access-control-allow-headers"];

        // Update cookie cache if Swiggy rotates them
        const newCookies = proxyRes.headers["set-cookie"];
        if (newCookies?.length > 0) {
          swiggySessionCookies = newCookies
            .map((c) => c.split(";")[0])
            .join("; ");
          cookiesFetchedAt = Date.now();
        }
      },
    },
  }),
);

app.get("/", (req, res) => {
  res.send("<h1>Welcome to the FoodSheer App</h1>");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
