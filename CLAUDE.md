@AGENTS.md

Spec-driven: any feature, screen or behaviour change goes through an OpenSpec
proposal (`/opsx:propose`) before implementation. Proposing and applying are
separate turns. Bug fixes, typos and dependency bumps do not need a proposal.

Before marking anything done: `pnpm run ci:quality`, and report the real result.
