import { describe, expect, it, vi } from "vitest";
import { handleInit, resolveInitPath } from "./init.ts";
import { createFakeFs } from "../../tests/helpers/fake-fs.ts";
import { parseConfig } from "../lib/config.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const CONFIG_PATH = "/home/u/.config/gdrive-cli/config.toml";

describe("resolveInitPath", () => {
  it("prefers --config, then --local, then the default path", () => {
    expect(resolveInitPath({ configPath: "/tmp/c.toml", local: true })).toBe("/tmp/c.toml");
    expect(resolveInitPath({ local: true })).toBe(`${process.cwd()}/gdrive-cli.toml`);
    expect(resolveInitPath({})).toContain(".config/gdrive-cli/config.toml");
  });
});

describe("handleInit", () => {
  it("seeds accounts from authenticated tokens and sets the first as default", async () => {
    const fs = createFakeFs();
    const out = collect();
    await handleInit({
      fs,
      listAccounts: () => ["work@example.com", "me@gmail.com"],
      path: CONFIG_PATH,
      format: "text",
      quiet: false,
      write: out.write,
    });

    const written = fs.files.get(CONFIG_PATH) ?? "";
    const config = parseConfig(written);
    expect(config.accounts).toEqual([{ email: "work@example.com" }, { email: "me@gmail.com" }]);
    expect(config.default_account).toBe("work@example.com");
    expect(config.default_format).toBe("json");
    expect(out.output).toContain(`Created ${CONFIG_PATH}`);
    // Nothing in text output pads, here included (decision 0036 §2): the two
    // spaces after `Default:` were the last hand-alignment in the CLI.
    expect(out.output.split("\n")).toEqual([
      `Created ${CONFIG_PATH}`,
      "Accounts: work@example.com, me@gmail.com",
      "Default: work@example.com",
    ]);
  });

  it("writes a usable config when no account is authenticated yet", async () => {
    const fs = createFakeFs();
    const out = collect();
    await handleInit({
      fs,
      listAccounts: () => [],
      path: CONFIG_PATH,
      format: "text",
      quiet: false,
      write: out.write,
    });
    const config = parseConfig(fs.files.get(CONFIG_PATH) ?? "");
    expect(config.accounts).toEqual([]);
    expect(config.default_account).toBeUndefined();
    expect(out.output).toContain("gdrive auth");
  });

  it("refuses to clobber an existing config without --force", async () => {
    const fs = createFakeFs({ [CONFIG_PATH]: 'default_account = "old@example.com"\n' });
    await expect(
      handleInit({
        fs,
        listAccounts: () => ["new@example.com"],
        path: CONFIG_PATH,
        format: "text",
        quiet: false,
        write: () => {},
      }),
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    expect(fs.files.get(CONFIG_PATH)).toContain("old@example.com");
  });

  it("overwrites with --force", async () => {
    const fs = createFakeFs({ [CONFIG_PATH]: 'default_account = "old@example.com"\n' });
    await handleInit({
      fs,
      listAccounts: () => ["new@example.com"],
      path: CONFIG_PATH,
      force: true,
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(parseConfig(fs.files.get(CONFIG_PATH) ?? "").default_account).toBe("new@example.com");
  });

  it("prints the path in quiet mode and the details in JSON", async () => {
    const q = collect();
    await handleInit({
      fs: createFakeFs(),
      listAccounts: () => ["a@b.com"],
      path: CONFIG_PATH,
      format: "text",
      quiet: true,
      write: q.write,
    });
    expect(q.output).toBe(CONFIG_PATH);

    const j = collect();
    await handleInit({
      fs: createFakeFs(),
      listAccounts: () => ["a@b.com"],
      path: CONFIG_PATH,
      format: "json",
      quiet: false,
      write: j.write,
    });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: {
        path: CONFIG_PATH,
        accounts: ["a@b.com"],
        default_account: "a@b.com",
        created: true,
      },
    });
  });

  it("creates the parent directory", async () => {
    const fs = createFakeFs();
    const mkdirSync = vi.fn(fs.mkdirSync);
    await handleInit({
      fs: { ...fs, mkdirSync },
      listAccounts: () => [],
      path: CONFIG_PATH,
      format: "text",
      quiet: false,
      write: () => {},
    });
    expect(mkdirSync).toHaveBeenCalledWith("/home/u/.config/gdrive-cli", { recursive: true });
  });
});
