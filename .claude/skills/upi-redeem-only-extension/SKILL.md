```markdown
# upi-redeem-only-extension Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you how to contribute to the `upi-redeem-only-extension` JavaScript codebase. It covers the project's coding conventions, file organization, and testing patterns. The repository does not use a framework and relies on clear, consistent JavaScript practices for maintainability.

## Coding Conventions

### File Naming
- **Style:** kebab-case
- **Example:**  
  `redeem-handler.js`  
  `upi-utils.js`

### Import Style
- **Relative imports** are used throughout the codebase.
- **Example:**
  ```javascript
  import { redeemUPI } from './upi-utils.js';
  ```

### Export Style
- **Named exports** are preferred.
- **Example:**
  ```javascript
  // upi-utils.js
  export function redeemUPI() { /* ... */ }
  ```

### Commit Messages
- **Freeform style** (no strict prefixing)
- **Average length:** ~38 characters
- **Example:**  
  `fix bug in UPI redemption flow`

## Workflows

### Adding a New Feature
**Trigger:** When implementing new functionality  
**Command:** `/add-feature`

1. Create a new file using kebab-case (e.g., `feature-name.js`).
2. Use relative imports to include dependencies.
3. Export new functions or constants using named exports.
4. Write or update corresponding test files (`*.test.js`).
5. Commit changes with a concise, descriptive message.

### Fixing a Bug
**Trigger:** When resolving a bug or issue  
**Command:** `/fix-bug`

1. Locate the relevant file(s) using kebab-case naming.
2. Make the necessary code changes.
3. Update or add tests to cover the fix.
4. Commit with a message describing the bug fix.

### Writing Tests
**Trigger:** When adding or updating functionality  
**Command:** `/write-test`

1. Create or update a test file matching `*.test.js`.
2. Write test cases for each exported function.
3. Ensure tests cover edge cases and expected behavior.
4. Run tests to verify correctness.

## Testing Patterns

- **Test File Naming:**  
  Test files follow the pattern `*.test.js` (e.g., `upi-utils.test.js`).
- **Testing Framework:**  
  Not explicitly detected; use standard JavaScript testing practices.
- **Test Structure:**  
  Each exported function should have corresponding tests.
- **Example:**
  ```javascript
  // upi-utils.test.js
  import { redeemUPI } from './upi-utils.js';

  test('redeemUPI returns expected result', () => {
    // ...test implementation...
  });
  ```

## Commands
| Command        | Purpose                                 |
|----------------|-----------------------------------------|
| /add-feature   | Scaffold and implement a new feature    |
| /fix-bug       | Guide for fixing a bug                  |
| /write-test    | Steps for writing or updating tests     |
```
