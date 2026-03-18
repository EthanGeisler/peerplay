import { Router } from "express";
import { z } from "zod";
import { authenticate, handleZodError } from "@boilerdeck/shared";
import * as paymentService from "./service.js";

export const paymentRouter = Router();

const checkoutSchema = z.object({
  gameId: z.string().uuid("gameId must be a valid UUID"),
});

paymentRouter.post(
  "/payments/checkout",
  authenticate,
  async (req, res, next) => {
    try {
      let input;
      try {
        input = checkoutSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const result = await paymentService.checkout(req.user!.sub, input.gameId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

paymentRouter.post("/payments/webhook", async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"] as string | undefined;
    const result = await paymentService.handleWebhook(req.body, signature);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
