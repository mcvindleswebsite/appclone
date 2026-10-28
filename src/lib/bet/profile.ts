import { sanitizeVaultProfile, vaultProfile } from "@/lib/bet/history";
import { readVault } from "@/lib/bet/store";
import type { VaultProfile } from "@/types/bet";

/** The Bet Vault profile from the Upstash vault when it's connected, else the one the browser sent. */
export const loadProfile = async (sent: unknown): Promise<VaultProfile | null> => {
  try {
    const records = await readVault();
    if (records) return vaultProfile(records);
  } catch {
    // Fall through to the client copy.
  }
  return sanitizeVaultProfile(sent);
};
