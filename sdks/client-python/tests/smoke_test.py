"""What the published package has to do, run against the built artifact.

The rest of the suite imports `forculus_client` out of this directory, where every file exists
whether or not the build was told to ship it. This one runs from an installed wheel or sdist in an
environment that has never seen the source tree, so a module left out of the package or a missing
py.typed fails here rather than in someone else's `pip install`. It takes no test runner and needs
only what the package depends on:

    bash tests/smoke.sh dist/forculus_client-*.whl dist/forculus_client-*.tar.gz
"""

from __future__ import annotations

import importlib.metadata
import json
import sys
from pathlib import Path

import forculus_client
from forculus_client import Client, ConfigError, NotFoundError, Response

failures: list[str] = []


def check(what: str, ok: bool) -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)


def raises(what: str, error: type[BaseException], call) -> None:
    try:
        call()
    except error:
        check(what, True)
    except BaseException as other:  # noqa: BLE001 - the wrong error is the failure
        check(f"{what} (raised {type(other).__name__}: {other})", False)
    else:
        check(f"{what} (raised nothing)", False)


# It has to be the installed one. Run from inside sdks/client-python, or with it on PYTHONPATH, and
# the source tree next door wins and this proves nothing about the build.
project = Path(__file__).resolve().parent.parent
if project in Path(forculus_client.__file__).resolve().parents:
    print(f"FAIL imported the source tree at {forculus_client.__file__}, not the built package")
    print("     run this from outside sdks/client-python, with the artifact installed")
    sys.exit(1)
check("imported the built package, not the source tree", True)
check("exports its documented names", all(hasattr(forculus_client, name) for name in forculus_client.__all__))
check("knows its own version", forculus_client.__version__ == importlib.metadata.version("forculus-client"))
check("ships py.typed", (Path(forculus_client.__file__).parent / "py.typed").is_file())
check("depends on truststore alone", [r.split(">")[0].split("<")[0] for r in importlib.metadata.requires("forculus-client") or []] == ["truststore"])
import truststore  # noqa: E402 - only once it's known to be installed

from forculus_client._http import _tls  # noqa: E402

check("trusts what the operating system trusts", isinstance(_tls(), truststore.SSLContext))

seen: list[tuple[str, str, str]] = []


def transport(method, url, headers, body, timeout):  # type: ignore[no-untyped-def]
    seen.append((method, url, headers["authorization"]))
    if url.endswith("/v1/me"):
        return Response(200, {}, json.dumps({"email": "ada@example.com", "workspaces": []}).encode())
    return Response(404, {}, json.dumps({"error": "not_found", "message": "Not found."}).encode())


fc = Client("fcu_smoke", base_url="https://api.example.com", transport=transport)
check("asks the API who it is", fc.me()["email"] == "ada@example.com")
check("sends the token as a bearer", seen[0] == ("GET", "https://api.example.com/v1/me", "Bearer fcu_smoke"))
raises("raises a typed error", NotFoundError, lambda: fc.apps.get("acme", "nope"))
raises("refuses plain http to another machine", ConfigError, lambda: Client("fcu_smoke", base_url="http://example.com"))
raises("refuses a bypass token", ConfigError, lambda: Client("fcb_smoke"))

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("the package works")
