import IORedis from "ioredis";

const RedisClient = IORedis.default ?? IORedis;

export const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});
