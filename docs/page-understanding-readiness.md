# v0.1 private-demo MVP readiness

Implementation and mocked verification do not authorize deployment or real
Gemini calls. Use this record before a separately approved live demo. The
[live Gemini runbook](gemini-live-runbook.md) walks through checking each item,
the first live request, and turning it off again. No private
keys, billing identifiers or actual browsing content belong in this file.

| Item | Current status | Evidence to record before live use |
| --- | --- | --- |
| Gemini project/model availability and image support | Unverified for this account | Selected model and supported token settings; documentation date |
| Applicable paid/unpaid data-use terms and location | Unverified for this account | Applicable terms and project billing classification |
| Developer-owned API logging and dataset sharing | Unverified for this account | Confirm disabled; no shared datasets/payload-capturing intermediary |
| Abuse-monitoring retention / approved exception | Standard policy reviewed; account exception unverified | Explain actual policy to demo participants; no zero-retention promise |
| $60 Gemini credits | User-reported, unverified | Remaining balance, expiry, applicable project/services |
| Auto-reload believed off | Unverified | Actual auto-reload setting and paid fallback behavior |
| Billing/quota ceiling | Unverified | Quotas, budget alerts, credit exhaustion behavior; budgets/limits are not a globally exact cap |
| Who may call the server | Local only: the pinned Iris extension origin on the loopback address | Before any deployment, provision operator-issued 15-minute tokens per user and require TLS |
| Stable extension ID | Pinned in the manifest | `EXTENSION_ORIGIN` matches `chrome-extension://bohipliohnmknfglnkhglngbmpiahdcn` |
| Chrome capture on demo machine | Manual check pending | Public pages: zoom/DPR, sensitive fields, races, cancellation, restricted/incognito blocking |
| Cloudflare configuration | Local runtime tested; not deployed | Secrets server-side; no payload logging/tracing/caching/queues; No database bindings; understand per-instance/resetting limits; optional gateway host permission |

Google policy reviewed on 2026-10-09:

- [Gemini terms](https://ai.google.dev/gemini-api/terms): paid/unpaid data handling
  differs; verify which applies to the actual project.
- [Abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies): describes
  55-day retention of prompts, context and outputs for enforcement, with possible
  authorized review. Iris's memory-only processing does not change this.
- [Developer-owned logging and sharing](https://ai.google.dev/gemini-api/docs/logs-policy):
  logging is a separate opt-in feature; dataset sharing can permit model
  improvement/training. Verify project settings rather than infer them from credits.

Keep the default feature and content gates disabled until the Google account
checks are recorded. Page understanding has no offline or placeholder mode: every
request goes to real Gemini, so test on public pages with no personal information
and review actual usage afterwards.

Future work: accessible confirmation/action state machine, ElevenLabs tools,
broader iframe/custom-control support, stronger capture consistency, public
identity onboarding, and a globally exact spending cap. Every future click must
have an Iris-issued confirmation bound to the current document and target.
