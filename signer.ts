const QIMEI_APP_KEY = Deno.env.get("YUANBAO_QIMEI_APP_KEY") ?? "0WEB05U9OEC1ZNRY";
const USKEY_APP_ID = Deno.env.get("YUANBAO_QIMEI_APP_ID") ?? "7800385";
const KNOWN_QIMEI_MODULE_IDS = (Deno.env.get("YUANBAO_QIMEI_MODULE_IDS") ??
  "12601,77004")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const CHAT_PAGE = (agentId: string) =>
  `https://yuanbao.tencent.com/chat/${agentId}`;

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
}

class CdpSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private heartbeat: number | null = null;

  constructor(private wsUrl: string) {}

  async connect(timeoutMs = 15000): Promise<void> {
    this.ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("cdp websocket connect timeout"));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("cdp websocket connect failed"));
      };
    });

    this.ws.onmessage = (event) => {
      let message: CdpResponse;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(`cdp error: ${message.error.message}`));
        } else {
          waiter.resolve(message.result);
        }
      }
    };

    this.ws.onclose = () => this.failAll(new Error("cdp websocket closed"));
    this.ws.onerror = () => this.failAll(new Error("cdp websocket error"));

    this.heartbeat = setInterval(() => {
      this.evaluate("1", 5000).catch(() => {});
    }, 20000);
  }

  private failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("cdp websocket not open"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp timeout: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = unknown>(
    expression: string,
    timeoutMs = 15000,
  ): Promise<T> {
    const result = await Promise.race([
      this.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }) as Promise<{
        result?: { value?: T };
        exceptionDetails?: { text?: string };
      }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("evaluate timeout")), timeoutMs)
      ),
    ]);
    if (result?.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.text}`);
    }
    return result?.result?.value as T;
  }

  close() {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.send("Target.closeTarget", {}).catch(() => {});
    setTimeout(() => {
      try {
        this.ws?.close();
      } catch { /* noop */ }
    }, 500);
    this.ws = null;
  }
}

function webpackBootstrap(id: string | number): string {
  const tag = JSON.stringify(`__yb_${id}_${Date.now()}`);
  return `(() => {
    let __r = null;
    try {
      self.webpackChunk_N_E.push([[${tag}], {}, (q) => { __r = q; }]);
    } catch (_) { /* noop */ }
    return __r;
  })()`;
}

const RESOLVE_BODY = (() => {
  const appKey = JSON.stringify(QIMEI_APP_KEY);
  const knownIds = JSON.stringify(KNOWN_QIMEI_MODULE_IDS);
  const bootstrap = webpackBootstrap("resolve");
  return `try {
    if (self.__ybInstance) return { ok: true, cached: true };
    const wr = ${bootstrap};
    if (!wr) return { error: "no-webpack" };
    const APP_KEY = ${appKey};
    const looksValid = (inst) => !!inst &&
      typeof inst.getUSKeySync === "function" &&
      typeof inst.getLocalQimei36 === "function";
    const fromExport = (mod) => {
      if (!mod) return null;
      if (typeof mod.I5 === "function") {
        try {
          const inst = mod.I5(APP_KEY);
          if (looksValid(inst)) return inst;
        } catch (_) { /* fall through */ }
      }
      return null;
    };
    const tryFactory = (fn) => {
      if (typeof fn !== "function") return null;
      for (const make of [() => fn(APP_KEY), () => new fn(APP_KEY)]) {
        try {
          const inst = make();
          if (looksValid(inst)) return inst;
        } catch (_) { /* next */ }
      }
      return null;
    };
    const scanModule = (mod) => {
      if (!mod || typeof mod !== "object") return null;
      const preferred = fromExport(mod);
      if (preferred) return preferred;
      for (const value of Object.values(mod)) {
        const inst = tryFactory(value);
        if (inst) return inst;
      }
      return looksValid(mod) ? mod : null;
    };
    for (const id of ${knownIds}) {
      try {
        const inst = scanModule(wr(id));
        if (inst) {
          self.__ybInstance = inst;
          return { ok: true, moduleId: id };
        }
      } catch (_) { /* next known id */ }
    }
    for (const id of Object.keys(wr.m)) {
      try {
        if (!String(wr.m[id]).includes("getUSKeySync")) continue;
        const inst = scanModule(wr(id));
        if (inst) {
          self.__ybInstance = inst;
          return { ok: true, moduleId: id };
        }
      } catch (_) { /* keep scanning */ }
    }
    return { error: "qimei-module-not-found" };
  } catch (e) {
    return { error: String(e) };
  }`;
})();

const READY_EXPRESSION = `(() => {
  const out = (() => { ${RESOLVE_BODY} })();
  if (!out?.ok) return false;
  try {
    const h38 = self.__ybInstance.getLocalQimei36()?.h38 ||
      localStorage.getItem("_qimei_h38") || "";
    return typeof h38 === "string" && h38.length === 38;
  } catch (_) {
    return false;
  }
})()`;

const SIGN_EXPRESSION = (() => {
  const appId = JSON.stringify(USKEY_APP_ID);
  return `(() => {
    try {
      const out = (() => { ${RESOLVE_BODY} })();
      if (!out?.ok) return { error: out?.error ?? "resolve-failed" };
      const inst = self.__ybInstance;
      const h38 = inst.getLocalQimei36()?.h38 ||
        localStorage.getItem("_qimei_h38") || "";
      if (!h38 || h38.length !== 38) return { error: "invalid-h38", h38 };
      const ts = Date.now();
      const params = "h38=" + h38 + "&timestamp=" + ts + "&platform=web";
      const uskey = inst.getUSKeySync(${appId}, h38, params);
      if (!uskey) return { error: "empty-uskey" };
      return {
        h38,
        ts,
        uskey,
        deviceId: localStorage.getItem("_qimei_uuid42") || "",
      };
    } catch (e) {
      return { error: String(e) };
    }
  })()`;
})();

export interface SignerCookie {
  name: string;
  value: string;
}

export class UskeySigner {
  private session: CdpSession | null = null;
  private sessionPromise: Promise<CdpSession> | null = null;

  constructor(
    private browserlessUrl: string,
    private agentId: string,
    private cookies: SignerCookie[],
  ) {}

  private get httpBase(): string {
    return this.browserlessUrl.replace(/^ws/, "http").replace(/\/$/, "");
  }

  private async ensureSession(): Promise<CdpSession> {
    if (this.session) return this.session;
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = this.createSession().finally(() => {
      this.sessionPromise = null;
    });
    return this.sessionPromise;
  }

  private async createSession(): Promise<CdpSession> {
    const chatUrl = CHAT_PAGE(this.agentId);
    const createRes = await fetch(
      `${this.httpBase}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    );
    if (!createRes.ok) {
      throw new Error(
        `browserless /json/new failed: ${createRes.status} ${
          await createRes.text()
        }`,
      );
    }
    const target = await createRes.json() as {
      id: string;
      webSocketDebuggerUrl: string;
    };

    const wsUrl = new URL(target.webSocketDebuggerUrl);
    const base = new URL(this.browserlessUrl);
    const wsUrlStr =
      `${wsUrl.protocol}//${base.host}${wsUrl.pathname}${wsUrl.search}`;

    const session = new CdpSession(wsUrlStr);
    try {
      await session.connect();
      await session.send("Network.enable");
      await session.send("Network.setCookies", {
        cookies: this.cookies.map((cookie) => ({
          ...cookie,
          domain: ".tencent.com",
          path: "/",
        })),
      });
      await session.send("Emulation.setUserAgentOverride", {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        acceptLanguage: "zh-CN,zh;q=0.9",
        platform: "Windows",
      });
      await session.send("Page.enable");
      await session.send("Page.navigate", { url: chatUrl });

      const ready = await this.waitUntilReady(session);
      if (!ready) {
        session.close();
        throw new Error("yuanbao qimei SDK init timeout in browserless page");
      }
      this.session = session;
      console.log("[yuanbao] uskey signer session ready");
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  private async waitUntilReady(session: CdpSession): Promise<boolean> {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const ready = await session.evaluate<boolean>(READY_EXPRESSION, 10000);
        if (ready) return true;
      } catch { /* retry */ }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  }

  async sign(): Promise<Record<string, string> | null> {
    let session = await this.ensureSession();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await session.evaluate<
          { error?: string; h38?: string; ts?: number; uskey?: string; deviceId?: string }
        >(SIGN_EXPRESSION, 10000);
        if (raw?.error || !raw?.uskey) {
          throw new Error(`sign failed: ${raw?.error ?? "unknown"}`);
        }
        return {
          "X-Uskey": encodeURIComponent(raw.uskey),
          "X-Timestamp": String(raw.ts),
          "X-HY92": raw.h38 ?? "",
          ...(raw.deviceId
            ? { "X-device-id": raw.deviceId, "X-HY93": raw.deviceId }
            : {}),
        };
      } catch (error) {
        console.warn(
          `[yuanbao] sign attempt ${attempt + 1} failed:`,
          error instanceof Error ? error.message : error,
        );
        this.dispose();
        if (attempt === 0) session = await this.ensureSession();
      }
    }
    throw new Error("yuanbao uskey signing failed");
  }

  dispose() {
    this.session?.close();
    this.session = null;
  }
}
