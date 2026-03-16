import { Router } from "express";
import { authenticate } from "@peerplay/shared";
import * as licenseService from "./service.js";

export const licenseRouter = Router();

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
      const result = await licenseService.verifyLicense(
        req.user!.sub,
        String(req.params.gameId),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
