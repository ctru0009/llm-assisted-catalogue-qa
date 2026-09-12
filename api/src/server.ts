import { createApp } from "./app";
import { composeProvider } from "./composition";
import { loadConfig } from "./config";
import { createReviewStore } from "./store/review-store";

const config = loadConfig();
const app = createApp({
  provider: composeProvider(config),
  store: createReviewStore(),
  corsOrigin: config.corsOrigin,
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch(() => {
  process.exitCode = 1;
});
