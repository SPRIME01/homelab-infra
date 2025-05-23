

## Existing Pulumi Setup

1. **Project Structure**:
   - There are three main Pulumi projects: `cluster-setup`, `core-services`, and `storage`
   - Each project follows a clean structure with `src/` directory containing components, types, and utilities
   - Tests are Jest-based and in `src/__tests__` directories

2. **Testing Approach**:
   - Jest is used for unit tests with Pulumi mocks for testing without actual infrastructure
   - Test files follow patterns like `clusterSetup.test.ts`, `openEBS.test.ts`, etc.
   - Tests use `pulumi.runtime.setMocks()` and `pulumi.runtime.resourcePromises()` for async testing
   - A dedicated `test-pulumi.sh` script handles TypeScript validation and test execution
   - The script also includes linting and formatting checks

3. **Components**:
   - Components are structured as Pulumi `ComponentResource` classes
   - Proper mock patterns for Kubernetes resources are used in tests
