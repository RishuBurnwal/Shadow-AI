# Shadow AI — Multi-API-Key Rotation Design — File 5 of 6

**Read after:** File 4 (STT fallback) — this applies the exact same "try A, on failure try B, then C" philosophy to your LLM answer-provider keys instead of STT engines. **Then go to:** File 6 (Enhancements & Roadmap) — the last file, once everything above is implemented and stable.

---

## The "#" disable convention already works — no code change needed for that part

Confirmed in `src/utils/providerEnv.js`'s `parseEnv()`:

```js
if (!line || line.startsWith('#')) continue;
```

Any `.env` line starting with `#` (after trimming) is already skipped. Today, for a single-key provider, this already works:

```env
GROQ_API_KEY=gsk_your_real_key_here
# GROQ_API_KEY=gsk_a_backup_key_you_dont_want_active_right_now
```

**What's actually missing is multiple _simultaneous_ keys per provider** — right now each provider has exactly one env var slot, so there's nowhere to put a second active key. That's the real feature to build.

## Proposed format — numbered suffixes, fully backward compatible

```env
# Groq — three accounts, middle one disabled
GROQ_API_KEY_1=gsk_account_one_key
#GROQ_API_KEY_2=gsk_account_two_key_currently_disabled
GROQ_API_KEY_3=gsk_account_three_key

# Single-key providers keep working exactly as they do today
OPENROUTER_API_KEY=sk-or-your-key
```

- `PROVIDER_API_KEY` (no suffix) keeps working unchanged — nobody's existing setup breaks.
- `PROVIDER_API_KEY_1` through `_N` add more keys for the same provider, tried in numeric order.
- If both the unsuffixed key and numbered keys exist, treat the unsuffixed one as an implicit `_0`, tried first.
- A `#`-commented numbered key is invisible to the parser exactly like today — that's how you "remove" a key without deleting it.

## Fallback logic — load-time vs. runtime, same distinction as File 4

`providerRouter.js` already classifies failures into `credits_exhausted`, `rate_limited`, `auth_error`, `server_error`, `network_error` (`classifyProviderFailure()`). This maps directly onto the load-vs-runtime split from File 4:

- **`credits_exhausted`, `rate_limited`, `auth_error` are per-key problems** — this specific account is out of quota, throttled, or has a bad/revoked key. The right response is: **try the next key for the same provider** before giving up on the provider entirely.
- **`server_error`, `network_error` are provider-wide or transient** — a different key for the same request won't help. These should keep falling through to the _existing_ cross-provider fallback in `streamWithFallback()`, unchanged — don't rotate keys for these.
- Only fall through to the _next provider_ once **every key** for the current provider has been tried and failed with a per-key-class error.

## Concrete implementation

1. **`providerEnv.js`**: change key resolution from "read one env var" to "read the base `envKey`, then scan `${envKey}_1`, `${envKey}_2`, ... skipping gaps rather than stopping at the first missing index" (so commenting out the middle key with `#` doesn't accidentally hide every key after it).
2. **`providerRouter.js`**: `getConfiguredProviders()` returns `{ ...definition, apiKeys: [...], activeKeyIndex: 0 }` instead of a single key. Add a `rotateKey(provider)` step inside `streamWithFallback()`'s error handling, triggered only on the three per-key failure classes above.
3. **Keep `activeKeyIndex` in memory only** (not persisted to disk) — resets to key 1 on app restart. Simpler than adding a migration path to `storage.js`, and avoids getting stuck on a previously-failed key across restarts if it's since been fixed.
4. **Surface it to the user when it matters**: if _every_ key for _every_ provider in the fallback chain is exhausted, don't fail silently — this is the one gap the earlier draft of this design left open (see self-audit below). Surface a clear status message ("all configured providers are rate-limited or out of credits") the same way `localai.js` already surfaces status text for other states, so the user knows to add a key or wait, instead of wondering why nothing is responding.

## Settings UI

Two options, same trade-off as before: **(a)** `.env`-file-only (zero UI work, matches how this feature was requested, good first version), or **(b)** an in-app "add another key" control per provider that writes `PROVIDER_API_KEY_2` etc. via the existing `replaceEnvValue()` helper in `providerEnv.js`. Ship (a) first; only build (b) if real users ask for it.

## Tests to add (extend `provider-env.test.js` and `provider-router.test.js`)

- Multiple numbered keys are discovered in order; a gap (`_1` and `_3` present, `_2` missing/commented) is skipped, not treated as a stopping point.
- A commented-out numbered key is excluded, same as today's single-key behavior.
- A simulated `rate_limited` failure on key 1 triggers a retry with key 2 for the _same_ provider before falling through to the next provider.
- A simulated `network_error` does **not** trigger key rotation — falls through to the next provider per existing behavior, unchanged.
- **New**: when every key for every configured provider fails with a per-key error class, a single clear status message is surfaced to the renderer exactly once (not spammed per failed key).
- A provider with only the unsuffixed key still works exactly as today, with zero numbered keys present.

---

## Implementation update (2026-08-12)

Unsuffixed and numbered keys are discovered in numeric order while allowing gaps. Quota, rate-limit, and authentication failures rotate within the same provider; network/server failures move directly to the next provider. The active successful key is remembered only in process memory, all-key exhaustion produces one clear error, and tests verify that secrets do not leak through results or notifications.

## Self-audit of the previous version of this file

- The earlier draft designed the rotation logic but never specified what happens when _every_ key everywhere is exhausted — that's a silent-failure gap identical in spirit to Manual mode's silent dead-end in File 2's Bug 1. Fixed above: it must be surfaced to the user, not left to time out invisibly.
- The earlier draft presented this as a standalone feature; this version explicitly ties it to File 4's fallback-chain language (load-time vs. runtime failure handling) so the two resilience features in this app — STT engine selection and LLM provider/key selection — follow one consistent mental model instead of two different ad hoc ones.

Continue to **File 6 — Enhancements and Roadmap** (the last file).
