# AI tool disclosure

> **Team: review and complete this page before submitting.** It records what we know from the build sessions. Add anything team members did by hand that isn't listed here.

## Tools used

- **Claude Code (Anthropic, Claude Opus)**, an AI coding assistant running in the terminal with access to the repository.

## What was AI-assisted

- **Implementation plan and architecture.** The team supplied the Designathon design document, the prototype and the challenge booklet, and asked for an implementation plan. The AI proposed the stack, components, folder structure and build order; the team reviewed and approved the plan before any code was written (and kept the installable PWA approach from our own design rather than native apps).
- **Code.** Most of the source code was written by the AI under the team's direction: the rule checker, planner, API, database schema, seed loader, offline sync and all React screens. The screens port the CSS tokens and components of our Day 5 prototype so the build stays faithful to the design.
- **Tests and verification.** The AI wrote the unit and property tests and the API smoke test, ran them, and drove the real UI in a browser to check each screen against the prototype. Several bugs were found and fixed this way, for example a trip-row matching bug that corrupted two-vehicle moves, and a stale-server issue.
- **Data analysis.** The AI profiled the supplied datasets to choose the demo day (a real pre-Vesak day from `deliveries_train.csv`), the workshop vehicles (the booklet's peak-day list) and the late-risk model (delay distributions from `route_legs_train.csv`).
- **Documentation.** This README and the docs folder were drafted by the AI and reviewed by the team.

## What was not AI-assisted

- The **Day 5 design**: problem framing, personas, screen flows, degradation scenarios, prioritisation and style guide came from our Designathon submission. Per its own AI disclosure, some lo-fi screens were hand-made and turned into the hi-fi prototype with AI help.
- **Product decisions and approvals**: approving the plan, choosing the PWA approach, accepting or rejecting changes.
- *(Team: add manual coding, testing on real phones, deployment, demo video recording and editing.)*

## How we used the tools

The AI worked from our design document as the specification and produced a written plan, which we approved before implementation. It then built incrementally: rules and planner first, with tests, then the API (checked end to end with a scripted walkthrough), then the UI (checked visually in a browser at phone and desktop sizes), then Docker. Each team member remained responsible for reviewing the output. No dataset content was sent anywhere except to the AI assistant during development.
