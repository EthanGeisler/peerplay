/**
 * Reputation aggregation service — computes seeder reputation scores from attestation events.
 *
 * Score formula: sum(log2(1 + weight)) across all valid attestations for a pubkey.
 * Each attestation's weight = bytesDownloaded / (1024 * 1024) (MB).
 *
 * Anti-sybil:
 * - Accounts less than 7 days old → weighted at 0.1x
 * - Max 20 attestations per attester per day (excess ignored)
 *
 * Web of trust weighting (when viewerPubkey provided):
 * - Attestation from a followed user → 1.0x trust weight
 * - Attestation from an unknown user → 0.25x trust weight
 * - Attestation from a muted user → 0x trust weight (completely ignored)
 *
 * Redis caching: 15-minute TTL
 * - Global: reputation:{pubkey}
 * - Personalized: reputation:{pubkey}:viewer:{viewerPubkey}
 */

import { db, redis } from "@boilerdeck/shared";
import { KIND_ATTESTATION, KIND_FOLLOW_LIST } from "./kinds.js";
import { queryEvents } from "./service.js";

const CACHE_TTL_SECONDS = 900; // 15 minutes
const CACHE_PREFIX = "reputation:";
const ACCOUNT_AGE_DAYS_THRESHOLD = 7;
const NEW_ACCOUNT_WEIGHT_MULTIPLIER = 0.1;
const MAX_ATTESTATIONS_PER_ATTESTER_PER_DAY = 20;
const BYTES_PER_MB = 1024 * 1024;

// Web of trust multipliers
const TRUST_WEIGHT_FOLLOWED = 1.0;
const TRUST_WEIGHT_UNKNOWN = 0.25;
const TRUST_WEIGHT_MUTED = 0;

export interface ReputationScore {
  pubkey: string;
  score: number;
  attestationCount: number;
  uniqueAttesters: number;
}

/**
 * Fetch the set of pubkeys that the viewer follows (from their kind 3 event).
 */
async function getFollowedPubkeys(viewerPubkey: string): Promise<Set<string>> {
  const events = await queryEvents({
    kinds: [KIND_FOLLOW_LIST],
    authors: [viewerPubkey],
    limit: 1,
  });

  const followed = new Set<string>();
  if (events.length > 0) {
    const tags = events[0]!.tags;
    for (const t of tags) {
      if (t[0] === "p" && typeof t[1] === "string" && t[1].length > 0) {
        followed.add(t[1].toLowerCase());
      }
    }
  }
  return followed;
}

/**
 * Fetch the set of pubkeys muted by the viewer.
 * Mute lists are stored in Redis as `mute_list:{userId}`.
 * Need to map viewerPubkey → userId first.
 */
async function getMutedPubkeys(viewerPubkey: string): Promise<Set<string>> {
  // Look up the user by their nostrPubkey to get their userId
  const user = await db.user.findFirst({
    where: { nostrPubkey: viewerPubkey },
    select: { id: true },
  });

  if (!user) {
    return new Set<string>();
  }

  const mutedList = await redis.smembers(`mute_list:${user.id}`);
  return new Set(mutedList.map((p) => p.toLowerCase()));
}

/**
 * Determine the trust weight for an attester relative to the viewer.
 */
function getTrustWeight(
  attesterPubkey: string,
  followedSet: Set<string>,
  mutedSet: Set<string>,
): number {
  if (mutedSet.has(attesterPubkey)) {
    return TRUST_WEIGHT_MUTED;
  }
  if (followedSet.has(attesterPubkey)) {
    return TRUST_WEIGHT_FOLLOWED;
  }
  return TRUST_WEIGHT_UNKNOWN;
}

/**
 * Compute reputation score for a pubkey from attestation events.
 *
 * @param pubkey - The pubkey whose reputation to compute
 * @param viewerPubkey - Optional viewer pubkey for personalized (web-of-trust) scoring.
 *                       When omitted, returns the global (unweighted) score.
 *
 * 1. Check Redis cache
 * 2. If miss: query events table for kind 31338 where `p` tag contains target pubkey
 * 3. For each attestation, apply anti-sybil rules and trust weighting, compute score
 * 4. Cache result and return
 */
export async function getReputation(
  pubkey: string,
  viewerPubkey?: string,
): Promise<ReputationScore> {
  // Build cache key — personalized scores get a separate key
  const cacheKey = viewerPubkey
    ? `${CACHE_PREFIX}${pubkey}:viewer:${viewerPubkey}`
    : `${CACHE_PREFIX}${pubkey}`;

  // 1. Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as ReputationScore;
    } catch {
      // Corrupted cache — recompute
    }
  }

  // 2. Query all kind 31338 events and filter for those with p tag matching target pubkey.
  //    Prisma JSON filtering on nested arrays is unreliable, so query all 31338 events
  //    and filter in application code.
  const allAttestations = await db.event.findMany({
    where: { kind: KIND_ATTESTATION },
  });

  // Filter to attestations where the `p` tag references the target pubkey
  const attestations = allAttestations.filter((event) => {
    const tags = event.tags as string[][];
    return tags.some(
      (t) => t[0] === "p" && t[1]?.toLowerCase() === pubkey.toLowerCase(),
    );
  });

  // If no attestations, return zero score
  if (attestations.length === 0) {
    const zeroResult: ReputationScore = {
      pubkey,
      score: 0,
      attestationCount: 0,
      uniqueAttesters: 0,
    };
    await redis.set(cacheKey, JSON.stringify(zeroResult), "EX", CACHE_TTL_SECONDS);
    return zeroResult;
  }

  // 3. Look up attester account ages (batch query for all unique attester pubkeys)
  const attesterPubkeys = [...new Set(attestations.map((e) => e.pubkey))];
  const attesterUsers = await db.user.findMany({
    where: { nostrPubkey: { in: attesterPubkeys } },
    select: { nostrPubkey: true, createdAt: true },
  });

  const attesterAgeMap = new Map<string, Date>();
  for (const u of attesterUsers) {
    if (u.nostrPubkey) {
      attesterAgeMap.set(u.nostrPubkey.toLowerCase(), u.createdAt);
    }
  }

  const now = new Date();
  const sevenDaysMs = ACCOUNT_AGE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

  // 3b. If viewer is specified, fetch their follow list and mute list for trust weighting
  let followedSet: Set<string> | undefined;
  let mutedSet: Set<string> | undefined;
  if (viewerPubkey) {
    [followedSet, mutedSet] = await Promise.all([
      getFollowedPubkeys(viewerPubkey),
      getMutedPubkeys(viewerPubkey),
    ]);
  }

  // 4. Group attestations by attester and day for rate limiting
  //    Key: `${attesterPubkey}:${YYYY-MM-DD}` → count
  const attesterDayCounts = new Map<string, number>();

  // Sort attestations by created_at ascending so we process oldest first
  // (and drop excess beyond 20 per attester per day)
  const sortedAttestations = [...attestations].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  let score = 0;
  let attestationCount = 0;
  const uniqueAttesterSet = new Set<string>();

  for (const event of sortedAttestations) {
    const attesterPubkey = event.pubkey.toLowerCase();

    // Per-attester daily limit check
    const eventDate = new Date(event.createdAt * 1000);
    const dayKey = `${attesterPubkey}:${eventDate.toISOString().slice(0, 10)}`;
    const currentCount = attesterDayCounts.get(dayKey) ?? 0;

    if (currentCount >= MAX_ATTESTATIONS_PER_ATTESTER_PER_DAY) {
      // Excess ignored
      continue;
    }
    attesterDayCounts.set(dayKey, currentCount + 1);

    // Parse bytesDownloaded from content
    let bytesDownloaded = 0;
    try {
      const content = JSON.parse(event.content);
      if (typeof content.bytesDownloaded === "number") {
        bytesDownloaded = content.bytesDownloaded;
      }
    } catch {
      // Malformed content — skip
      continue;
    }

    if (bytesDownloaded <= 0) {
      continue;
    }

    // Compute attestation weight in MB
    let weight = bytesDownloaded / BYTES_PER_MB;

    // Anti-sybil: new account multiplier
    const attesterCreatedAt = attesterAgeMap.get(attesterPubkey);
    if (attesterCreatedAt) {
      const accountAgeMs = now.getTime() - attesterCreatedAt.getTime();
      if (accountAgeMs < sevenDaysMs) {
        weight *= NEW_ACCOUNT_WEIGHT_MULTIPLIER;
      }
    }
    // If attester is not in the users table (e.g., VPS seed box), no penalty applied

    // Web of trust weighting: apply trust multiplier based on viewer's relationship to attester
    if (followedSet && mutedSet) {
      const trustWeight = getTrustWeight(attesterPubkey, followedSet, mutedSet);
      if (trustWeight === 0) {
        // Muted attester — completely ignored
        continue;
      }
      weight *= trustWeight;
    }

    // Logarithmic score accumulation
    score += Math.log2(1 + weight);
    attestationCount++;
    uniqueAttesterSet.add(attesterPubkey);
  }

  // Round score to 2 decimal places for readability
  score = Math.round(score * 100) / 100;

  const result: ReputationScore = {
    pubkey,
    score,
    attestationCount,
    uniqueAttesters: uniqueAttesterSet.size,
  };

  // 5. Cache result
  await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);

  return result;
}
