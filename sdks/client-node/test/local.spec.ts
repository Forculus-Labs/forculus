import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Forculus, RequestTimeoutError } from "../src/index.js";
import { localFetch, needsLocalFetch } from "../src/local.js";

let server: Server;
let port = 0;
const got: { method?: string; url?: string; host?: string; type?: string; body: string }[] = [];

function read(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});
}

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const body = await read(req);
		got.push({ method: req.method, url: req.url, host: req.headers.host, type: req.headers["content-type"], body });
		if (req.url === "/slow") return; // never answers
		if (req.url === "/v1/workspaces/acme/apps/hello/tokens/t1") {
			res.writeHead(204).end();
			return;
		}
		res.writeHead(200, { "content-type": "application/json", "x-request-id": "abc" }).end(JSON.stringify({ email: "ada@example.com", workspaces: [] }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => {
	server.closeAllConnections();
	server.close();
});

describe("the local platform", () => {
	it("is reached on loopback whatever the OS makes of .localhost, keeping the name in Host", async () => {
		const fc = new Forculus({ token: "fcu_local", baseUrl: `http://api.forculus.localhost:${port}` });
		expect((await fc.me()).email).toBe("ada@example.com");
		await fc.tokens.revoke("acme", "hello", "t1");
		expect(got.at(-2)).toMatchObject({ method: "GET", url: "/v1/me", host: `api.forculus.localhost:${port}` });
		expect(got.at(-1)).toMatchObject({ method: "DELETE", url: "/v1/workspaces/acme/apps/hello/tokens/t1" });
	});

	it("sends a multipart form as fetch would", async () => {
		const form = new FormData();
		form.append("abc", new Blob(["hello"], { type: "text/plain" }), "abc");
		const res = await localFetch(`http://x.localhost:${port}/form`, { method: "POST", body: form });
		expect(res.status).toBe(200);
		const seen = got.at(-1);
		expect(seen?.type).toMatch(/^multipart\/form-data; boundary=/);
		expect(seen?.body).toContain('name="abc"; filename="abc"');
		expect(seen?.body).toContain("hello");
	});

	it("times out as fetch does", async () => {
		const fc = new Forculus({ token: "fcu_local", baseUrl: `http://api.forculus.localhost:${port}`, timeoutMs: 100, maxRetries: 0 });
		await expect(fc.request({ method: "GET", path: "/slow", repeatable: true })).rejects.toBeInstanceOf(RequestTimeoutError);
	});

	it("is only for .localhost names", () => {
		expect(needsLocalFetch("http://api.forculus.localhost:8000/v1/me")).toBe(true);
		expect(needsLocalFetch("http://localhost:8000/v1/me")).toBe(false);
		expect(needsLocalFetch("https://api.forculuslabs.tech/v1/me")).toBe(false);
	});
});
