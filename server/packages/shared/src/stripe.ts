import Stripe from "stripe";
import { getConfig } from "./config.js";
import { AppError } from "./errors.js";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = getConfig().STRIPE_SECRET_KEY;
    if (!key) {
      throw new AppError(500, "Stripe is not configured — set STRIPE_SECRET_KEY in .env");
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}
