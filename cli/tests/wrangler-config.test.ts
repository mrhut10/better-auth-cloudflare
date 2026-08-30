import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { findWranglerConfig, parseWranglerConfig } from "../src/lib/helpers.js";

describe("parseWranglerConfig", () => {
    test("parses D1 database from TOML", () => {
        const toml = `
name = "test"

[[d1_databases]]
binding = "DATABASE"
database_name = "mydb"
database_id = "abc-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: "abc-123",
        });
    });

    test("parses valid single-quoted TOML strings", () => {
        const result = parseWranglerConfig("[[d1_databases]]\nbinding = 'DATABASE'\ndatabase_name = 'mydb'", "toml");
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: undefined,
        });
    });

    test("parses D1 database from JSON", () => {
        const json = JSON.stringify({
            name: "test",
            d1_databases: [
                {
                    binding: "DATABASE",
                    database_name: "mydb",
                    database_id: "abc-123",
                },
            ],
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: "abc-123",
        });
    });

    test("parses D1 database from JSONC with comments", () => {
        const jsonc = `{
            // This is a comment
            "name": "test",
            "d1_databases": [
                {
                    "binding": "DATABASE",
                    "database_name": "mydb"
                }
            ]
        }`;
        const result = parseWranglerConfig(jsonc, "jsonc");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0].type).toBe("d1");
        expect(result.databases[0].binding).toBe("DATABASE");
    });

    test("parses Hyperdrive from TOML", () => {
        const toml = `
name = "test"

[[hyperdrive]]
binding = "HD"
id = "hyperdrive-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "hyperdrive",
            binding: "HD",
            id: "hyperdrive-123",
        });
    });

    test("parses Hyperdrive from JSON", () => {
        const json = JSON.stringify({
            name: "test",
            hyperdrive: [
                {
                    binding: "HD",
                    id: "hyperdrive-123",
                },
            ],
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "hyperdrive",
            binding: "HD",
            id: "hyperdrive-123",
        });
    });

    test("parses multiple databases", () => {
        const toml = `
name = "test"

[[d1_databases]]
binding = "DB"
database_name = "db1"

[[hyperdrive]]
binding = "HD"
id = "hd-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(2);
        expect(result.hasMultipleDatabases).toBe(true);
    });

    test("returns empty array when no databases", () => {
        const json = JSON.stringify({ name: "test" });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(0);
        expect(result.hasMultipleDatabases).toBe(false);
    });

    test("handles JSON with environment-specific config", () => {
        const json = JSON.stringify({
            name: "test",
            env: {
                production: {
                    d1_databases: [
                        {
                            binding: "DB",
                            database_name: "prod-db",
                        },
                    ],
                },
            },
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(0);
    });

    test("parses with trailing commas in JSONC", () => {
        const jsonc = `{
            "name": "test",
            "d1_databases": [
                {
                    "binding": "DB",
                    "database_name": "db"
                },
            ],
        }`;
        const result = parseWranglerConfig(jsonc, "jsonc");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0].binding).toBe("DB");
    });

    test("parses comments and trailing commas in a .json config like Wrangler", () => {
        const result = parseWranglerConfig('{ /* comment */ "d1_databases": [], }', "json");
        expect(result.databases).toEqual([]);
    });

    test("rejects a non-object root", () => {
        expect(() => parseWranglerConfig("[]", "json")).toThrow("JSON object at its root");
    });

    test("ignores database entries without a string binding", () => {
        const result = parseWranglerConfig('{ "d1_databases": [{ "binding": 123 }] }', "json");
        expect(result.databases).toEqual([]);
    });
});

describe("Wrangler config discovery", () => {
    test("matches Wrangler precedence", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            writeFileSync(join(directory, "wrangler.toml"), 'name = "toml"');
            writeFileSync(join(directory, "wrangler.jsonc"), '{ "name": "jsonc" }');
            writeFileSync(join(directory, "wrangler.json"), '{ "name": "json" }');

            const result = findWranglerConfig(directory);
            expect(result?.format).toBe("json");
            expect(basename(result?.path ?? "")).toBe("wrangler.json");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("matches Wrangler precedence across parent directories", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            const project = join(directory, "project");
            const nested = join(project, "src", "routes");
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(directory, "wrangler.json"), '{ "name": "parent-json" }');
            writeFileSync(join(project, "wrangler.toml"), 'name = "nearer-toml"');

            const result = findWranglerConfig(nested);
            expect(result?.format).toBe("json");
            expect(result?.path).toBe(join(directory, "wrangler.json"));
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
