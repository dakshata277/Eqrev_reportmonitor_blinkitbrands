import sys
import json

# Force UTF-8 on stdio. Node writes the request JSON to our stdin as UTF-8;
# without this, Python on Windows decodes stdin using the ANSI code page
# (cp1252) and mangles any non-ASCII payload one mojibake level deeper before
# it is ever sent to the server.
try:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL_CFFI = True
except ImportError:
    import requests as fallback_requests
    HAS_CURL_CFFI = False

# Single long-lived session - keeps Cloudflare cookies (__cf_bm, __cfruid, etc.)
# alive across all requests, just like a real browser tab would.
if HAS_CURL_CFFI:
    session = cffi_requests.Session(impersonate="chrome124")
else:
    import requests as fallback_requests
    session = fallback_requests.Session()

# Track whether we've already done a warm-up GET against each origin
_warmed_origins = set()

def warm_origin(origin):
    """Do a one-time GET against the origin to collect Cloudflare cookies."""
    if not origin or origin in _warmed_origins:
        return
    try:
        session.get(origin, timeout=15)
    except Exception:
        pass
    _warmed_origins.add(origin)

def do_request(config):
    try:
        method = config.get("method", "get").lower()
        url = config.get("url")
        headers = config.get("headers", {})
        data = config.get("data")

        # Warm up the origin on first contact to get Cloudflare cookies
        origin = headers.get("origin", "")
        if origin:
            warm_origin(origin)

        proxy = config.get("proxy")  # optional http://user:pass@host:port

        if HAS_CURL_CFFI:
            res = session.request(
                method=method,
                url=url,
                headers=headers,
                json=data if method in ["post", "put", "patch"] else None,
                timeout=60,
                proxy=proxy if proxy else None,
            )
        else:
            proxies = {"http": proxy, "https": proxy} if proxy else None
            res = session.request(
                method=method,
                url=url,
                headers=headers,
                json=data if method in ["post", "put", "patch"] else None,
                timeout=60,
                proxies=proxies,
            )

        result = {
            "status": res.status_code,
            "body": res.text,
            "headers": dict(res.headers)
        }
        return result

    except Exception as e:
        return {"error": str(e)}

def main():
    """
    Persistent mode: read one JSON request per line from stdin,
    write one JSON response per line to stdout.
    The session (and its cookies) persist across all requests.
    """
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            config = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON: {e}"}), flush=True)
            continue

        result = do_request(config)
        print(json.dumps(result), flush=True)

if __name__ == "__main__":
    main()
