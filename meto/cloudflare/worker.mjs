import { signingRoute } from "./signing.mjs";
export function allowedOrigins(value = "") {
  return [...new Set(value.split(",").map(v => v.trim()).filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("ODOO_ORIGINS deve contenere origini HTTPS senza percorsi");
    return url.origin;
  }))];
}
export default {
  async fetch(request, env) {
    let origins;
    try { origins = allowedOrigins(env.ODOO_ORIGINS); }
    catch { return new Response("Configurazione origini Odoo non valida", { status: 503 }); }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/qz/")) return signingRoute(request, env);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    let response;
    if (url.pathname === "/config.json") {
      response = Response.json({ odooOrigins: origins }, { headers: { "Cache-Control": "no-store" } });
    } else if (url.pathname.startsWith("/api/")) {
      response = new Response("Not found", { status: 404 });
    } else {
      response = await env.ASSETS.fetch(request);
    }
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://localhost:8181 wss://localhost:* wss://localhost.qz.io:* ws://localhost:* ws://localhost.qz.io:*; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors ${origins.length ? origins.join(" ") : "'none'"}`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), loopback-network=(self), local-network-access=(self)");
    if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js")) headers.set("Cache-Control", "no-cache");
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
  },
};
