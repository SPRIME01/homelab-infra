# Contributing to Homelab Infrastructure

This document outlines the guidelines for contributing to this homelab infrastructure repository.

## Branching Strategy

We follow the GitFlow branching model:

- `main`: Production-ready code
- `develop`: Main development branch
- `feature/*`: New features
- `fix/*`: Bug fixes
- `release/*`: Release preparation
- `hotfix/*`: Emergency production fixes

### Branch Naming

- Features: `feature/add-k3s-cluster`
- Fixes: `fix/nginx-config-error`
- Releases: `release/v1.2.0`
- Hotfixes: `hotfix/security-patch`

## Commit Messages

We use Conventional Commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- chore: Maintenance
- refactor: Code restructuring
- test: Adding tests

Example:
```
feat(k3s): add initial cluster configuration

Added base k3s cluster setup with 3 nodes.
```

## Pull Request Process

1. Create branch from correct base (`develop` for features/fixes)
2. Update documentation as needed
3. Submit PR with clear description of changes
4. Ensure CI checks pass
5. Request review from maintainers

## Code Review Requirements

- Minimum one approval required
- All comments must be resolved
- CI checks must pass
- Documentation must be updated
- No merge conflicts

## Testing

- Test changes locally before pushing
- Include relevant test cases
- Verify existing tests pass

## Questions?

Open an issue for any questions about contributing.
