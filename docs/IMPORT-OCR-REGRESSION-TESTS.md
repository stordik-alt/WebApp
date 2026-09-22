# Import/OCR regression test plan

## 1. Employee position invariant

**Rule:** An employee import row may contain only HA, TUP, or NULL while unresolved. There is no combined position such as HA/TUP.

### Automated tests
- HA -> HA
- TUP -> TUP
- HA/TUP -> NULL
- HA / TUP -> NULL
- HA-TUP -> NULL
- HA,TUP -> NULL
- empty/unknown value -> NULL
- valid values with whitespace/case differences are canonicalized

### Import regression
- OCR returns position: HA/TUP.
- The employee row must not be persisted with a combined value.
- The row must remain unresolved and enter validation/approval when no unambiguous role is available.
- The UI must offer only HA and TUP for manual correction.

## 2. OCR retry/merge

- First OCR provider returns HA/TUP, retry provider returns HA: final row is HA.
- Both providers return HA/TUP: final row is unresolved.
- Retry must not reintroduce a combined position after normalization.
- Duplicate employee rows from multiple OCR passes must still merge by employee name.

## 3. Product/role interaction

- H_ product with a missing position may infer HA.
- T_ product with a missing position may infer TUP.
- An explicitly ambiguous OCR position must not override the safety rule.
- A screenshot containing multiple products must not assign one global role to every employee when the employee role cannot be determined unambiguously.

## 4. Persistence and re-import

- First persistence with OCR HA/TUP must not create an invalid import_item_rows.position.
- Re-import of the same screenshot must produce the same canonical result.
- Pending import edited manually to HA or TUP must save the selected value.
- Re-import must not create a duplicate daily record.

## 5. Database invariant

Verify that:
- import_item_rows.position contains only HA, TUP, or NULL.
- daily_records.position contains only HA or TUP.
- The database check constraint rejects any direct attempt to write HA/TUP.
- The normalization trigger never writes a combined position.

## 6. Required end-to-end screenshots

At minimum test screenshots should cover:
1. HA-only employee table.
2. TUP-only employee table.
3. OCR position visibly written as HA/TUP.
4. Two employees where one is HA and one is TUP.
5. Multi-product screenshot containing H_ and T_ products.
6. Screenshot where the position is unreadable.
7. OCR first pass and retry returning different position values.
8. Reimport from Ke schválení.

## 7. Acceptance criteria

An import passes only when every persisted employee row satisfies:

position IS NULL OR position IN ('HA','TUP')

No UI, OCR provider, retry path, merge path, reimport path, or approval path may create or preserve a combined HA/TUP position.
