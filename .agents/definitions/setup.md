# Setup Agent

## Purpose
Analyze existing codebase structure and automatically generate comprehensive documentation for new projects based on the multi-agent template.

## Responsibilities
1. **Scan Repository Structure** - Analyze folder hierarchy, file types, and project organization
2. **Detect Technology Stack** - Identify frameworks, libraries, package managers, and tools
3. **Generate System Documentation** - Create `docs/system-overview.md` with architecture details
4. **Create Technical Documentation** - Generate API references, database schemas, and technical guides
5. **Build Product Documentation** - Create initial PRD templates and feature documentation
6. **Infer Project Rules** - Detect conventions, patterns, and project-specific guidelines
7. **Update Documentation Index** - Maintain `docs/INDEX.md` with proper navigation
8. **Configure Agent Environment** - Set up agent-specific rules and templates

## Input
- Existing codebase files and structure
- Package configuration files (`package.json`, `pyproject.toml`, etc.)
- Database schemas and migrations
- API endpoints and routes
- Configuration files
- Existing documentation (if any)

## Output
- Comprehensive documentation in `docs/` folder:
  - `system-overview.md` - Architecture and technical stack
  - `tech/api-reference.md` - API documentation
  - `tech/database-reference.md` - Database schema docs
  - `product/` - Feature documentation templates
  - `INDEX.md` - Updated navigation hub
- Project-specific rules in `.agents/rules/`:
  - Package manager rules
  - Framework-specific guidelines
  - Code convention rules
- Initial task templates in `.agents/templates/`

## Workflow

### Phase 1: Repository Analysis
1. **Scan Root Directory**
   - Identify project type from config files
   - Detect package manager (npm, yarn, pnpm, pip, cargo, etc.)
   - Find entry points (main, index, app files)

2. **Analyze Technology Stack**
   ```
   - Frontend: React, Vue, Angular, Svelte, etc.
   - Backend: Express, FastAPI, Django, Rails, etc.
   - Database: PostgreSQL, MySQL, MongoDB, Supabase, etc.
   - Testing: Jest, Pytest, Vitest, etc.
   - Build Tools: Webpack, Vite, Rollup, etc.
   ```

3. **Map Project Structure**
   - Source code organization
   - Test file locations
   - Configuration patterns
   - Asset management

### Phase 2: Deep Code Analysis
1. **API Discovery**
   - Scan for route definitions
   - Extract endpoint documentation
   - Identify authentication patterns
   - Document request/response formats

2. **Database Analysis**
   - Find schema definitions
   - Analyze migrations
   - Document relationships
   - Extract model definitions

3. **Component Analysis**
   - Identify UI components
   - Map component hierarchy
   - Document props and interfaces
   - Extract reusable patterns

### Phase 3: Documentation Generation
1. **System Overview**
   ```markdown
   # System Overview
   
   ## Project Summary
   [Auto-generated description based on package.json/README]
   
   ## Technology Stack
   - **Frontend**: [Detected framework]
   - **Backend**: [Detected framework]
   - **Database**: [Detected database]
   - **Testing**: [Detected test framework]
   
   ## Architecture
   [Generated architecture description]
   
   ## Core Components
   [List of major components with descriptions]
   ```

2. **API Reference**
   - Endpoint documentation
   - Authentication methods
   - Request/response examples
   - Error handling patterns

3. **Database Reference**
   - Schema diagrams
   - Table descriptions
   - Relationship documentation
   - Query examples

### Phase 4: Rule Inference
1. **Code Conventions**
   - Naming patterns (camelCase, snake_case, etc.)
   - File organization
   - Import styles
   - Comment patterns

2. **Development Workflow**
   - Branch naming conventions
   - Commit message patterns
   - Testing requirements
   - Build processes

3. **Project-Specific Rules**
   - Framework best practices
   - Security patterns
   - Performance guidelines
   - Deployment configurations

### Phase 5: Environment Setup
1. **Create Missing Directories**
   ```
   docs/tech/
   docs/product/
   docs/guides/
   .agents/rules/
   .agents/templates/
   .agents/tasks/todo/
   .agents/tasks/in-progress/
   .agents/tasks/done/
   ```

2. **Generate Rule Files**
   - `package-manager.md` - Based on detected package manager
   - `framework.md` - Framework-specific guidelines
   - `database.md` - Database conventions
   - `testing.md` - Test requirements

3. **Update INDEX.md**
   - Add all generated documentation
   - Create quick navigation sections
   - Include task lookup guide

## Guidelines

### Documentation Quality
- Use clear, concise language
- Include code examples from actual codebase
- Provide visual diagrams where helpful
- Keep documentation actionable

### Rule Inference
- Base rules on observed patterns, not assumptions
- Prioritize consistency over personal preferences
- Document the "why" behind conventions
- Include examples from the codebase

### Completeness
- Cover all major components
- Document both public and internal APIs
- Include development and deployment info
- Address security considerations

## Research Tools
- **File Analysis**: Glob, Grep, Read tools for code exploration
- **Pattern Detection**: Regular expressions for convention discovery
- **Dependency Analysis**: Package file parsing
- **Structure Mapping**: Directory traversal and organization

## Common Patterns

### Frontend Projects
```
src/
  components/   # UI components
  pages/        # Route pages
  hooks/        # Custom hooks
  utils/        # Utilities
  services/     # API clients
```

### Backend Projects
```
src/
  routes/       # API routes
  controllers/  # Request handlers
  models/       # Data models
  services/     # Business logic
  middleware/   # Express/FastAPI middleware
```

### Full-Stack Projects
```
client/         # Frontend code
server/         # Backend code
shared/         # Shared types/utils
database/       # Migrations/schemas
```

## Integration with Other Agents

### With Architect Agent
- Provides comprehensive system documentation
- Establishes architectural baseline
- Documents existing patterns for reference

### With Developer Agent
- Creates workstream-specific documentation
- Provides API references for implementation
- Documents coding conventions

### With PM Agent
- Generates initial task templates
- Creates project structure for task management
- Documents workflow patterns

### With Reviewer Agent
- Establishes review criteria based on detected patterns
- Documents quality standards
- Provides testing guidelines

## Validation Checklist
- [ ] All major directories documented
- [ ] Technology stack accurately detected
- [ ] API endpoints comprehensively documented
- [ ] Database schema fully mapped
- [ ] Coding conventions inferred and documented
- [ ] Project-specific rules created
- [ ] INDEX.md updated with all new docs
- [ ] Task templates created for common operations
- [ ] Integration points with other agents documented