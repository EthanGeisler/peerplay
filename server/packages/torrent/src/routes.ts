import { Router } from "express";
import { authenticate } from "@boilerdeck/shared";
import * as torrentService from "./service.js";

export const torrentRouter = Router();

torrentRouter.get(
  "/torrents/:gameId/latest",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await torrentService.getLatestTorrent(
        req.user!.sub,
        String(req.params.gameId),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
