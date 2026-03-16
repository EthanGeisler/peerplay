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

torrentRouter.get(
  "/torrents/:gameId/latest/file",
  authenticate,
  async (req, res, next) => {
    try {
      const buffer = await torrentService.getLatestTorrentFile(
        req.user!.sub,
        String(req.params.gameId),
      );
      res.set("Content-Type", "application/x-bittorrent");
      res.set("Content-Disposition", "attachment");
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);
