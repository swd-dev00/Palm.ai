import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type StoredPreference = { id: number; userId: number; skillSlug: string; enabled: boolean };
const storedPreferences: StoredPreference[] = [];

const queryResult = () => {
  const promise = Promise.resolve([...storedPreferences]) as Promise<StoredPreference[]> & { limit: (count: number) => Promise<StoredPreference[]> };
  promise.limit = async count => storedPreferences.slice(0, count);
  return promise;
};

const fakeDb = {
  select: () => ({ from: () => ({ where: () => queryResult() }) }),
  insert: () => ({
    values: async (value: Omit<StoredPreference, "id">) => {
      storedPreferences.push({ id: storedPreferences.length + 1, ...value });
    },
  }),
  update: () => ({
    set: (value: Pick<StoredPreference, "enabled">) => ({
      where: async () => {
        if (storedPreferences[0]) storedPreferences[0].enabled = value.enabled;
      },
    }),
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fakeDb }));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
}));

let getSkillCatalog: typeof import("./db").getSkillCatalog;
let setSkillEnabled: typeof import("./db").setSkillEnabled;

beforeAll(async () => {
  process.env.DATABASE_URL = "mysql://palm-test";
  ({ getSkillCatalog, setSkillEnabled } = await import("./db"));
});

describe("Palm skill preference persistence", () => {
  beforeEach(() => {
    storedPreferences.length = 0;
  });

  it("reflects a saved capability preference when the catalog is read again", async () => {
    await setSkillEnabled(7, "data-analysis", false);
    const catalog = await getSkillCatalog(7);

    expect(catalog.find(skill => skill.slug === "data-analysis")?.enabled).toBe(false);
    expect(storedPreferences).toEqual([
      { id: 1, userId: 7, skillSlug: "data-analysis", enabled: false },
    ]);
  });
});
