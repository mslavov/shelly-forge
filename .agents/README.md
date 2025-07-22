# Agent Operations

This directory contains all operational files needed for agent-based development.

## Structure

```
.agents/
├── definitions/      # Agent role definitions and workflows
├── tasks/           # Task management system
├── rules/           # Development rules and guidelines
└── templates/       # Document templates for agents
```

## Contents

### definitions/
Complete agent definitions including:
- Purpose and responsibilities
- Input/output specifications
- Workflows and guidelines
- Integration with other agents

### tasks/
File-based task management system:
- `todo/` - Available tasks
- `in-progress/` - Active work
- `done/` - Completed tasks
- `archive/` - Historical tasks

### rules/
Development rules broken down by topic:
- `package-manager.md` - Package management (pnpm)
- `database.md` - Database access patterns
- `nextjs.md` - Framework-specific rules
- `mcp-servers.md` - MCP server usage

### templates/
Reusable templates for consistent documentation:
- `architecture-template.md` - Technical design template

## Usage

Agents should reference these files for:
1. Understanding their role (definitions/)
2. Finding work to do (tasks/)
3. Following project standards (rules/)
4. Creating consistent documents (templates/)

All paths in agent commands (both Claude and Cursor) point to this directory structure.