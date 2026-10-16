import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { generateEvent, generateGossip, isOffline, judge } from "./server/llm";

// Tiny JSON API mounted on the Vite dev server, so the API key never reaches the browser.
function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function gameMasterApi(): Plugin {
  const routes: Record<string, (body: any) => Promise<unknown>> = {
    "/api/judge": (b) => judge(b),
    "/api/event": (b) => generateEvent(String(b.context ?? ""), b.recentTitles ?? []),
    "/api/gossip": (b) => generateGossip(String(b.context ?? ""), b.names ?? []),
    "/api/status": async () => ({ offline: isOffline() }),
  };
  return {
    name: "game-master-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handler = req.url ? routes[req.url] : undefined;
        if (!handler) return next();
        try {
          send(res, await handler(await readJson(req)));
        } catch (err) {
          send(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env (ANTHROPIC_API_KEY, optional CEO_MODEL) into the server process only.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ""))) process.env[k] ??= v;
  return { plugins: [gameMasterApi()] };
});
