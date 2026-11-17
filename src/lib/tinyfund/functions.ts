import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DealRow, StartupProfile, VerifiedDeal } from "./types";

const keysSchema = z.object({
  tinyfishKey: z.string().max(500).optional(),
  aiBaseUrl: z.string().max(500).optional(),
  aiModel: z.string().max(200).optional(),
  aiKey: z.string().max(500).optional(),
});
type KeysInput = z.infer<typeof keysSchema>;

function checkDeals<T extends { deals: unknown; keys: KeysInput }>(d: T): T {
  keysSchema.parse(d.keys);
  if (!Array.isArray(d.deals) || d.deals.length > 250) throw new Error("bad deals");
  return d;
}

export const startSearch = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      description: z.string().min(5).max(1000),
      stage: z.string().max(40).optional(),
      country: z.string().max(80).optional(),
      keys: keysSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { parseStartup, createDealDataset, encodeRunId } = await import("./pipeline.server");
    const profile = await parseStartup(data.keys, data.description, data.stage, data.country);
    const datasetId = await createDealDataset(data.keys, profile);
    return { id: encodeRunId(datasetId, profile), datasetId, profile };
  });

export const pollSearch = createServerFn({ method: "POST" })
  .inputValidator(z.object({ datasetId: z.string().min(5).max(100), keys: keysSchema }))
  .handler(async ({ data }) => {
    const { getDataset } = await import("./pipeline.server");
    return getDataset(data.keys, data.datasetId);
  });

export const cancelSearch = createServerFn({ method: "POST" })
  .inputValidator(z.object({ datasetId: z.string().min(5).max(100), keys: keysSchema }))
  .handler(async ({ data }) => {
    const { cancelDataset } = await import("./pipeline.server");
    return cancelDataset(data.keys, data.datasetId);
  });

export const verifySearch = createServerFn({ method: "POST" })
  .inputValidator((d: { profile: StartupProfile; deals: DealRow[]; keys: KeysInput }) =>
    checkDeals(d),
  )
  .handler(async ({ data }) => {
    const { verifyDeals } = await import("./pipeline.server");
    return verifyDeals(data.keys, data.profile, data.deals);
  });

export const discoverSearch = createServerFn({ method: "POST" })
  .inputValidator((d: { profile: StartupProfile; deals: VerifiedDeal[]; keys: KeysInput }) =>
    checkDeals(d),
  )
  .handler(async ({ data }) => {
    const { discoverDeals } = await import("./pipeline.server");
    return discoverDeals(data.keys, data.profile, data.deals);
  });

export const reportSearch = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id: string;
      profile: StartupProfile;
      deals: VerifiedDeal[];
      notes?: string[];
      keys: KeysInput;
    }) => {
      if (d.notes && (!Array.isArray(d.notes) || d.notes.length > 20)) throw new Error("bad notes");
      return checkDeals(d);
    },
  )
  .handler(async ({ data }) => {
    const { buildReport } = await import("./pipeline.server");
    return buildReport(
      data.keys,
      data.id,
      data.profile,
      data.deals,
      (data.notes ?? []).map(String).slice(0, 20),
    );
  });
