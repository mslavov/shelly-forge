# Product Requirement Documents (PRDs)

This directory contains Product Requirement Documents that define features and functionality to be implemented.

## What is a PRD?

A Product Requirement Document (PRD) defines:
- What we're building and why
- Who will use it (target users)
- Key features and functionality
- Success criteria and metrics
- Constraints and considerations

## Creating PRDs

PRDs can be created:
1. **Manually** - Write directly using the template
2. **With ChatPRD** - Use the ChatPRD service to generate initial drafts
3. **AI-Assisted** - Have Claude or another AI help draft based on requirements

## PRD Workflow

1. **Create PRD** → Place in this directory
2. **Architect Review** → `/architect` analyzes and creates technical design
3. **Task Planning** → `/planner` breaks down into implementable tasks
4. **Implementation** → Developers work on generated tasks
5. **Validation** → Testing against PRD requirements

## File Naming

Use descriptive names: `[feature-name].md`
- `user-authentication.md`
- `search-functionality.md`
- `payment-integration.md`

## Template Structure

See `template.md` for the standard PRD format. Key sections:
- Overview and objectives
- User stories and use cases
- Functional requirements
- Non-functional requirements
- Success metrics
- Timeline and phases

## Best Practices

1. **Be Specific** - Avoid ambiguous requirements
2. **Focus on What, Not How** - Leave implementation details to architects
3. **Include Success Criteria** - How will we know it's working?
4. **Consider Edge Cases** - What could go wrong?
5. **Version Control** - Track changes as requirements evolve

## Integration with Agents

- **Architect Agent** - Reads PRDs to design technical solutions
- **Planner Agent** - Converts PRDs into task files
- **Developer Agents** - Reference PRDs during implementation
- **Testing Agent** - Validates against PRD requirements