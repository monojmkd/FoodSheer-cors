import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";

const app = express();
const PORT = 3001;

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
      proxyReq: (proxyReq, req) => {
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

        // KEY FIX: forward the browser's Swiggy cookies to the proxy request.
        // The /menu endpoint requires a valid Swiggy session — /restaurants doesn't.
        // Without this, Swiggy returns an empty body for menu requests.
        if (req.headers.cookie) {
          proxyReq.setHeader("Cookie", req.headers.cookie);
        }
      },
      proxyRes: (proxyRes, req) => {
        if (proxyRes.statusCode !== 200) {
          console.error(
            `[Proxy] Swiggy returned ${proxyRes.statusCode} for ${req.url}`,
          );
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
