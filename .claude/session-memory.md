# SageSync Session Memory - 2026-02-03

## Problem Solved

Items were being created in Fracttal via `POST /items/` which creates **standalone assets without warehouse association**. Items existed but had no warehouse, no stock, couldn't be seen in inventory views.

## Changes Made (NOT YET COMMITTED)

### 1. FracttalClient.js - Added 7 new methods

Location: `src/services/fracttalClient.js`

New methods added:
- `createInventoryWithWarehouse()` - `POST /inventories/` - Creates item AND associates to warehouse
- `associateItemToWarehouse()` - `POST /inventories_associate_warehouse/` - Associates existing item to warehouse
- `adjustInventoryStock()` - `PUT /inventories_adjustment/{code}` - Sets/changes stock and cost
- `getWarehouseStock()` - `GET /warehouses_items/{code}` - Queries all items+stock in a warehouse
- `getItemInventory()` - `GET /inventories/{code}` - Queries item with warehouse details
- `createWarehouseEntry()` - `POST /warehouse_entries_orders/{wh}` - Creates warehouse entry
- `createWarehouseExit()` - `POST /warehouse_outputs_orders/` - Creates warehouse exit

### 2. test-workflow.js - Completely rewritten

Location: `tests/manual/test-workflow.js`

New 10-step workflow using TEST001 warehouse:
1. Authenticate
2. Verify warehouse TEST001
3. Generate dummy items
4. Create items WITH warehouse (`POST /inventories/`)
5. Set initial stock (`PUT /inventories_adjustment/`)
6. Verify stock in warehouse (`GET /warehouses_items/`)
7. Simulate Sage stock change
8. Verify adjusted stock
9. Query item details (`GET /inventories/`)
10. Summary

Test runs with 9/9 steps passing, 0 errors.

### 3. app.js - Fixed production sync logic

Location: `src/app.js`

Fixed the three sync cases:

**CASE A: Item exists + in warehouse**
- Before: `updateInventoryAdjustment()` (worked but was deprecated alias)
- After: `adjustInventoryStock()` directly

**CASE B: Item exists but NOT in this warehouse**
- Before: `createInventoryItem()` - BROKEN - created duplicate orphan asset
- After: `associateItemToWarehouse()` then `adjustInventoryStock()`

**CASE C: Item doesn't exist**
- Before: `createInventoryItem()` - BROKEN - created orphan with no warehouse
- After: `createInventoryWithWarehouse()` then `adjustInventoryStock()`

### 4. config.json - No changes needed

TEST mapping to TEST001 was already correct.

## Key API Discovery

`POST /inventories/` creates the item + warehouse association but sets initial stock to **0**.
The actual stock MUST be set via `PUT /inventories_adjustment/{code}` as a second call.

## Correct Fracttal API Endpoints

| Purpose | Endpoint | Method |
|---------|----------|--------|
| Create item + warehouse | `/inventories/` | POST |
| Associate existing item to warehouse | `/inventories_associate_warehouse/` | POST |
| Set/adjust stock | `/inventories_adjustment/{code}` | PUT |
| Query warehouse inventory | `/warehouses_items/{code}` | GET |
| Query item with warehouses | `/inventories/{code}` | GET |
| Create warehouse | `/warehouses/` | POST |

## Files Modified (uncommitted)

```
modified:   src/app.js
modified:   src/services/fracttalClient.js
modified:   tests/manual/test-workflow.js
```

## To Commit

```bash
git add src/app.js src/services/fracttalClient.js tests/manual/test-workflow.js
git commit -m "feat: Fix warehouse inventory sync using correct Fracttal API endpoints

- Add 7 new methods to FracttalClient for warehouse inventory operations
- Fix app.js sync logic to use POST /inventories/ for new items
- Fix app.js to use POST /inventories_associate_warehouse/ for existing items
- All cases now use PUT /inventories_adjustment/ to set stock
- Rewrite test-workflow.js with full 10-step production flow
- Test passes 9/9 steps with 0 errors on TEST001 warehouse

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

## Sandbox Credentials (for testing)

- URL: https://app.fracttal.com/signin
- User: gsancheze@capstonecopper.com
- Pass: Fr4ctt4L.54ndB0x

## Test Command

```bash
npm run test:workflow
```
