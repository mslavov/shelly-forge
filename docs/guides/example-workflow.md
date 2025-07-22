# Example Workflow: Building a Search Feature

This guide walks through a complete example of using the multi-agent workflow to build a search feature from PRD to deployment.

## Feature Overview

We'll build a product search feature that allows users to:
- Search products by name
- Filter by category and price
- See paginated results
- Get search suggestions

## Step 1: Create the PRD

First, create `docs/product/product-search.md`:

```markdown
# PRD: Product Search

**Date**: 2025-01-20
**Author**: Product Team

## Overview
Add search functionality to help users find products quickly...

## User Stories

### As a customer, I want to search products by name
**Acceptance Criteria:**
- Search box on main navigation
- Real-time suggestions as I type
- Results show product name, price, image

### As a customer, I want to filter search results
**Acceptance Criteria:**
- Filter by category dropdown
- Price range slider
- Results update without page reload
```

## Step 2: Architecture Design

Run the architect agent:
```
/architect docs/product/product-search.md
```

This creates `scratch/product-search-architecture.md`:

```markdown
# Product Search Architecture

## Technical Approach

### Search Infrastructure
- Elasticsearch for full-text search
- Redis for caching suggestions
- PostgreSQL as source of truth

### Components
1. **Search Service** (Backend)
   - Elasticsearch integration
   - Query builder
   - Result aggregation

2. **Search API** (Backend)  
   - REST endpoints
   - Input validation
   - Response caching

3. **Search UI** (Frontend)
   - Search bar component
   - Filter controls
   - Results display
   - Pagination

### Data Flow
1. User types in search box
2. Frontend debounces input
3. API queries Elasticsearch
4. Results cached in Redis
5. Frontend displays results
```

## Step 3: Task Planning

Run the planner agent:
```
/planner product-search
```

This creates multiple task files in `tasks/todo/`:

### `backend-search-service.md`
```yaml
---
id: backend-search-service
workstream: backend
dependencies: [database-search-indices]
estimated_hours: 16
---

# Search Service Implementation

## Subtasks
- [ ] Set up Elasticsearch client
- [ ] Create search query builder
- [ ] Implement full-text search
- [ ] Add category filtering
- [ ] Add price range filtering
- [ ] Write unit tests
```

### `frontend-search-components.md`
```yaml
---
id: frontend-search-components
workstream: frontend
dependencies: []
estimated_hours: 12
---

# Search UI Components

## Subtasks
- [ ] Create SearchBar component
- [ ] Add debounced input handling
- [ ] Create FilterPanel component
- [ ] Build SearchResults component
- [ ] Add pagination controls
- [ ] Write component tests
```

### `backend-search-api.md`
```yaml
---
id: backend-search-api
workstream: backend
dependencies: [backend-search-service]
estimated_hours: 8
---

# Search API Endpoints

## Subtasks
- [ ] Create GET /api/search endpoint
- [ ] Add query parameter validation
- [ ] Implement response caching
- [ ] Add search analytics
- [ ] Write API tests
```

### `database-search-indices.md`
```yaml
---
id: database-search-indices
workstream: database
dependencies: []
estimated_hours: 4
---

# Search Database Setup

## Subtasks
- [ ] Create Elasticsearch indices
- [ ] Set up data synchronization
- [ ] Configure analyzers
- [ ] Add mapping for products
```

## Step 4: Parallel Development

Multiple developers work simultaneously:

### Terminal 1 - Database Developer
```
/developer database
```
- Claims `database-search-indices.md`
- Sets up Elasticsearch
- Moves task to done/

### Terminal 2 - Frontend Developer
```
/developer frontend
```
- Claims `frontend-search-components.md`
- Builds UI components
- No dependencies, starts immediately

### Terminal 3 - Backend Developer
```
/developer backend
```
- Waits for database task
- Claims `backend-search-service.md`
- Implements search logic

## Step 5: Task Progression

As tasks complete, the folder structure evolves:

### Initial State
```
tasks/
  todo/
    - backend-search-service.md
    - backend-search-api.md
    - frontend-search-components.md
    - database-search-indices.md
```

### Mid Development
```
tasks/
  todo/
    - backend-search-api.md
  in-progress/
    - backend-search-service.md
    - frontend-search-components.md
  done/
    - database-search-indices.md
```

### Near Completion
```
tasks/
  todo/
  in-progress/
    - backend-search-api.md
  done/
    - database-search-indices.md
    - backend-search-service.md
    - frontend-search-components.md
```

## Step 6: Integration Testing

Run the testing agent:
```
/tester
```

The tester:
1. Verifies search returns relevant results
2. Tests filter combinations
3. Validates pagination
4. Checks performance (< 200ms response)
5. Tests edge cases (empty results, special characters)

If issues found, tasks move back to todo/ with notes.

## Step 7: Documentation Updates

Run the docs agent:
```
/docs-agent
```

Updates made:
- `docs/tech/api-reference.md` - Adds search endpoint docs
- `docs/system-overview.md` - Updates architecture diagram
- `docs/CHANGELOG.md` - Adds search feature entry
- `docs/guides/search-setup.md` - Creates setup guide

## Step 8: Progress Tracking

Run PM agent for status:
```
/pm status
```

Output:
```markdown
## Progress Report - 2025-01-22

### Overview
- Todo: 0 tasks
- In Progress: 0 tasks  
- Completed Today: 4 tasks
- Feature Status: Ready for deployment

### Completed Tasks
- database-search-indices (4 hours)
- backend-search-service (15 hours)
- frontend-search-components (11 hours)
- backend-search-api (7 hours)

### Total Time: 37 hours
### Velocity: 4 tasks in 3 days
```

## Step 9: Deployment

With all tasks complete:
1. Code is reviewed and merged
2. Documentation is updated
3. Tests are passing
4. Feature is deployed

## Step 10: Archival

Two weeks later:
```
/pm archive
```

Tasks move to `tasks/archive/2025-02/`

## Lessons Learned

### What Worked Well
- Parallel development saved time
- Clear dependencies prevented conflicts
- Comprehensive testing caught issues early
- Documentation stayed current

### Improvements
- Could break frontend into smaller tasks
- Add performance testing task
- Include monitoring setup task

## Timeline Summary

- Day 1: PRD → Architecture → Tasks
- Day 2-3: Parallel development
- Day 4: Integration and testing
- Day 4: Documentation and deployment

Total: 4 days from PRD to production

## Key Takeaways

1. **Parallel Work** - Frontend started immediately while backend waited
2. **Clear Dependencies** - No conflicts or blocking
3. **Incremental Progress** - Each task was deployable
4. **Continuous Docs** - Documentation never fell behind
5. **Quality Gates** - Testing caught issues before production