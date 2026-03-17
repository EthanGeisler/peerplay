import { Router } from "express";
import { authenticate } from "@boilerdeck/shared";
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
