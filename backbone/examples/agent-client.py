#!/usr/bin/env python3
"""
agent-client.py — the hub's ready-made remote-agent client. Python 3 standard library ONLY (no pip).

This is the "impossible to get wrong" path: a remote/cloud box runs it (usually via the one-line
bootstrap the hub serves) and it implements the whole agent protocol correctly — a PERSISTENT process
that holds one WebSocket, answers the hub's self-test, heartbeats, reconnects, and bridges every user
message to your model CLI. You only supply MODEL_CMD; the client does the rest.

  python3 agent-client.py --hub ws://HOST:8124 --name Hermes --cmd 'claude -p'

MODEL_CMD contract (same as the hub's local "chat-only" agent): the client appends the user's message
as the LAST argument and reads the reply from stdout. e.g. `claude -p`  →  `claude -p "<message>"`.

Self-check (no network):  python3 agent-client.py --selfcheck
"""
import sys, os, ssl, json, time, base64, hashlib, socket, struct, shlex, shutil, threading, subprocess
from urllib.parse import urlparse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC 6455


# ----------------------------- WebSocket framing (stdlib) -----------------------------
def _encode_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """One masked client→server frame (FIN=1). Clients MUST mask (RFC 6455 §5.3)."""
    b0 = 0x80 | opcode
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", b0, 0x80 | n)
    elif n < 65536:
        header = struct.pack("!BBH", b0, 0x80 | 126, n)
    else:
        header = struct.pack("!BBQ", b0, 0x80 | 127, n)
    mask = os.urandom(4)
    masked = bytes(payload[i] ^ mask[i % 4] for i in range(n))
    return header + mask + masked


def _decode_for_selfcheck(frame: bytes) -> tuple[int, bytes]:
    """Inverse of _encode_frame, used only by --selfcheck to prove the codec round-trips."""
    b0, b1 = frame[0], frame[1]
    opcode = b0 & 0x0F
    masked = b1 & 0x80
    n = b1 & 0x7F
    off = 2
    if n == 126:
        n = struct.unpack_from("!H", frame, off)[0]; off += 2
    elif n == 127:
        n = struct.unpack_from("!Q", frame, off)[0]; off += 8
    mask = b""
    if masked:
        mask = frame[off:off + 4]; off += 4
    data = bytearray(frame[off:off + n])
    if masked:
        for i in range(n):
            data[i] ^= mask[i % 4]
    return opcode, bytes(data)


class WSClient:
    """Minimal RFC 6455 client: handshake + text frames + ping/pong/close. Thread-safe send."""

    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buf = b""
        self.send_lock = threading.Lock()
        self.closed = False

    # -- handshake --
    @classmethod
    def connect(cls, url: str, timeout: float = 20.0) -> "WSClient":
        u = urlparse(url)
        secure = u.scheme == "wss"
        host = u.hostname or "127.0.0.1"
        port = u.port or (443 if secure else 80)
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
        raw = socket.create_connection((host, port), timeout=timeout)
        if secure:
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        raw.sendall(req.encode())
        self = cls(raw)
        head = self._read_until(b"\r\n\r\n")
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if "101" not in status:
            raise ConnectionError(f"hub did not accept the WebSocket upgrade: {status!r}")
        expect = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        if expect.lower() not in head.decode(errors="replace").lower():
            # Non-fatal: some proxies rewrite headers. We warn but keep going.
            sys.stderr.write("warning: Sec-WebSocket-Accept mismatch (continuing)\n")
        # The connect/handshake used a finite timeout. Clear it now so recv() BLOCKS on an idle socket
        # instead of raising socket.timeout every `timeout`s — that false "disconnect" is what caused an
        # infinite reconnect loop when the hub had nothing to send. A genuinely dead peer is caught by
        # TCP keepalive + our app-level heartbeat (whose send fails and tears the connection down).
        raw.settimeout(None)
        try: raw.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        except OSError: pass
        return self

    # -- low-level reads --
    def _recv_some(self) -> None:
        chunk = self.sock.recv(65536)
        if not chunk:
            raise ConnectionError("socket closed by hub")
        self.buf += chunk

    def _read_until(self, sep: bytes) -> bytes:
        while sep not in self.buf:
            self._recv_some()
        head, _, rest = self.buf.partition(sep)
        self.buf = rest
        return head + sep

    def _read_exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            self._recv_some()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    # -- frame I/O --
    def send_text(self, text: str) -> None:
        with self.send_lock:
            self.sock.sendall(_encode_frame(text.encode(), 0x1))

    def _send_control(self, opcode: int, payload: bytes = b"") -> None:
        with self.send_lock:
            self.sock.sendall(_encode_frame(payload, opcode))

    def recv_text(self):
        """Return the next text message, or None when the connection closes. Handles ping/pong/frag."""
        data = b""
        op = None
        while True:
            b0, b1 = self._read_exact(2)
            fin = b0 & 0x80
            opcode = b0 & 0x0F
            masked = b1 & 0x80
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else b""
            payload = bytearray(self._read_exact(n))
            if masked:
                for i in range(n):
                    payload[i] ^= mask[i % 4]
            payload = bytes(payload)
            if opcode == 0x8:        # close
                self.close()
                return None
            if opcode == 0x9:        # ping → pong (control frames may interleave fragments — don't touch op/data)
                self._send_control(0xA, payload)
                continue
            if opcode == 0xA:        # pong
                continue
            if opcode in (0x1, 0x2): # start of a text/binary message
                op = opcode; data = payload
            elif opcode == 0x0:      # continuation
                if op is None:       # stray continuation with no start frame — malformed; ignore
                    continue
                data += payload
            else:                    # unknown non-control opcode — ignore
                continue
            if fin:
                if op is None:       # FIN with nothing accumulated — ignore, keep reading
                    continue
                text = data.decode(errors="replace") if op == 0x1 else ""
                op = None; data = b""  # reset for the next message
                return text

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self._send_control(0x8)
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


# ----------------------------- the agent -----------------------------
def _reply(p) -> str:
    return (p.stdout or "").strip() or (p.stderr or "").strip() or "(no reply)"


def _model_env() -> dict:
    """Env for the model command, with PATH augmented by the common user-local bin dirs that a non-login
    subprocess otherwise misses (~/.local/bin, ~/bin, /usr/local/bin) — where pip --user / npm / pipx /
    cargo tools land. This makes a bare MODEL_CMD like 'hermes -z' resolve even though ~/.local/bin is only
    on PATH in the interactive shell rc, not inherited here."""
    env = dict(os.environ)
    home = os.path.expanduser("~")
    extra = [os.path.join(home, ".local", "bin"), os.path.join(home, "bin"), "/usr/local/bin"]
    cur = env.get("PATH", "")
    env["PATH"] = os.pathsep.join([d for d in extra if d] + ([cur] if cur else []))
    return env


def model_cmd_missing(cmd: str) -> str:
    """Why MODEL_CMD can't run, with the fix — or "" if it resolves (augmented PATH or the login shell).
    The #1 trap: MODEL_CMD is a shell alias/function or a tool on a PATH set only in the interactive shell
    rc — none of which a background subprocess inherits. So we check the way we'll actually run it."""
    bin0 = (shlex.split(cmd)[:1] or [""])[0]
    if not bin0:
        return "MODEL_CMD is empty — set it to the CLI that runs your model."
    if shutil.which(bin0, path=_model_env()["PATH"]):
        return ""  # a real binary on PATH (incl. ~/.local/bin etc.) — direct exec will find it
    shell = os.environ.get("SHELL") or "/bin/sh"
    try:  # maybe it's on the PATH your login shell sets (version managers, ~/.local/bin, etc.)
        r = subprocess.run([shell, "-lc", f"command -v {shlex.quote(bin0)}"], capture_output=True, text=True, timeout=15)
        if r.returncode == 0 and r.stdout.strip():
            return ""
    except Exception:
        pass
    return (f'I can\'t run MODEL_CMD "{bin0}". On the box run  command -v {bin0}  (or  type {bin0}): '
            f'if it prints a path, relaunch me with MODEL_CMD set to that ABSOLUTE path '
            f'(e.g. MODEL_CMD="/full/path/{bin0} <flags>"). If it says "aliased" or "function", a '
            f'background process can\'t use it — point MODEL_CMD at the real binary it wraps.')


def run_model(cmd: str, prompt: str) -> str:
    """Run MODEL_CMD with the user's message as the LAST arg; stdout is the reply.
    Tries a direct exec first (fast, no shell, no injection). If the binary isn't on the inherited PATH,
    falls back to the user's LOGIN shell so a tool installed on the shell-rc PATH still resolves — the
    prompt is passed as $1 (positional, never interpolated), so the user's message can't inject.
    ponytail: one turn at a time, buffered, capped by the 600s timeout — same serial model as local agents."""
    parts = shlex.split(cmd)
    if not parts:
        return "(no model command configured — set MODEL_CMD)"
    env = _model_env()
    try:
        return _reply(subprocess.run(parts + [prompt], capture_output=True, text=True, timeout=600, env=env))
    except subprocess.TimeoutExpired:
        return "(the model took too long and was stopped)"
    except FileNotFoundError:
        pass  # not on the (augmented) PATH — try the login shell below
    shell = os.environ.get("SHELL") or "/bin/sh"
    try:
        p = subprocess.run([shell, "-lc", f'{cmd} "$1"', shell, prompt], capture_output=True, text=True, timeout=600, env=env)
        if not (p.returncode == 127 and "not found" in (p.stderr or "").lower()):
            return _reply(p)
    except subprocess.TimeoutExpired:
        return "(the model took too long and was stopped)"
    except Exception:
        pass
    return "⚠️ " + (model_cmd_missing(cmd) or f'Couldn\'t run "{parts[0]}".')


def serve(hub: str, name: str, cmd: str) -> None:
    backoff = 1
    while True:
        try:
            ws = WSClient.connect(hub)
        except Exception as e:
            sys.stderr.write(f"connect failed ({e}); retrying in {backoff}s\n")
            time.sleep(backoff); backoff = min(backoff * 2, 30); continue
        backoff = 1
        sys.stderr.write(f'connected to {hub} as "{name}"\n')
        ws.send_text(json.dumps({"t": "hello", "name": name}))

        # Startup probe: a wrong MODEL_CMD should be visible the instant we connect, not only on the first
        # message. Uses the same resolution as run_model (direct PATH + login shell), so it won't false-warn
        # on a tool that's only on the shell-rc PATH. selftest_ok still passes (the client IS alive), so this
        # complements the hub's check rather than duplicating it.
        problem = model_cmd_missing(cmd)
        if problem:
            warn = "⚠️ I connected, but " + problem
            sys.stderr.write(warn + "\n")
            ws.send_text(json.dumps({"t": "event", "topic": "assistant_message", "data": {"text": warn}}))

        stop = threading.Event()

        def heartbeat():
            while not stop.wait(15):
                try:
                    ws.send_text(json.dumps({"t": "heartbeat"}))
                except Exception:
                    # Send failed → the socket is dead. Close it so the blocking recv() in the main loop
                    # unblocks and we reconnect (recv has no timeout now, so this is how a dead peer is caught).
                    ws.close()
                    return
        threading.Thread(target=heartbeat, daemon=True).start()

        try:
            while True:
                raw = ws.recv_text()
                if raw is None:
                    break
                try:
                    m = json.loads(raw)
                except Exception:
                    continue
                t = m.get("t")
                if t == "selftest":
                    ws.send_text(json.dumps({"t": "selftest_ok", "token": m.get("token")}))
                elif t == "diag":
                    sys.stderr.write(f"hub diagnostic: {m.get('problem')}\n  remedy: {m.get('remedy')}\n")
                elif t == "user":
                    text = str(m.get("text", ""))
                    ask_id = m.get("askId")   # set when this is a DELEGATED task — must be echoed back so the hub correlates the reply (else it times out)
                    files = m.get("files") or []
                    for f in files:
                        text += f"\n[Attached file: {f.get('name')} saved at {f.get('path')}]"
                    if not text.strip():
                        continue
                    ws.send_text(json.dumps({"t": "event", "topic": "agent_status", "data": {"label": "Thinking…"}}))
                    reply = run_model(cmd, text)
                    data = {"text": reply}
                    if ask_id is not None:
                        data["askId"] = ask_id
                    ws.send_text(json.dumps({"t": "event", "topic": "assistant_message", "data": data}))
                    ws.send_text(json.dumps({"t": "event", "topic": "agent_status", "data": {"label": "Ready", "ready": True}}))
                # ready/catalog/result: nothing to do for a chat bridge.
        except Exception as e:
            sys.stderr.write(f"connection error: {e}\n")
        finally:
            stop.set(); ws.close()
        sys.stderr.write("disconnected; reconnecting…\n")
        time.sleep(backoff)


def selfcheck() -> int:
    """Prove the frame codec round-trips across the 7/16/64-bit length boundaries. No network."""
    for payload in [b"", b"hi", b"x" * 200, b"y" * 70000]:
        op, back = _decode_for_selfcheck(_encode_frame(payload, 0x1))
        assert op == 0x1, f"opcode {op}"
        assert back == payload, f"roundtrip failed at len {len(payload)}"
    # masking must actually change the bytes on the wire (so a non-empty payload isn't sent in clear)
    frame = _encode_frame(b"A" * 16, 0x1)
    assert b"A" * 16 not in frame, "payload not masked"
    print("selfcheck OK")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--selfcheck" in args:
        return selfcheck()

    def opt(flag, env, default=None):
        if flag in args:
            return args[args.index(flag) + 1]
        return os.environ.get(env, default)

    hub = opt("--hub", "HUB", "ws://127.0.0.1:8124")
    name = opt("--name", "AGENT_NAME", "Hermes")
    cmd = opt("--cmd", "MODEL_CMD", "")
    if not cmd:
        sys.stderr.write("error: no model command. Pass --cmd 'claude -p' or set MODEL_CMD.\n")
        return 1
    try:
        serve(hub, name, cmd)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
