import http from "node:http";

const DEFAULT_PUBLIC_HOST = "0.0.0.0";
const DEFAULT_PUBLIC_PORT = 20128;
const DEFAULT_ADMIN_HOST = "127.0.0.1";
const DEFAULT_ADMIN_PORT = 20129;
// Thả hàng đợi sau resume theo nhịp: mỗi RESUME_INTERVAL_MS thả tối đa RESUME_BATCH request,
// và không thả thêm khi active đã chạm RESUME_MAX_ACTIVE (W-017: thả 74–146 request ảnh
// cùng lúc làm host hết bộ nhớ TCP). Với 0 thì bỏ giới hạn tương ứng.
const DEFAULT_RESUME_BATCH = 4;
const DEFAULT_RESUME_INTERVAL_MS = 1000;
const DEFAULT_RESUME_MAX_ACTIVE = 64;
// Upstream không gửi byte nào quá lâu thì hủy để active không kẹt mãi (W-017). Dài hơn timeout
// sinh ảnh của app (300 s). Chỉ áp cho request được đếm; stream đọc lâu dài không bị cắt.
const DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS = 600_000;

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
  resumeBatch = DEFAULT_RESUME_BATCH,
  resumeIntervalMs = DEFAULT_RESUME_INTERVAL_MS,
  resumeMaxActive = DEFAULT_RESUME_MAX_ACTIVE,
  upstreamIdleTimeoutMs = DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
  logger = console,
} = {}) {
  if (!target) throw new Error("target is required");
  const upstream = new URL(target);
  if (upstream.protocol !== "http:") throw new Error("target must use http://");

  let held = false;
  let active = 0;
  // Set giữ thứ tự chèn: request đến sau luôn đứng sau trong hàng đợi.
  const queued = new Set();
  let releaseTimer = null;

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

  // Đang xả hàng đợi thì request mới cũng xếp sau, không vượt hàng.
  const releasing = () => !held && queued.size > 0;

  function stopRelease() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  function releaseQueued() {
    stopRelease();
    if (held) return;
    let released = 0;
    for (const item of queued) {
      if (resumeBatch > 0 && released >= resumeBatch) break;
      if (resumeMaxActive > 0 && active >= resumeMaxActive) break;
      queued.delete(item);
      item.detach();
      if (item.response.destroyed || item.clientGone()) {
        if (!item.response.destroyed) item.response.destroy();
        continue;
      }
      dispatch(item.request, item.response);
      released += 1;
    }
    if (queued.size > 0) releaseTimer = setTimeout(releaseQueued, Math.max(1, resumeIntervalMs));
  }

  // Client đóng chiều gửi (FIN) khi còn chờ response nghĩa là đã bỏ request (nginx làm vậy khi
  // client hủy). Với request đang xếp hàng, Node (22/24) không phát "aborted" hay "close" của
  // response trong trường hợp này, nên phải nghe thẳng socket. Áp cả khi đang chạy cho chắc.
  function watchClientGone(request, response, onGone) {
    const socket = request.socket;
    let gone = false;
    const handler = () => {
      if (gone || response.writableEnded) return;
      gone = true;
      onGone();
    };
    socket?.once("end", handler);
    socket?.once("close", handler);
    return {
      isGone: () => gone || Boolean(socket?.destroyed) || Boolean(socket?.readableEnded && !response.writableEnded),
      stop: () => {
        socket?.off("end", handler);
        socket?.off("close", handler);
      },
    };
  }

  function queue(request, response) {
    let watcher;
    const item = {
      request,
      response,
      clientGone: () => watcher.isGone(),
      detach: () => {
        request.off("aborted", abandon);
        response.off("close", abandon);
        watcher.stop();
      },
    };
    const abandon = () => {
      item.detach();
      queued.delete(item);
      if (!response.destroyed) response.destroy();
    };
    watcher = watchClientGone(request, response, abandon);
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
    let watcher;
    const settle = () => {
      if (settled) return;
      settled = true;
      watcher?.stop();
      if (tracked) active = Math.max(0, active - 1);
      // Một request xong thì có chỗ cho request đang chờ khi đang xả hàng đợi.
      if (releasing() && !releaseTimer) releaseQueued();
    };

    const onClientClose = () => {
      if (!response.writableEnded) upstreamRequest?.destroy();
      settle();
    };
    response.once("close", onClientClose);
    watcher = watchClientGone(request, response, () => {
      upstreamRequest?.destroy();
      settle();
      if (!response.destroyed) response.destroy();
    });

    upstreamRequest = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 80,
      method: request.method,
      path: request.url,
      headers: request.headers,
    });
    if (tracked && upstreamIdleTimeoutMs > 0) {
      upstreamRequest.setTimeout(upstreamIdleTimeoutMs, () => {
        logger.info(`[router-gate] upstream idle timeout ${request.method} ${requestPathname(request)}`);
        upstreamRequest.destroy(new Error("upstream idle timeout"));
      });
    }

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
    if (held || releasing()) queue(request, response);
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
        stopRelease();
        logger.info(`[router-gate] hold active=${active} queued=${queued.size}`);
        sendJson(response, 200, status());
      } else {
        sendJson(response, 409, status());
      }
      return;
    }
    if (request.method === "POST" && request.url === "/resume") {
      held = false;
      logger.info(`[router-gate] resume queued=${queued.size} batch=${resumeBatch} intervalMs=${resumeIntervalMs} maxActive=${resumeMaxActive}`);
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
    stopRelease();
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
    resumeBatch: integer(process.env.ROUTER_GATE_RESUME_BATCH, DEFAULT_RESUME_BATCH),
    resumeIntervalMs: integer(process.env.ROUTER_GATE_RESUME_INTERVAL_MS, DEFAULT_RESUME_INTERVAL_MS),
    resumeMaxActive: integer(process.env.ROUTER_GATE_RESUME_MAX_ACTIVE, DEFAULT_RESUME_MAX_ACTIVE),
    upstreamIdleTimeoutMs: integer(process.env.ROUTER_GATE_UPSTREAM_IDLE_TIMEOUT_MS, DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS),
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
