# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [Phase 4]
### Added
- Per-address reputation tracking (fulfilled/late/breached counts) as issuer

## [Phase 3]
### Added
- `dispute()` — raise a dispute within 7-day window after attestation
- `resolve_dispute()` — arbitrator-only final resolution with re-dispute prevention

## [Phase 2]
### Added
- `attest()` — issuer/counterparty outcome attestation
- `is_overdue()` — helper for checking commitment deadline

## [Phase 1]
### Added
- `create_commitment()`, `get_commitment()` core lifecycle
- Soroban persistent storage with TTL management
