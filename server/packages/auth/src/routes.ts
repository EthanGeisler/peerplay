import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, ValidationError, handleZodError } from "@boilerdeck/shared";
import { registerSchema, loginSchema, recoverMnemonicSchema, pubkeyLoginSchema, exportKeysSchema, switchCustodySchema, changePasswordSchema } from "./schemas.js";
import * as authService from "./service.js";

const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later" } },
});

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    let input;
    try {
      input = registerSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.register(input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    let input;
    try {
      input = loginSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.login(input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken || typeof refreshToken !== "string") {
      throw new ValidationError("refreshToken is required");
    }
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken && typeof refreshToken === "string") {
      await authService.logout(refreshToken);
    }
    res.json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/challenge", challengeLimiter, async (_req, res, next) => {
  try {
    const result = await authService.generateChallenge();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login/pubkey", async (req, res, next) => {
  try {
    let input;
    try {
      input = pubkeyLoginSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.loginWithPubkey(input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/recover-mnemonic", authenticate, async (req, res, next) => {
  try {
    let input;
    try {
      input = recoverMnemonicSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.recoverMnemonic(req.user!.sub, input.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/export-keys", authenticate, async (req, res, next) => {
  try {
    let input;
    try {
      input = exportKeysSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.exportKeys(req.user!.sub, input.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/switch-custody", authenticate, async (req, res, next) => {
  try {
    let input;
    try {
      input = switchCustodySchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.switchCustody(req.user!.sub, input.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/change-password", authenticate, async (req, res, next) => {
  try {
    let input;
    try {
      input = changePasswordSchema.parse(req.body);
    } catch (err) {
      handleZodError(err);
    }
    const result = await authService.changePassword(req.user!.sub, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user!.sub);
    res.json(user);
  } catch (err) {
    next(err);
  }
});
