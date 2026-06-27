# Agent Orchestration

A hub has two **seats**: a *driver* (who gives instructions) and a *brain* (who answers). They are
symmetric. The phone is the usual driver; an **orchestrator agent** can occupy a driver seat too — so a
single agent you talk to can see your other agents and delegate work to them by strength.

## How it fits together

```mermaid
graph LR
  U([You · voice / chat]) -->|user_message · E2E relay| H[Hub]
  H <-->|:8124 brain seat| O[Orchestrator<br/>active brain]
  O -->|hub MCP · list_agents / ask_agent<br/>over :8123| H
  H -. POST /ask · askId .-> A[Worker A<br/>backend]
  H -. POST /ask · askId .-> B[Worker B<br/>UI / design]
  classDef o fill:#2d6cdf,color:#fff,stroke:#1b3e85;
  classDef w fill:#eef,stroke:#88a;
  class O o; class A,B w;
```

The orchestrator is just an agent that holds one extra tool — the `hub` MCP server. Workers never get
that tool, so they can't enumerate or drive each other: **the asymmetry is an opt-in grant, not an
ambient power.**

## A delegated task, step by step

```mermaid
sequenceDiagram
  autonumber
  participant P as Phone (you)
  participant H as Hub
  participant O as Orchestrator
  participant A as Worker A
  participant B as Worker B
  P->>H: user_message "plan & build X"
  H->>O: {t:user}  (no askId)
  O->>H: list_agents()  → A:backend, B:UI
  par delegate in parallel
    O->>H: ask_agent(A, subtask)  [POST /ask]
    H->>A: {t:user, text, askId₁}
  and
    O->>H: ask_agent(B, subtask)  [POST /ask]
    H->>B: {t:user, text, askId₂}
  end
  A-->>H: assistant_message {text, askId₁}
  B-->>H: assistant_message {text, askId₂}
  H-->>O: replies (matched by askId · quiet, no phone spam)
  O-->>H: assistant_message  (synthesis, no askId)
  H-->>P: one answer
```

## Topologies — same tool, different URL

```mermaid
graph TB
  subgraph single["Single hub (v1)"]
    direction LR
    p1([Phone]) --- h1[Hub]
    h1 --- o1[Orchestrator]
    h1 --- a1[A] & b1[B]
  end
  subgraph multi["Federated (increment)"]
    direction LR
    p2([Phone]) --- h0[Hub-0]
    h0 --- o2[Orchestrator]
    o2 -. hub MCP · Tailscale .-> h2[Hub-1 · headless]
    h2 --- a2[A] & b2[B]
  end
```

You start single-hub (no new infrastructure). To scale out you change a base URL in the orchestrator's
config — the contract (`list_agents` + `ask_agent`) is identical.

## Safety & correctness mechanisms

| Mechanism | What it protects against |
|-----------|--------------------------|
| **Opt-in tool grant** | Workers can't orchestrate each other — only an agent given the `hub` tool can. |
| **Loopback bind by default** (`PANEL_HOST`/`AGENT_HOST`) | The driver port isn't exposed to the LAN/public unless you opt in for federation. |
| **`askId` correlation** | A reply is matched to its exact subtask — a slow/timed-out worker's late answer can never cross-wire into another task. |
| **Quiet delegation** | A delegated sub-answer is routed only to the orchestrator, never broadcast into your chat. |
| **Per-worker serialization** | One turn in flight per worker — protects a CLI agent's single resumed session from corruption. |
| **Hop-count loop-breaker** (`X-Ask-Depth`) | Orchestrator→orchestrator cycles terminate instead of running away. |
| **Self-delegation guard** | On a phone-backed hub, the user-facing brain can't be asked to delegate to itself. |
| **Timeout + disconnect handling** | An ask always resolves — with the answer, a timeout, or a clean "disconnected" — never hangs. |

## Running one

```bash
# hub + two workers, each self-describing its strength:
pnpm panel
AGENT_NAME=Backend AGENT_DESC="SQL & backend APIs" pnpm agent:claude
AGENT_NAME=Design  AGENT_DESC="UI & copy"          pnpm agent:omp
# the orchestrator (active brain) that can delegate to them:
pnpm agent:orchestrator
```
