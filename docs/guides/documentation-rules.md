# Documentation Rules

This guide establishes the documentation standards and practices for maintaining accurate, up-to-date project documentation in a multi-agent development environment.

## Core Principles

### 1. Documentation-First Development
- **Write docs before code** - PRDs define what to build
- **Update docs with code** - Changes must be reflected immediately
- **Review docs like code** - Documentation is part of the deliverable

### 2. Single Source of Truth
- **docs/** directory is canonical
- **No duplicate information** - Link, don't copy
- **Version control everything** - Track all changes

### 3. Continuous Synchronization
- **Real-time updates** - Docs change when code changes
- **Automated checks** - CI validates documentation
- **Agent responsibility** - Docs Agent maintains sync

## Documentation Structure

```
docs/
├── product/                 # Product requirements
├── tech/                # Technical documentation
├── guides/              # How-to guides
├── CHANGELOG.md         # User-facing changes
├── INDEX.md            # Navigation hub
├── RULES.md            # Development rules
└── system-overview.md  # Architecture
```

## Documentation Types

### Product Requirements (PRDs)
- **Location**: `docs/product/`
- **Purpose**: Define what to build
- **Maintained by**: Product owners, humans
- **Updated when**: Requirements change

### Technical Documentation
- **Location**: `docs/tech/`
- **Purpose**: How it's built
- **Maintained by**: Docs Agent, developers
- **Updated when**: Implementation changes

### Guides
- **Location**: `docs/guides/`
- **Purpose**: How to use/develop
- **Maintained by**: Docs Agent, team leads
- **Updated when**: Processes change

### Architecture
- **Location**: `docs/system-overview.md`
- **Purpose**: System design and structure
- **Maintained by**: Architect Agent, Docs Agent
- **Updated when**: Architecture evolves

## Update Triggers

### Code Changes Requiring Doc Updates

| Change Type | Documentation to Update |
|------------|------------------------|
| New API endpoint | `tech/api-reference.md` |
| Schema change | `tech/database-reference.md` |
| New component | `system-overview.md` |
| Configuration change | Setup guides |
| Breaking change | `CHANGELOG.md` + migration guide |
| New feature | PRD status, user guides |

### Automatic Documentation

The Docs Agent monitors:
1. Completed tasks in `tasks/done/`
2. Code commits referencing tasks
3. API changes
4. Schema modifications
5. Configuration updates

## Documentation Standards

### Writing Style
- **Clear and concise** - Avoid jargon
- **Active voice** - "The system sends..." not "Data is sent..."
- **Present tense** - Describe current state
- **Examples included** - Show, don't just tell

### Formatting
- **Markdown** - All docs in markdown
- **Headings** - Logical hierarchy
- **Code blocks** - Syntax highlighted
- **Tables** - For structured data
- **Diagrams** - Where helpful (Mermaid preferred)

### Code Examples
```javascript
// Good: Includes context and explanation
// Authenticate user before accessing protected routes
const user = await authenticateUser(token);
if (!user) {
  throw new UnauthorizedError('Invalid token');
}
```

## Versioning

### Document Versions
- Track major changes in frontmatter
- Include revision history for PRDs
- Note breaking changes prominently
- Archive old versions when needed

### API Versioning
```markdown
## API v2 (Current)
[Current documentation]

## API v1 (Deprecated)
[Link to archived docs]
```

## Cross-References

### Internal Links
- Use relative paths
- Link to sections with anchors
- Validate links in CI
- Update when moving files

### External Links
- Pin to specific versions
- Note last verified date
- Include archive.org backup
- Check periodically

## Changelog Management

### Entry Format
```markdown
## [1.2.0] - 2025-01-20

### Added
- New user authentication system
- API endpoint for profile updates

### Changed
- Improved search performance

### Fixed
- Memory leak in background jobs

### Breaking Changes
- Removed deprecated /api/v1/users endpoint
```

## Review Process

### Documentation Review Checklist
- [ ] Accurate and complete
- [ ] Follows style guide
- [ ] Examples work
- [ ] Links valid
- [ ] No sensitive data
- [ ] Properly formatted

### When to Review
- With code PRs
- After major features
- During refactoring
- Quarterly audit

## CI/CD Integration

### Pre-commit Checks
```yaml
- name: Check Documentation
  rules:
    - If src/ changes, docs/ must change
    - All internal links must be valid
    - Code examples must be syntactically correct
```

### Documentation Coverage
```yaml
- name: API Documentation Coverage
  check:
    - All public endpoints documented
    - All parameters described
    - Examples for each endpoint
```

## Scratch Folder Rules

### Purpose
- Temporary brainstorming
- Architecture exploration
- Research notes
- Meeting notes

### Lifecycle
1. Created during planning
2. **Never modified** after creation
3. Archived after feature complete
4. Not included in doc coverage

### Structure
```
scratch/
├── feature-name-architecture.md    # Architect output
├── feature-name-research.md        # Research notes
└── archive/                        # Old scratches
    └── 2025-01/
```

## Documentation Debt

### Identifying Debt
- Outdated examples
- Missing documentation
- Incorrect information
- Broken links

### Managing Debt
1. Track in task system
2. Prioritize by impact
3. Address incrementally
4. Prevent with automation

## Best Practices

### For Humans
1. Write docs as you design
2. Review docs before implementing
3. Update immediately when changing code
4. Think about the reader

### For Agents
1. Check existing docs before writing
2. Maintain consistent style
3. Update all affected documents
4. Preserve existing structure
5. Add to changelog

## Common Pitfalls

### Avoid
- Documentation lag
- Duplicate information  
- Outdated examples
- Missing context
- Overly technical language

### Instead
- Update in same PR
- Link to source
- Test examples
- Explain why
- Write for users

## Metrics

### Documentation Health
- Coverage percentage
- Update frequency
- Link validity
- Example accuracy
- Search effectiveness

### Tracking
- Documentation tasks in system
- Update frequency by section
- Time since last review
- User feedback scores