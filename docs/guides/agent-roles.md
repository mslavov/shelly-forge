# Agent Roles and Responsibilities

This guide details each agent's role in the multi-agent development workflow.

## Architect Agent

**Purpose**: Transform product requirements into technical designs

### When to Use
- After PRD is created
- Before implementation begins
- When evaluating technical approaches

### Responsibilities
- Analyze product requirements
- Research existing architecture
- Design technical solutions
- Document trade-offs
- Recommend implementation approach

### Inputs
- PRD from `docs/product/`
- Current system documentation
- Technical constraints

### Outputs
- Architecture document in `scratch/`
- Component designs
- Integration strategies
- Risk assessments

### Example
```
/architect docs/product/payment-integration.md
```

## Planner Agent

**Purpose**: Break down features into implementable tasks

### When to Use
- After architecture is approved
- To create work breakdown structure
- When organizing parallel work

### Responsibilities
- Read PRD and architecture docs
- Identify workstreams
- Create granular task files
- Define dependencies
- Estimate effort

### Inputs
- PRD document
- Architecture notes
- System constraints

### Outputs
- Task files in `tasks/todo/`
- Dependency graph
- Workstream organization

### Example
```
/planner payment-integration
```

## Developer Agent

**Purpose**: Implement specific tasks from the backlog

### When to Use
- When tasks are available in todo/
- For specific workstream development
- To implement features

### Responsibilities
- Claim tasks from todo/
- Implement code changes
- Write tests
- Update documentation
- Complete acceptance criteria

### Inputs
- Task file from `tasks/todo/`
- Related PRD and architecture
- Existing codebase

### Outputs
- Implemented code
- Test coverage
- Updated task in `done/`
- Documentation updates

### Example
```
/developer backend
/developer frontend
```

## Testing Agent

**Purpose**: Validate completed implementations

### When to Use
- After tasks move to done/
- For regression testing
- To validate requirements

### Responsibilities
- Test completed features
- Verify acceptance criteria
- Find edge cases
- Performance testing
- Report failures

### Inputs
- Completed tasks in `done/`
- Implementation code
- Test requirements

### Outputs
- Test results
- Bug reports
- Tasks moved back if failed
- Quality metrics

### Example
```
/tester
```

## Documentation Agent

**Purpose**: Keep documentation synchronized with code

### When to Use
- After code changes
- When APIs are modified
- For changelog updates

### Responsibilities
- Track code changes
- Update technical docs
- Maintain API references
- Update architecture docs
- Manage changelog

### Inputs
- Completed tasks
- Code changes
- Existing documentation

### Outputs
- Updated documentation
- API references
- Changelog entries
- Architecture updates

### Example
```
/docs-agent
```

## Project Manager Agent

**Purpose**: Coordinate work and track progress

### When to Use
- For status reports
- To check dependencies
- For task archival
- To identify blockers

### Responsibilities
- Monitor task folders
- Generate reports
- Manage dependencies
- Archive old tasks
- Track metrics

### Inputs
- Task folder structure
- Task metadata
- Dependency information

### Outputs
- Progress reports
- Dependency updates
- Archived tasks
- Blocker alerts

### Example
```
/pm status
/pm archive
```

## Agent Collaboration Patterns

### Sequential Flow
```
Architect → Planner → Developer → Tester → Docs
```

### Parallel Execution
```
Developer (Frontend) ──┐
Developer (Backend)  ──┼→ Tester → Docs
Developer (Database) ──┘
```

### Continuous Monitoring
```
PM Agent monitors all stages continuously
```

## Choosing the Right Agent

| Scenario | Agent to Use |
|----------|--------------|
| "I have a new feature idea" | Start with PRD, then Architect |
| "I need to break down this feature" | Planner |
| "I want to implement this task" | Developer |
| "Is this feature working correctly?" | Tester |
| "The code changed, update docs" | Docs Agent |
| "What's our progress?" | PM |

## Agent Communication

Agents communicate through:
1. **Task Files** - Shared state in tasks/
2. **Documentation** - Updates in docs/
3. **Scratch Notes** - Brainstorming in scratch/
4. **Code Changes** - Implementation in src/

## Best Practices by Role

### Architect
- Consider multiple approaches
- Document assumptions
- Think about scalability
- Include security considerations

### Planner
- Create right-sized tasks (1-3 days)
- Make dependencies explicit
- Consider parallel execution
- Include testing in scope

### Developer
- Follow existing patterns
- Write tests first
- Update docs immediately
- Commit incrementally

### Tester
- Test edge cases
- Verify performance
- Check security implications
- Test error scenarios

### Docs Agent
- Keep language clear
- Include examples
- Update all affected docs
- Maintain consistency

### PM
- Report regularly
- Proactively identify issues
- Keep folders organized
- Track meaningful metrics