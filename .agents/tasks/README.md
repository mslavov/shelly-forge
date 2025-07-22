# Task Management System

This folder implements a file-based task management system that enables parallel multi-agent development.

## Folder Structure

```
tasks/
├── todo/         # Available tasks ready to be worked on
├── in-progress/  # Tasks currently being implemented
├── done/         # Completed tasks
└── archive/      # Old completed tasks (organized by month)
```

## How It Works

1. **Task Creation**: The Planner agent creates task files in `todo/`
2. **Task Assignment**: Developer agents move tasks to `in-progress/` when starting work
3. **Task Completion**: Finished tasks move to `done/`
4. **Archival**: PM agent periodically moves old done tasks to `archive/`

## Task File Format

Each task is a markdown file with YAML frontmatter:

```markdown
---
id: backend-user-auth
workstream: backend
dependencies: [database-user-schema]
estimated_hours: 8
assigned_to: null
created: 2025-01-18
started: null
completed: null
---

# Task Title

## Context
- PRD: [Link to Product Requirement]
- Architecture: [Link to technical design]

## Subtasks
- [ ] Implementation step 1
- [ ] Implementation step 2
- [ ] Write tests
- [ ] Update documentation

## Acceptance Criteria
- Clear success criteria
- Testable requirements
- Performance targets

## Technical Notes
- Implementation hints
- Suggested approaches
```

## Task Lifecycle

1. **Created** → File created in `todo/` with metadata
2. **Started** → Moved to `in-progress/`, update assigned_to and started date
3. **Completed** → Moved to `done/`, update completed date
4. **Archived** → After 2 weeks, moved to `archive/YYYY-MM/`

## Workstreams

Tasks are organized by workstream for parallel execution:
- **frontend** - UI components, user interactions
- **backend** - APIs, business logic, integrations  
- **database** - Schema, migrations, queries
- **infra** - Deployment, monitoring, configuration
- **testing** - Test suites, quality assurance

## Agent Interactions

- **Planner**: Creates tasks in `todo/` from PRDs
- **Developer**: Claims tasks by moving to `in-progress/`
- **Tester**: Validates tasks in `done/`
- **PM**: Monitors all folders, manages dependencies

## Dependency Management

- Tasks list their dependencies in frontmatter
- Tasks can only be started when dependencies are in `done/`
- PM agent enforces dependency rules

## Best Practices

1. **One task per file** - Each file represents a discrete deliverable
2. **Clear naming** - Use format: `[workstream]-[feature]-[component].md`
3. **Atomic commits** - Update task files when moving between folders
4. **Regular archival** - Keep active folders manageable