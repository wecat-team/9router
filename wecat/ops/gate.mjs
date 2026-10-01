import http from "node:http";

const DEFAULT_PUBLIC_HOST = "0.0.0.0";
const DEFAULT_PUBLIC_PORT = 20128;
const DEFAULT_ADMIN_HOST = "127.0.0.1";
const DEFAULT_ADMIN_PORT = 20129;

function integer(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

export function createRouterGate({
  target,
  publicHost = DEFAULT_PUBLIC_HOST,
  publicPort = DEFAULT_PUBLIC_PORT,
  adminHost = DEFAULT_ADMIN_HOST,
  adminPort = DEFAULT_ADMIN_PORT,
  logger = console,
} = {}) {
  if (!target) throw new Error("target is required");
  const upstream = new URL(target);
  if (upstream.protocol !== "http:") throw new Error("target must use http://");

  let held = false;
  let active = 0;
  const queued = new Set();

  const status = () => ({ held, active, queued: queued.size });
  const requestPathname = (request) =>
    new URL(request.url || "/", "http://router-gate.local").pathname;
  const isLongLivedReadStream = (request) => {
    if (request.method !== "GET") return false;
    const pathname = requestPathname(request);
    return pathname === "/api/usage/stream" ||
      pathname === "/api/translator/console-logs/stream" ||
      (pathname.startsWith("/api/mcp/") && pathname.endsWith("/sse"));
  };

  function releaseQueued() {
    const waiting = [...queued];
    queued.clear();
    for (const item of waiting) {
      item.detach();
      if (!item.response.destroyed) dispatch(item.request, item.response);
    }
  }

  function queue(request, response) {
    const item = {
      request,
      response,
      detach: () => {
        request.off("aborted", abandon);
        response.off("close", abandon);
      },
    };
    const abandon = () => {
      item.detach();
      queued.delete(item);
    };
    request.once("aborted", abandon);
    response.once("close", abandon);
    queued.add(item);
  }

  function dispatch(request, response) {
    // Hold-at-idle covers every ordinary UI/API request so database writes and
    // login responses cannot be cut. Known read-only SSE streams reconnect.
    const tracked = !isLongLivedReadStream(request);
    if (tracked) active += 1;
    let settled = false;
    let upstreamRequest;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (tracked) active = Math.max(0, active - 1);
    };

    const onClientClose = () => {
      if (!response.writableEnded) upstreamRequest?.destroy();
      settle();
    };
    response.once("close", onClientClose);

    upstreamRequest = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 80,
      method: request.method,
      path: request.url,
      headers: request.headers,
    });

    upstreamRequest.once("response", (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
      upstreamResponse.once("end", () => {
        response.off("close", onClientClose);
        settle();
      });
      upstreamResponse.once("close", () => {
        response.off("close", onClientClose);
        settle();
      });
    });
    upstreamRequest.once("error", () => {
      settle();
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, 502, { error: "router temporarily unavailable" });
      } else if (!response.destroyed) {
        response.destroy();
      }
    });
    request.once("aborted", () => upstreamRequest.destroy());
    request.pipe(upstreamRequest);
  }

  const publicServer = http.createServer((request, response) => {
    if (held) queue(request, response);
    else dispatch(request, response);
  });
  // A controlled handoff may hold requests longer than Node's defaults.
  publicServer.requestTimeout = 0;
  publicServer.timeout = 0;

  const adminServer = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, status());
      return;
    }
    if (request.method === "POST" && (request.url === "/hold-if-idle" || request.url === "/hold")) {
      if (request.url === "/hold" || held || active === 0) {
        held = true;
        logger.info(`[router-gate] hold active=${active} queued=${queued.size}`);
        sendJson(response, 200, status());
      } else {
        sendJson(response, 409, status());
      }
      return;
    }
    if (request.method === "POST" && request.url === "/resume") {
      held = false;
      logger.info(`[router-gate] resume queued=${queued.size}`);
      sendJson(response, 200, status());
      releaseQueued();
      return;
    }
    sendJson(response, 404, { error: "not found" });
  });

  async function listen() {
    await Promise.all([
      new Promise((resolve, reject) => {
        publicServer.once("error", reject);
        publicServer.listen(publicPort, publicHost, resolve);
      }),
      new Promise((resolve, reject) => {
        adminServer.once("error", reject);
        adminServer.listen(adminPort, adminHost, resolve);
      }),
    ]);
    return {
      publicAddress: publicServer.address(),
      adminAddress: adminServer.address(),
    };
  }

  async function close() {
    held = false;
    for (const item of queued) {
      item.detach();
      if (!item.response.destroyed) {
        sendJson(item.response, 503, { error: "router gate shutting down" });
      }
    }
    queued.clear();
    await Promise.all([
      new Promise((resolve) => publicServer.close(resolve)),
      new Promise((resolve) => adminServer.close(resolve)),
    ]);
  }

  return { listen, close, status };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gate = createRouterGate({
    target: process.env.ROUTER_GATE_TARGET || "http://router:20128",
    publicHost: process.env.ROUTER_GATE_PUBLIC_HOST || DEFAULT_PUBLIC_HOST,
    publicPort: integer(process.env.ROUTER_GATE_PUBLIC_PORT, DEFAULT_PUBLIC_PORT),
    adminHost: process.env.ROUTER_GATE_ADMIN_HOST || DEFAULT_ADMIN_HOST,
    adminPort: integer(process.env.ROUTER_GATE_ADMIN_PORT, DEFAULT_ADMIN_PORT),
  });

  await gate.listen();
  console.info("[router-gate] ready");

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await gate.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
