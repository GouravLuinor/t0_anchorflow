import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_COUNT_KEY,
  bumpSessionCount,
  shouldPromptSignIn,
} from "../authGate";

// jsdom is not available under the node environment, so a minimal in-memory
// localStorage stub stands in for the degraded-storage paths in bumpSessionCount.
function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

type StorageStub = ReturnType<typeof createLocalStorageStub>;

let storage: StorageStub;

beforeEach(() => {
  storage = createLocalStorageStub();
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("shouldPromptSignIn — policy", () => {
  it("never prompts a signed-in user, regardless of trigger", () => {
    for (const trigger of ["manual", "export", "return-visit"] as const) {
      expect(
        shouldPromptSignIn({ isAuthenticated: true, sessionCount: 0, trigger }),
      ).toBe(false);
      expect(
        shouldPromptSignIn({ isAuthenticated: true, sessionCount: 5, trigger }),
      ).toBe(false);
    }
  });

  it("always prompts unauthenticated users on manual and export triggers", () => {
    for (const trigger of ["manual", "export"] as const) {
      for (const sessionCount of [0, 1, 5]) {
        expect(
          shouldPromptSignIn({ isAuthenticated: false, sessionCount, trigger }),
        ).toBe(true);
      }
    }
  });

  it("prompts on return-visit only from the second visit onward", () => {
    expect(
      shouldPromptSignIn({ isAuthenticated: false, sessionCount: 0, trigger: "return-visit" }),
    ).toBe(false);
    expect(
      shouldPromptSignIn({ isAuthenticated: false, sessionCount: 1, trigger: "return-visit" }),
    ).toBe(false);
    expect(
      shouldPromptSignIn({ isAuthenticated: false, sessionCount: 2, trigger: "return-visit" }),
    ).toBe(true);
    expect(
      shouldPromptSignIn({ isAuthenticated: false, sessionCount: 9, trigger: "return-visit" }),
    ).toBe(true);
  });
});

describe("bumpSessionCount — local visit counter", () => {
  it("starts at 1 and persists under the keyspace", () => {
    expect(bumpSessionCount()).toBe(1);
    expect(storage.getItem(SESSION_COUNT_KEY)).toBe("1");
  });

  it("increments on every subsequent visit", () => {
    expect(bumpSessionCount()).toBe(1);
    expect(bumpSessionCount()).toBe(2);
    expect(bumpSessionCount()).toBe(3);
    expect(storage.getItem(SESSION_COUNT_KEY)).toBe("3");
  });

  it("resumes from a previously persisted count", () => {
    storage.setItem(SESSION_COUNT_KEY, "41");
    expect(bumpSessionCount()).toBe(42);
    expect(storage.getItem(SESSION_COUNT_KEY)).toBe("42");
  });

  it("treats non-finite, negative, and zero stored values as a first visit", () => {
    for (const stored of ["not-a-number", "-5", "0", ""]) {
      storage.setItem(SESSION_COUNT_KEY, stored);
      expect(bumpSessionCount()).toBe(1);
      expect(storage.getItem(SESSION_COUNT_KEY)).toBe("1");
    }
  });

  it("still returns a usable count when the store rejects writes", () => {
    const throwsOnWrite = {
      ...storage,
      setItem(): void {
        throw new Error("quota exceeded");
      },
    };
    (globalThis as { window?: unknown }).window = {
      localStorage: throwsOnWrite,
    };

    storage.setItem(SESSION_COUNT_KEY, "6");
    expect(bumpSessionCount()).toBe(7);
  });

  it("still returns 1 when the store cannot be read", () => {
    const throwsOnRead = {
      ...storage,
      getItem(): string | null {
        throw new Error("access denied");
      },
    };
    (globalThis as { window?: unknown }).window = {
      localStorage: throwsOnRead,
    };

    expect(bumpSessionCount()).toBe(1);
  });

  // The prompt policy is pure — it must hold with no window installed at all,
  // which is also the state afterEach restores for the next test.
  it("keeps the policy usable with no window installed", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(
      shouldPromptSignIn({ isAuthenticated: false, sessionCount: 5, trigger: "manual" }),
    ).toBe(true);
  });
});
