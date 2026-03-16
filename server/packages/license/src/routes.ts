import { Router } from "express";
import { z } from "zod";
import { authenticate, ValidationError } from "@boilerdeck/shared";
import * as licenseService from "./service.js";

export const licenseRouter = Router();

const verifyBodySchema = z.object({
  deviceFingerprint: z.string().length(64).optional(),
});

const keyBodySchema = z.object({
  deviceFingerprint: z.string().length(64).optional(),
});

licenseRouter.get("/licenses", authenticate, async (req, res, next) => {
  try {
    const licenses = await licenseService.listUserLicenses(req.user!.sub);
    res.json({ licenses });
  } catch (err) {
    next(err);
  }
});

licenseRouter.post(
  "/licenses/:gameId/verify",
  authenticate,
  async (req, res, next) => {
    try {
      const parsed = verifyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }
      const result = await licenseService.verifyLicense(
        req.user!.sub,
        String(req.params.gameId),
        parsed.data.deviceFingerprint,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

licenseRouter.post(
  "/licenses/:gameId/key",
  authenticate,
  async (req, res, next) => {
    try {
      const parsed = keyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }
      const result = await licenseService.getDecryptionKey(
        req.user!.sub,
        String(req.params.gameId),
        parsed.data.deviceFingerprint,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

licenseRouter.delete(
  "/licenses/:gameId/devices/:fingerprint",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await licenseService.removeDevice(
        req.user!.sub,
        String(req.params.gameId),
        String(req.params.fingerprint),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
