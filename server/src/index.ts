import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { getConfig, errorHandler } from "@peerplay/shared";
import { authRouter, developerRouter } from "@peerplay/auth";
import { catalogRouter } from "@peerplay/catalog";
import { licenseRouter } from "@peerplay/license";
import { paymentRouter } from "@peerplay/payment";
import { torrentRouter } from "@peerplay/torrent";

const config = getConfig();
const app = express();

// Stripe webhooks need raw body — must be before express.json()
app.post("/api/payments/webhook", express.raw({ type: "application/json" }));

app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(morgan(config.NODE_ENV === "production" ? "combined" : "dev"));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount routes
app.use("/api/auth", authRouter);
app.use("/api", developerRouter);
app.use("/api", catalogRouter);
app.use("/api", licenseRouter);
app.use("/api", paymentRouter);
app.use("/api", torrentRouter);

// Error handler (must be last)
app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`Peerplay API running on port ${config.PORT} [${config.NODE_ENV}]`);
});

export default app;
