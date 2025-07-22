# Multi-Agent Development Workflow

This guide explains how to use multiple specialized AI agents to develop features from requirements to deployment.

## Overview

The multi-agent workflow breaks development into specialized roles:
- **Architect** - Technical design from requirements
- **Planner** - Task breakdown and scheduling  
- **Developer** - Implementation of tasks
- **Tester** - Quality assurance
- **Docs Agent** - Documentation maintenance
- **PM** - Progress tracking and coordination

## Workflow Stages

### 1. Requirements Definition

**Start with a PRD** in `docs/product/`:
- Write manually or generate with ChatPRD
- Define what to build, not how
- Include success criteria
- Specify constraints

### 2. Architecture Design

**Invoke Architect Agent**:
```
/architect docs/product/feature-name.md
```

The architect will:
- Analyze requirements
- Review existing system
- Design technical approach
- Output to `scratch/feature-name-architecture.md`

### 3. Task Planning

**Invoke Planner Agent**:
```
/planner feature-name
```

The planner will:
- Read PRD and architecture
- Create task files in `tasks/todo/`
- Define workstreams (frontend, backend, etc.)
- Set dependencies

### 4. Parallel Development

**Multiple Developer Agents** work simultaneously:
```
/developer frontend
/developer backend
/developer database
```

Each developer:
- Claims tasks from their workstream
- Moves task to `in-progress/`
- Implements code and tests
- Moves to `done/` when complete

### 5. Quality Assurance

**Invoke Testing Agent**:
```
/tester
```

The tester will:
- Review completed tasks
- Run comprehensive tests
- Move failed tasks back to `todo/`
- Validate acceptance criteria

### 6. Documentation Updates

**Invoke Docs Agent**:
```
/docs-agent
```

The docs agent will:
- Review code changes
- Update technical documentation
- Maintain changelog
- Ensure docs stay current

### 7. Progress Management

**Invoke PM Agent**:
```
/pm status
```

The PM will:
- Generate progress reports
- Manage task dependencies
- Archive old completed work
- Identify blockers

## Example: Building User Authentication

### Step 1: Create PRD
Create `docs/product/user-authentication.md`:
```markdown
# PRD: User Authentication

## Overview
Add user login/registration with email and password...
```

### Step 2: Design Architecture
```
/architect docs/product/user-authentication.md
```
Creates `scratch/user-authentication-architecture.md`

### Step 3: Generate Tasks
```
/planner user-authentication
```
Creates tasks:
- `tasks/todo/frontend-login-form.md`
- `tasks/todo/frontend-registration-form.md`
- `tasks/todo/backend-auth-endpoints.md`
- `tasks/todo/database-user-schema.md`

### Step 4: Parallel Implementation
```
# Terminal 1
/developer frontend

# Terminal 2  
/developer backend

# Terminal 3
/developer database
```

### Step 5: Test Everything
```
/tester
```

### Step 6: Update Docs
```
/docs-agent
```

## Task File Lifecycle

```
todo/ → in-progress/ → done/ → archive/
```

1. **Created**: Planner adds to `todo/`
2. **Claimed**: Developer moves to `in-progress/`
3. **Completed**: Developer moves to `done/`
4. **Archived**: PM moves old tasks to `archive/`

## Best Practices

### For Humans
- Write clear PRDs with specific requirements
- Review architect output before planning
- Monitor task progress regularly
- Merge completed work incrementally

### For Agents
- One task at a time per agent
- Check dependencies before starting
- Update documentation immediately
- Test thoroughly before marking done

## Advantages

1. **Parallel Execution** - Multiple agents work simultaneously
2. **Clear Ownership** - Each task has one assignee
3. **Dependency Management** - Automatic blocking of dependent work
4. **Progress Visibility** - Easy to see what's in flight
5. **Quality Gates** - Testing before completion

## Troubleshooting

### Common Issues

**Tasks stuck in progress**:
- Check if agent encountered errors
- Review task requirements clarity
- Consider breaking into smaller tasks

**Dependency deadlock**:
- Review dependency chain
- Check if prerequisite tasks are done
- PM agent can help identify cycles

**Test failures**:
- Review failure notes in task file
- Check acceptance criteria clarity
- Ensure test environment is correct

## Command Reference

- `/architect [prd-file]` - Design technical solution
- `/planner [feature]` - Create task breakdown
- `/developer [workstream]` - Implement tasks
- `/tester` - Validate completed work
- `/docs-agent` - Update documentation
- `/pm status` - Get progress report
- `/pm archive` - Clean up old tasks