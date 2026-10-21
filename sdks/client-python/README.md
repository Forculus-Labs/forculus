# forculus-client

Call the Forculus API from Python: deploy, share apps, read the audit log and manage tokens.
Full docs: https://forculuslabs.tech/docs/sdks/client/

To check who is calling your app, you want the `forculus` package instead.

```sh
pip install forculus-client
```

Python 3.10 or newer. Its one dependency is truststore, so it trusts what your operating system
trusts, a company proxy's certificate included, as the CLI does.

## Sign in

The client uses a CLI session. Run `forculus login` once on the computer, and the client finds the
session it saved:

```python
from forculus_client import Client

fc = Client()
me = fc.me()
print(me["email"], [w["slug"] for w in me["workspaces"]])
```

It looks for a token in this order:

1. `Client(token)`
2. `FORCULUS_TOKEN`
3. The session `forculus login` saved, in the same place the CLI keeps it

A CLI session lasts 30 days. A GitHub Actions run's deploy credential works too, for deploying the
one app it was made for. An app's bypass token doesn't: it calls the app, not the API.

The API's address is `base_url`, then `FORCULUS_API`, then `https://api.forculuslabs.tech`. The session
`forculus login` saved goes only to the API it was made by: with `base_url` or `FORCULUS_API` set to
anywhere else, the client raises instead of sending it. The client sends a token only over https,
or plain http to this machine.

## Deploy

```python
from pathlib import Path

version = fc.deploy.site("acme", "handbook", [
    {"path": "/index.html", "content": "<h1>Handbook</h1>"},
    {"path": "/logo.png", "content": Path("logo.png").read_bytes()},
])
print(f"version {version['number']} is live")
```

Only files the platform hasn't got are uploaded. A Worker goes up as the modules you built:

```python
fc.deploy.worker(
    "acme", "hello",
    main_module="index.js",
    compatibility_date="2026-09-01",
    modules={"index.js": {"content": Path("dist/index.js").read_text()}},
)
```

Both wait until the version is live and return it, or raise `DeployFailedError` saying why it
isn't. Pass `preview=True` to put it up at a preview address instead, and `wait=False` to return
as soon as it's on its way. Container apps are built and pushed by `forculus deploy`.

Every deploy is scanned. To have its packages checked for vulnerabilities, pass the lock files that
pin them, whole, with the project's `.forculus-allow` if it has one:
`scan={"lockfiles": [{"path": "package-lock.json", "text": text}], "allow": allow}`. Without them
no package is checked.

## Share

```python
fc.access.share("acme", "hello", "ada@example.com", role="editor")
fc.access.share_domain("acme", "hello", "acme.com")
still = fc.access.unshare("acme", "hello", "ada@example.com")["still_shared_by"]
```

## Read the audit log

`audit.iterate` goes back through every page for you:

```python
for entry in fc.audit.iterate("acme", app="hello", decision="deny"):
    print(entry["at"], entry["action"], entry["reason"])
```

`audit.list` reads one page, for when you keep your own place.

## Bypass tokens

```python
made = fc.tokens.create("acme", "hello", "nightly", "viewer", expires_in_days=30)
# made["secret"] is shown once. Send it as `Authorization: Bearer <secret>` to made["url"].
fc.tokens.revoke("acme", "hello", made["token"]["id"])
```

## Errors

Every error is a `ForculusError`. An error answer from the API is an `ApiError` with `status`,
`code` and `message`, and a class for its status: `BadRequestError`, `AuthenticationError`,
`PermissionDeniedError` (and `PlanLimitError` with the `limit` hit), `NotFoundError`,
`ConflictError`, `PayloadTooLargeError`, `RateLimitError` and `ServerError`.
`ConnectionFailedError` and `RequestTimeoutError` mean no answer came.

Reads, and changes that are safe to repeat, are tried again after a failure on our side or a lost
connection (twice by default, `max_retries`), and after a 429 once its `Retry-After` has passed. Any
other change is never sent twice: after a 429 it raises `RateLimitError`. Nor is a deploy: when
its answer doesn't arrive, or after a 429, the client looks for the version made of what it sent.

The client is synchronous. In async code, run a call with `asyncio.to_thread`.

## Licence

Apache-2.0.
