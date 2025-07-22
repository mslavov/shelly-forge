# Task Management Guide

This guide explains how the folder-based task management system enables parallel multi-agent development.

## System Overview

Tasks are managed through a simple folder structure:
```
tasks/
├── todo/         # Available work
├── in-progress/  # Active development
├── done/         # Completed tasks
└── archive/      # Historical tasks
```

## Task File Structure

Each task is a self-contained markdown file with:
- **Metadata** (YAML frontmatter)
- **Context** (links to requirements)
- **Subtasks** (checklist format)
- **Acceptance Criteria** (testable requirements)
- **Technical Notes** (implementation hints)

## Task Lifecycle

### 1. Creation (Planner → todo/)
```yaml
---
id: frontend-user-profile
workstream: frontend
dependencies: [backend-user-api]
created: 2025-01-18
---
```

### 2. Assignment (Developer → in-progress/)
```yaml
---
assigned_to: developer-agent-1
started: 2025-01-19
---
```

### 3. Completion (Developer → done/)
```yaml
---
completed: 2025-01-20
---
```

### 4. Archival (PM → archive/)
After 2 weeks, moved to `archive/2025-01/`

## Workstream Organization

Tasks are organized by technical area:

### Frontend
- UI components
- User interactions  
- State management
- Styling

### Backend
- API endpoints
- Business logic
- External integrations
- Data processing

### Database
- Schema design
- Migrations
- Query optimization
- Data integrity

### Infrastructure
- Deployment setup
- Monitoring
- Configuration
- Security

## Dependency Management

### Declaring Dependencies
```yaml
dependencies: [task-id-1, task-id-2]
```

### Dependency Rules
1. Task can only start when all dependencies are in `done/`
2. PM agent enforces dependency constraints
3. Circular dependencies are prevented
4. Dependencies can span workstreams

### Example Dependency Chain
```
database-schema → backend-api → frontend-ui
```

## Parallel Execution

### How It Works
1. Multiple agents claim tasks from different workstreams
2. Each agent works independently
3. No conflicts since each task is a separate file
4. Dependencies ensure correct ordering

### Example Scenario
```
Agent 1: Works on frontend-login-form
Agent 2: Works on backend-auth-api
Agent 3: Works on database-user-table
```

## Task Sizing Guidelines

### Ideal Task Size
- **Duration**: 1-3 days of work
- **Scope**: Single deliverable
- **Testing**: Included in estimate
- **Documentation**: Part of completion

### When to Split Tasks
- Estimate exceeds 3 days
- Multiple unrelated changes
- Different skill sets required
- Can be parallelized

## File Naming Conventions

Format: `[workstream]-[feature]-[component].md`

### Examples
- `frontend-auth-login-form.md`
- `backend-auth-jwt-tokens.md`
- `database-auth-user-schema.md`
- `infra-auth-redis-setup.md`

## Task Metadata

### Required Fields
```yaml
id: unique-identifier
workstream: technical-area
dependencies: [list]
created: YYYY-MM-DD
```

### Status Fields
```yaml
assigned_to: agent-name
started: YYYY-MM-DD
completed: YYYY-MM-DD
```

### Optional Fields
```yaml
priority: high|medium|low
estimated_hours: number
tags: [list]
blocked_by: description
```

## Finding Tasks

### For Developers
1. Check `tasks/todo/` for available work
2. Filter by workstream
3. Verify dependencies are met
4. Claim by moving to `in-progress/`

### For PM
1. Count tasks in each folder
2. Check task age in `in-progress/`
3. Identify tasks ready to move
4. Generate progress metrics

## Best Practices

### Task Creation
- Clear, specific titles
- Comprehensive acceptance criteria
- Realistic estimates
- Explicit dependencies

### Task Execution
- One task at a time
- Update metadata when moving
- Complete all subtasks
- Test before marking done

### Task Maintenance
- Regular archival (monthly)
- Keep active folders clean
- Update stale metadata
- Document blockers

## Common Patterns

### Feature Development
```
1. Create feature PRD
2. Architect designs solution
3. Planner creates task set:
   - Database tasks
   - Backend tasks  
   - Frontend tasks
   - Test tasks
4. Parallel execution begins
```

### Bug Fix
```
1. Create bug report task
2. Assign to developer
3. Fix includes tests
4. Move to done when verified
```

### Refactoring
```
1. Create refactor plan
2. Break into safe chunks
3. Execute incrementally
4. Maintain test coverage
```

## Troubleshooting

### Task Stuck in Progress
- Check last update date
- Review blocker notes
- Consider splitting task
- Reassign if needed

### Dependency Deadlock
- Map dependency graph
- Find circular references
- Refactor task breakdown
- Create bridge tasks

### Lost Tasks
- Check archive by date
- Search by task ID
- Review git history
- Restore from backup

## Automation Opportunities

### GitHub Integration
- Create issues from tasks
- Update task status from PRs
- Link commits to tasks
- Automate archival

### Metrics Generation
- Task velocity
- Cycle time
- Workstream balance
- Dependency wait time

### Notifications
- New tasks available
- Dependencies cleared
- Tasks aging
- Blockers identified