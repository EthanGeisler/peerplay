import { Router } from "express";
import { authenticate, ValidationError } from "@boilerdeck/shared";
import { registerSchema, loginSchema, recoverMnemonicSchema } from "./schemas.js";
import * as authService from "./service.js";
import { ZodError } from "zod";

export const authRouter = Router();

function handleZodError(err: unknown): never {
  if (err instanceof ZodError) {
    throw new ValidationError(err.errors.map((e) => e.message).join(", "));
  }
  throw err;
}

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

authRouter.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user!.sub);
    res.json(user);
  } catch (err) {
    next(err);
  }
});
