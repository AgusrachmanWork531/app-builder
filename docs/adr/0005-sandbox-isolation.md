# ADR 0005: Sandbox isolation behind a provider interface

- Status: Accepted
- Date: 2026-11-23

## Context

The product will build and test AI-generated code, which must be treated as hostile.
Running it in the API or worker process — or in a plain Docker container with host
access — would expose secrets, the metadata database and the host.

## Decision

All file and command operations on generated code go through `SandboxProvider` /
`SandboxWorkspace` (one workspace per build attempt). The only shipped implementation,
`MockSandboxProvider`, reads/writes files with traversal, symlink and size guards and
**refuses command execution**. Real execution is disabled until a hardened provider
(microVM or gVisor, default-deny egress, resource limits, no platform secrets) is
implemented and reviewed. Collected artifacts are accessed through `ArtifactStore`.

## Consequences

- The MVP cannot build/run generated apps — by design, not by omission.
- Swapping in a real provider requires no workflow changes.
- Security requirements for that provider are documented in `docs/security/security.md`.
