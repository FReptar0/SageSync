# Deferred Items — Phase 02-enforcement-surface

## Pre-existing Test Failure (out of scope)

**tests/services/fracttalClient.test.js**
- Test: `FracttalClient > API methods > updateWarehouseItem > should update warehouse item successfully`
- Failure: expects PUT to `/items/item1` but actual implementation calls `/inventories_adjustment/item1`
- Status: Pre-existing before Phase 2 started (confirmed via git stash verification)
- Action needed: Update the test expectation to match the current implementation path, or fix the implementation path
- Discovered: 2026-04-08 during 02-01 plan execution
