# Documentation Usage Guidelines

## CRITICAL: Framework-First Reading Order

### 📚 MANDATORY READING ORDER:
1. **FIRST**: Read rules in [`.agents/rules/`](.agents/rules/) - Framework rules and development guidelines
2. **SECOND**: Read [`docs/INDEX.md`](docs/INDEX.md) - Documentation navigation hub
3. **THIRD**: Read your agent definition in [`.agents/definitions/`](.agents/definitions/) (if applicable)
4. **THEN**: Consult project-specific documentation as needed

## Pre-Task Protocol

1. **Verify you've read the framework rules** - All files in `.agents/rules/` and INDEX.md are mandatory
2. **Review relevant documentation** - Use INDEX.md to find specific docs
3. **Check the Quick Task Lookup** - Find the right documents for your task type
4. **Consult product documents** from [`docs/product`](docs/product) as needed
5. **Reference technical docs** from [`docs/tech`](docs/tech) as needed

## Post-Task Protocol

1. Update the single authoritative source for any changed information
2. Update cross-references if new relationships are created
3. Move completed tasks from [`.agents/tasks/in-progress/`](.agents/tasks/in-progress/) to [`.agents/tasks/done/`](.agents/tasks/done/)
4. Update [`docs/INDEX.md`](docs/INDEX.md) if new documents are created

## Agent Commands

Agent commands are available as @ commands (e.g., `@architect`, `@developer`). Each command:
- Provides a brief role description
- Links to full documentation in [`.agents/definitions/`](.agents/definitions/)
- Assumes this AGENTS.md file has been read

See available commands in [`.cursor/rules/`](.cursor/rules/)