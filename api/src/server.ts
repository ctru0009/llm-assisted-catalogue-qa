import { createApp } from "./app";
import { composeProvider } from "./composition";
import { loadConfig } from "./config";
import { createReviewStore } from "./store/review-store";

async function startServer(): Promise<void> {
  try {
    const config = loadConfig();
    const app = createApp({
      provider: composeProvider(config),
      store: createReviewStore(),
      corsOrigin: config.corsOrigin,
    });
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch {
    console.error(JSON.stringify({ event: "server_startup_failed" }));
    process.exitCode = 1;
  }
}

void startServer();
