# Contributing to Shelly Forge

Thank you for your interest in contributing to Shelly Forge! This document provides guidelines and information about contributing to this project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in the [Issues](https://github.com/mslavov/shelly-forge/issues)
2. If not, create a new issue with:
    - A clear title
    - A detailed description
    - Steps to reproduce
    - Expected vs actual behavior
    - Your environment details (OS, Node.js version, etc.)

### Suggesting Enhancements

1. Create an issue describing your enhancement
2. Include:
    - The use case
    - How your suggestion would benefit other users
    - Possible implementation details

### Pull Requests

1. Fork the repository
2. Create a new branch from `main`:
    ```bash
    git checkout -b feature/your-feature-name
    ```
3. Make your changes
4. Add or update tests as needed
5. Run the test suite
6. Commit your changes:
    ```bash
    git commit -m "feat: add some feature"
    ```
7. Push to your fork
8. Create a Pull Request

#### Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

-   `feat:` New feature
-   `fix:` Bug fix
-   `docs:` Documentation changes
-   `style:` Code style changes (formatting, etc)
-   `refactor:` Code changes that neither fix bugs nor add features
-   `test:` Adding or updating tests
-   `chore:` Maintenance tasks

### Development Setup

1. Clone the repository
2. Install dependencies:
    ```bash
    npm install
    ```
3. Create a new branch for your changes
4. Make your changes
5. Test your changes:
    ```bash
    npm test
    ```

## Project Structure

```
shelly-forge/
├── bin/              # CLI tools
├── src/              # Source code
├── templates/        # Project templates
├── types/           # TypeScript definitions
└── tests/           # Test files
```

## Testing

-   Write tests for new features
-   Update tests for bug fixes
-   Ensure all tests pass before submitting PR
-   Follow existing test patterns

## Documentation

-   Update README.md for user-facing changes
-   Add JSDoc comments for new functions/methods
-   Update type definitions as needed

## Questions?

Feel free to create an issue tagged with `question` if you need help or clarification.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
