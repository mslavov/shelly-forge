---
description: Cursor create or update rules
globs: *.mdc
alwaysApply: false
---
# Cursor Rules Format and Location

Every Cursor rule file must follow these standards:

## 1. Required Header Format

Every rule file MUST start with a YAML header between triple dashes:
```yaml
---
description: A clear, concise description of what the rule enforces
globs: Pattern(s) for files this rule applies to as comma-separated list
alwaysApply: true/false (whether this rule should be applied to every matching file)
---
```

Example headers:
```yaml
# For TypeScript files in src directory
---
description: TypeScript naming conventions
globs: src/**/*.ts
alwaysApply: true
---

# For multiple file types
---
description: React component standards
globs: app/**/*.tsx, app/**/*.jsx, components/**/*.tsx, components/**/*.jsx
alwaysApply: true
---

# For SQL migrations
---
description: Supabase migration standards
globs: supabase/migrations/*.sql
alwaysApply: false
---
```

## 2. File Location

Rules must be placed in the correct directory structure:
```
PROJECT_ROOT/
├── .cursor/
│   └── rules/
│       ├── your-rule-name.mdc
│       └── ...
└── ...
```

## 3. File Naming Convention

- Use kebab-case for filenames
- Always use .mdc extension
- Make names descriptive of the rule's purpose

Examples:
```
✅ Good names:
.cursor/rules/typescript-naming.mdc
.cursor/rules/react-components.mdc
.cursor/rules/supabase-migrations.mdc

❌ Bad names:
.cursor/rules/rule1.mdc
.cursor/rules/my_rule.mdc
.cursor/rules/ReactComponents.mdc
```

## 4. Rule Content Structure

After the header, include:
1. A clear title (H1)
2. Brief description of the rule's purpose
3. Specific requirements or standards
4. Examples of correct and incorrect usage
5. Any additional context or explanations

Example structure:
```markdown
---
description: TypeScript naming conventions
globs: src/**/*.ts
alwaysApply: true
---
# TypeScript Naming Conventions

Standards for naming TypeScript entities in our codebase.

## Interface Names
- Must start with 'I'
- Use PascalCase
- Be descriptive

✅ Correct:
```typescript
interface IUserProfile { ... }
```

❌ Incorrect:
```typescript
interface userProfile { ... }
```
```

## 5. Never Place Rules

- In the project root
- In subdirectories outside .cursor/rules
- Without the required YAML header
- Without proper examples and explanations

