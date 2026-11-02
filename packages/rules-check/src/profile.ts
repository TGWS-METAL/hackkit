import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

// profile.yaml na raiz (fora do git); modelo em profile.example.yaml.
export const profileSchema = z.object({
  country: z.string().length(2).transform((c) => c.toUpperCase()),
  age: z.number().int().min(0),
});

export type Profile = z.infer<typeof profileSchema>;

export function parseProfile(text: string): Profile {
  return profileSchema.parse(parse(text));
}

export function loadProfile(path: string): Profile {
  return parseProfile(readFileSync(path, "utf8"));
}
