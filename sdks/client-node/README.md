# @forculus/client

Call the Forculus API from code: deploy, share apps, read the audit log and manage tokens.
Full docs: https://forculuslabs.tech/docs/sdks/client/

To check who is calling your app, you want `@forculus/sdk` instead.

```sh
npm install @forculus/client
```

It runs on Node 20 or newer, Deno, Bun and Workers, with no dependencies.

## Sign in

The client uses a CLI session. Run `forculus login` once on the computer, and the client finds the
session it saved:

```js
import { Forculus } from "@forculus/client";

const fc = new Forculus();
const me = await fc.me();
console.log(me.email, me.workspaces.map((w) => w.slug));
```

It looks for a token in this order:

1. `new Forculus({ token })`
2. `FORCULUS_TOKEN`
3. The session `forculus login` saved, in the same place the CLI keeps it

A CLI session lasts 30 days. A GitHub Actions run's deploy credential works too, for deploying the
one app it was made for. An app's bypass token doesn't: it calls the app, not the API.

The API's address is `baseUrl`, then `FORCULUS_API`, then `https://api.forculuslabs.tech`. The session
`forculus login` saved goes only to the API it was made by: with `baseUrl` or `FORCULUS_API` set to
anywhere else, the client throws instead of sending it. The client sends a token only over https,
or plain http to this machine. Behind a company proxy that inspects TLS, point `NODE_EXTRA_CA_CERTS` at the
proxy's certificate.

## Deploy

```js
const version = await fc.deploy.site("acme", "handbook", {
	files: [
		{ path: "/index.html", content: "<h1>Handbook</h1>" },
		{ path: "/logo.png", content: await readFile("logo.png") },
	],
});
console.log(`version ${version.number} is live`);
```

Only files the platform hasn't got are uploaded. A Worker goes up as the modules you built:

```js
await fc.deploy.worker("acme", "hello", {
	main_module: "index.js",
	compatibility_date: "2026-09-01",
	modules: { "index.js": { content: await readFile("dist/index.js", "utf8") } },
});
```

Both wait until the version is live and return it, or throw `DeployFailedError` saying why it
isn't. Pass `{ preview: true }` to put it up at a preview address instead, and `{ wait: false }` to
return as soon as it's on its way. Container apps are built and pushed by `forculus deploy`.

Every deploy is scanned. To have its packages checked for vulnerabilities, pass the lock files that
pin them, whole, with the project's `.forculus-allow` if it has one:
`{ scan: { lockfiles: [{ path: "package-lock.json", text }], allow } }`. Without them no package is
checked.

## Share

```js
await fc.access.share("acme", "hello", "ada@example.com", { role: "editor" });
await fc.access.shareDomain("acme", "hello", "acme.com");
const { still_shared_by } = await fc.access.unshare("acme", "hello", "ada@example.com");
```

## Read the audit log

`audit.iterate` goes back through every page for you:

```js
for await (const entry of fc.audit.iterate("acme", { app: "hello", decision: "deny" })) {
	console.log(entry.at, entry.action, entry.reason);
}
```

`audit.list` reads one page, for when you keep your own place.

## Bypass tokens

```js
const { secret, url } = await fc.tokens.create("acme", "hello", { name: "nightly", role: "viewer", expires_in_days: 30 });
// secret is shown once. Send it as `Authorization: Bearer <secret>` to url.
await fc.tokens.revoke("acme", "hello", tokenId);
```

## Errors

Every error is a `ForculusError`. An error answer from the API is an `ApiError` with `status`,
`code` and `message`, and a class for its status: `BadRequestError`, `AuthenticationError`,
`PermissionDeniedError` (and `PlanLimitError` with the `limit` hit), `NotFoundError`,
`ConflictError`, `PayloadTooLargeError`, `RateLimitError` and `ServerError`.
`ConnectionFailedError` and `RequestTimeoutError` mean no answer came.

Reads, and changes that are safe to repeat, are tried again after a failure on our side or a lost
connection (twice by default, `maxRetries`), and after a 429 once its `Retry-After` has passed. Any
other change is never sent twice: after a 429 it throws `RateLimitError`. Nor is a deploy: when
its answer doesn't arrive, or after a 429, the client looks for the version made of what it sent.

## Licence

Apache-2.0.
